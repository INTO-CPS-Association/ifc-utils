# @into-cps-association/bim-ifc-converter

Turn an IFC file into drawable geometry, in the browser.

IFC is a text exchange format holding parametric solids: a wall is a profile swept along a path with holes subtracted, not a list of triangles. Producing the triangles needs a geometry kernel, and the one used here is [web-ifc](https://github.com/ThatOpen/engine_web-ifc) compiled to WebAssembly. The conversion happens on the machine that is looking at the model, so a platform needs no converter service.

## Install

```bash
npm install @into-cps-association/bim-ifc-converter
```

Nothing else. The WebAssembly parser travels inside the package and is turned back into a blob at runtime, so no file has to be copied into a host's output, no path has to be configured, and an install with no external network works unchanged. It costs about a third more bytes than the binary, in a chunk a host fetches only when a model actually has to be converted.

## Use

```js
import { convertIfc } from '@into-cps-association/bim-ifc-converter';

const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
const { schema, objects, failed } = await convertIfc(bytes, {
  onProgress: (done) => console.log(`${done} objects`),
});

for (const object of objects) {
  // positions and normals are world space metres, Y up, three numbers each
  build(object.globalId, object.ifcClass, object.positions, object.normals, object.indices);
}
```

`failed` counts objects the kernel could not turn into geometry, and objects with no GlobalId. It is returned rather than hidden: some shapes defeat any kernel, and a viewer that silently draws less than the file holds gives nobody a way to tell.

## What Comes Out

Plain typed arrays. Nothing here imports three.js or any other renderer, which is what lets it be tested in Node where there is no canvas, and what lets a caller build whatever it likes from the numbers.

**Metres, Y up.** IFC is Z up and glTF is Y up, and the geometry the Python converter in this repository writes is already Y up. A viewer must not have to ask which of the two it is looking at.

**The GlobalId survives.** It is the key a sensor is bound by, and it is the one identifier that survives a re-export. An object without one is counted as failed rather than returned, because nothing can be bound to it.

## It Does Not Write A GLB

Storing the result is the caller's decision and a different problem: the caller knows where its files live. The sibling package [`bim-glb-viewer`](../bim-glb-viewer) draws what comes out of here directly.

## The Python Converter Does This Too

[`ifc-converter`](../../python/ifc-converter) does the same job with IfcOpenShell, outside a browser. The two are deliberately independent implementations, and they run against the same files in [`fixtures/`](../../fixtures) so they can be compared.

Measured on the same models: they agree on object count exactly, this one is about nine times faster, and it produces about two per cent fewer triangles because some solids defeat its kernel. Use this one to look at a model now, and that one as the reference and for batches.

## Develop

```bash
npm install
npm run build     # inlines the parser, then compiles
npm test          # typecheck, then the suite against dist/ and real IFC files
```
