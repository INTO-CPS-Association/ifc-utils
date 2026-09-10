# ifc-converter

Convert an IFC model into files a viewer can read: GLB geometry, a property tree keyed by GlobalId, and the binding manifest that ties a sensor to an object in the model.

Reading and reporting on a model is [`ifc-explorer`](../ifc-explorer), which this depends on and installs with it.

## Install

```bash
pip install ifc-converter
```

## Use

```bash
ifc-to-glb model.ifc model.glb            # geometry
ifc-to-metadata model.ifc model.json      # the property tree
ifc-to-manifest model.ifc model.yaml      # the binding manifest
```

## What Comes Out

**The GlobalId survives.** Each object becomes its own glTF node and mesh carrying `globalId` in `extras`, because that is the key the viewer binds a sensor by, and it is the one identifier that survives a re-export. Merging objects would produce a smaller file and destroy the binding.

**Provenance is recorded.** Every derived file carries the source file name, its SHA-256 and the converter version. Without those there is no way to tell whether a stale artifact still describes the model beside it: a re-export keeps the file name and changes every GlobalId inside.

## The Browser Does This Too

[`@into-cps-association/bim-ifc-converter`](../../packages/bim-ifc-converter) converts in a browser, using web-ifc compiled to WebAssembly. The two are deliberately independent implementations of one job, and they run against the same files in [`fixtures/`](../../fixtures) so they can be compared.

Measured on the same models: they agree on object count exactly, the browser is about nine times faster, and it produces about two per cent fewer triangles because some solids defeat its kernel. Use the browser one to look at a model now, and this one as the reference and for batches.
