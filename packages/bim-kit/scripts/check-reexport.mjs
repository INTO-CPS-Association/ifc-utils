#!/usr/bin/env node
/**
 * Which bindings of a manifest survive another export of the same building.
 *
 *   node scripts/check-reexport.mjs <manifest.json> <model.ifc | model.glb> [--json]
 *
 * A manifest is written against one IFC file. When the authoring tool exports
 * the building again, the GlobalIds may or may not stay the same and the only
 * way to know is to try. This resolves every binding against the other export
 * with the package's own resolver and prints which survive and which do not,
 * with the reason the resolver gives.
 *
 * An IFC file is converted with the package's converter, the same code the
 * Buildings page runs, so the objects are those the page would draw. A GLB is
 * read from its glTF JSON, where a converter in this repository stores the
 * GlobalId in `extras`. The manifest is JSON, the format the page reads.
 *
 * Run `npm run build` first: this imports the built package from `dist/`.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveBindings } from '../dist/esm/resolver.js';
import { readManifest } from '../dist/esm/schema.js';

/** The four bytes a binary glTF file starts with, `glTF` read as little endian. */
const GLB_MAGIC = 0x46546c67;
/** The type of the JSON chunk of a binary glTF file, `JSON` read as little endian. */
const JSON_CHUNK = 0x4e4f534a;

/** The objects of a GLB, as the resolver wants them: every node that holds a mesh. */
export function objectsOfGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('the file is not a binary glTF');
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK) throw new Error('the first glTF chunk is not JSON');
  const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  return (gltf.nodes ?? [])
    .filter((node) => node.mesh !== undefined)
    .map((node) => ({ globalId: node.extras?.globalId, nodeName: node.name || undefined }));
}

/** The objects of an IFC file, converted by the package as the page converts it. */
export async function objectsOfIfc(bytes) {
  // Imported here, because the converter carries over a megabyte of
  // WebAssembly that a GLB never needs.
  const { convertIfc } = await import('../dist/esm/converter.js');
  const converted = await convertIfc(bytes);
  // The page names each mesh by the object's name, else by its GlobalId.
  return converted.objects.map((object) => ({
    globalId: object.globalId,
    nodeName: object.name ?? object.globalId,
  }));
}

/** The objects of a model file, chosen by its suffix. */
export function objectsOfModel(path, bytes) {
  return path.toLowerCase().endsWith('.glb') ? objectsOfGlb(bytes) : objectsOfIfc(bytes);
}

/** The SHA-256 of a file, as the manifest writes it. */
export function sha256Of(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** How the manifest's recorded hash compares with the model file. */
export function hashVerdict(recorded, actual) {
  if (recorded === undefined) return 'the manifest records no hash';
  if (recorded === 'unknown') return 'the manifest records the hash as unknown';
  return recorded.toLowerCase() === actual ? 'same file' : 'different file';
}

/** Resolve a manifest's bindings against a list of objects and describe the outcome. */
export function checkBindings(manifest, objects) {
  const bindings = Array.isArray(manifest?.bindings) ? manifest.bindings : [];
  const { resolved, unresolved } = resolveBindings(bindings, objects);
  return {
    total: bindings.length,
    survived: resolved.map(({ binding }) => ({ label: binding.label, selector: binding.selector })),
    lost: unresolved.map(({ binding, reason }) => (
      { label: binding.label, selector: binding.selector, reason })),
  };
}

/** Everything the report says, gathered from the two files. */
export async function compare(manifestPath, modelPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bytes = new Uint8Array(readFileSync(modelPath));
  const objects = await objectsOfModel(modelPath, bytes);
  const schema = readManifest(manifest);
  return {
    manifest: basename(manifestPath),
    model: basename(modelPath),
    objects: objects.length,
    schemaProblems: schema.ok ? [] : schema.problems.map((p) => `${p.where}: ${p.message}`),
    hash: hashVerdict(manifest?.model?.source_sha256, sha256Of(bytes)),
    ...checkBindings(manifest, objects),
  };
}

/** The report as lines of text. */
export function formatReport(report) {
  const lines = [
    `Manifest: ${report.manifest}`,
    `Model: ${report.model} (${report.objects} objects with geometry)`,
    `Hash: ${report.hash}`,
    `Schema: ${report.schemaProblems.length === 0 ? 'valid' : report.schemaProblems.join('. ')}`,
    `Survive: ${report.survived.length} of ${report.total}`,
    ...report.survived.map(({ label }) => `  ok    ${label}`),
    `Lost: ${report.lost.length} of ${report.total}`,
    ...report.lost.map(({ label, reason }) => `  lost  ${label}: ${reason}`),
  ];
  return lines.join('\n');
}

async function main(argv) {
  const [manifestPath, modelPath] = argv.filter((arg) => !arg.startsWith('--'));
  if (!manifestPath || !modelPath) {
    console.error('usage: node scripts/check-reexport.mjs <manifest.json> <model.ifc|model.glb> [--json]');
    return 2;
  }
  const report = await compare(manifestPath, modelPath);
  console.log(argv.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
  // Exit 1 when a binding is lost, so a pipeline can stop on a re-export that broke one.
  return report.lost.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => { console.error(error.message); process.exitCode = 2; },
  );
}
