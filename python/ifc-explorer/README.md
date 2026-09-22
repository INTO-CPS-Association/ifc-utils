# ifc-explorer

Read an IFC model and answer simple questions about it.

Nothing here writes a file. Producing geometry, a property tree or a manifest is [`ifc-converter`](../ifc-converter), which depends on this.

## Install

The package is not published on PyPI, so it is installed from this repository, from its root. Do not `pip install ifc-explorer` from PyPI: the name is not registered there, and whatever is registered under it later is not this package.

```bash
pip install -e python/ifc-explorer
```

## Use

```bash
ifc-explorer model.ifc              # schema, object counts, storeys
ifc-explorer model.ifc IfcSensor    # one class, with its property sets
```

```python
from ifc_explorer import explorer

model = explorer.open_model("model.ifc")
explorer.summary(model)          # schema, object count, declared unit
explorer.storeys(model)          # floors, lowest first, in metres
explorer.count_by_class(model)   # what the file actually holds
explorer.sensors_in(model)       # empty on IFC2X3 instead of raising
```

## The Part Worth Knowing

**An IFC file declares its own units, and it does not have to be metres.** A file may also disagree with itself, declaring millimetres while carrying geometry already in metres.

`metre_scale(model)` reports the unit the file declares, which is right for a value read from an attribute such as a storey elevation.

`geometry_scale(model)` reports what the geometry kernel actually did, which is right for vertices. It measures instead of assumes: it compares an object's position as the kernel computed it against the same position read straight out of the file, and their ratio is exactly the conversion that was applied.

Guessing this wrong scales a model by a thousand and raises no error. A washbasin came out six tenths of a millimetre across before this was measured.
