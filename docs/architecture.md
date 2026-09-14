# Architecture

What these packages are, where each piece runs, and why the seams are where they are.

## The Problem

A building model says where things are. A sensor stream says what they measure. Nothing in either says which reading belongs to which wall.

Three things have to happen for a person to see a temperature on the right room: an IFC file has to become geometry a browser can draw, a declaration has to tie each sensor to an object in that geometry, and readings have to arrive. Each is a different problem with a different lifetime, so each is a different package.

## The Four Packages

```
                    an IFC file
                         |
        +----------------+----------------+
        |                                 |
  ifc-converter                    bim-kit/converter
  Python, IfcOpenShell             browser, web-ifc in WebAssembly
  a machine, in batches            the machine looking at the model
        |                                 |
        +----------------+----------------+
                         |
              geometry + property tree
                         |
                    a manifest              readings
                         |                     |
                         +----------+----------+
                                    |
                            bim-kit
                            browser, three.js
```

`ifc-explorer` sits under the Python converter: it reads a model and answers questions about it, and writes nothing.

## Why Two Converters

They do the same job in different places, which is deliberate instead of accidental duplication.

The **browser one** exists so a platform needs no conversion service. A person opens a model and it is converted on the machine that is looking at it. Nothing is installed, nothing is deployed, and an air-gapped install works because the WebAssembly parser travels inside the package.

The **Python one** is the reference and the batch tool. It is more faithful, it runs over a directory of models without a browser, and it is what says whether the other is right.

They run against the same files in [`../fixtures`](../fixtures), because two implementations of one job are only comparable if they are asked the same questions. Measured on the same models: they agree on object count exactly, the browser one is about nine times faster, and it produces about two per cent fewer triangles because some solids defeat its kernel.

Choose the browser one to look at a model now. Choose the Python one to prepare many, or when fidelity matters more than speed.

## The Manifest Is The Contract

The manifest is the load-bearing piece. If its schema is right, the conversion, the viewer and the transport can each be replaced without touching the others.

```yaml
model:
  source: model.ifc
  source_sha256: 60b1b94e...
  converter: ifc_converter.to_manifest 0.1.0
bindings:
  - selector: { globalId: 1yETHMphv6LwABqR4Pbs5g }
    label: Room 204 temperature
    source:
      live: { transport: mqtt, topic: building/204/temp }
      history: { bucket: readings, measurement: temperature }
    display: { unit: "°C", ramp: [18, 26] }
```

**The binding key is the IFC GlobalId.** It survives a re-export and a mesh name does not. A selector may instead name a `nodeName` or an `expressId`, so a non-IFC asset reuses the same manifest, but exactly one form must be given: two would leave the resolver choosing, and a manifest should not depend on which it chose.

**Provenance is required.** Without the source hash there is no way to tell whether a derived file still describes the model beside it, because a re-export keeps the file name and changes every GlobalId inside.

## Where Sensor Positions Come From

**The model.** A binding names an object by GlobalId, and the marker is drawn at that object. Nothing carries a coordinate, and that is on purpose: a coordinate written into a manifest is wrong the moment the model moves, while a GlobalId still points at the same wall.

When a model declares its own sensors, as `IfcSensor` elements, the manifest is generated from it and every position is the model's own. When a model declares none, which is the ordinary case for an architectural discipline model, a person writes the manifest and still names objects instead of coordinates.

## Two Ways Readings Arrive

Both are supported, and a manifest declares both halves separately because they answer different questions.

**Live, straight from the broker.** The browser subscribes over WebSocket and paints the current value on the marker. Nothing is stored, nothing is running when the page is closed, and there is no history. This is `source.live`.

**Through an agent and a database.** A service subscribes, validates and writes to a time series database, and the viewer reads from there. This survives a closed page, gives history, and is how a platform serves many viewers from one subscription. This is `source.history`.

Neither replaces the other. The live half puts a number on a marker now; the history half is the panel behind a click. Charting is not reimplemented inside the 3D view.

## What Is Deliberately Absent

**No renderer in the core.** The manifest logic, the selector resolver and the colour ramp import nothing, so they run in Node, in jsdom and in a browser alike. A host's unit tests usually have no WebGL, and everything testable without a canvas is kept where it can be tested.

**No IFC in the viewer.** The viewer draws geometry and reads a manifest. It never parses IFC. Conversion is a separate package it reaches through a dynamic import, so a consumer who only opens converted models never downloads a parser.

**No transport in the viewer.** Values are pushed in. The viewer does not know whether they came from a broker, a database or a test.

**No project's conventions in a package.** A topic prefix, a property set name and a database bucket are all things one deployment chose. They are parameters with neutral defaults, never constants, because a converter that stamps one project's names on every model works for that project and no other.
