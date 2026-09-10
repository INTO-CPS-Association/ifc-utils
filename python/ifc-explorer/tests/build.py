"""A small model built in memory, for tests that need geometry.

Kept here rather than imported from the converter's tests, because a test suite
reaching across a package boundary makes two packages one. It is a few lines
and duplicating them is cheaper than the coupling.

Lengths are given in metres and IfcOpenShell writes the file's own unit, which
is the part that used to be got wrong: scaling by hand as well produced a model
a thousand times too large, and the error cancelled against a second one.
"""

import ifcopenshell
import ifcopenshell.api
import numpy as np

BOX_CORNERS = [
    (0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (1.0, 2.0, 0.0), (0.0, 2.0, 0.0),
    (0.0, 0.0, 3.0), (1.0, 0.0, 3.0), (1.0, 2.0, 3.0), (0.0, 2.0, 3.0),
]
BOX_FACES = [
    [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4],
    [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4],
]
PUMP_OFFSET = (2.0, 0.0, 0.5)


def run(model, command, **kwargs):
    return ifcopenshell.api.run(command, model, **kwargs)


def build_model(unit):
    """A pump and a sensor with geometry, in a file declaring `unit`."""
    model = ifcopenshell.file(schema="IFC4X3")
    run(model, "root.create_entity", ifc_class="IfcProject", name="Test")
    run(model, "unit.assign_unit", length={"is_metric": True, "raw": unit})

    parent = run(model, "context.add_context", context_type="Model")
    body = run(model, "context.add_context", context_type="Model",
               context_identifier="Body", target_view="MODEL_VIEW", parent=parent)

    for ifc_class, name, position in (("IfcPump", "P-1", PUMP_OFFSET),
                                      ("IfcSensor", "TS-01", (0.0, 0.0, 0.0))):
        product = run(model, "root.create_entity", ifc_class=ifc_class, name=name)
        representation = run(model, "geometry.add_mesh_representation",
                             context=body, vertices=[BOX_CORNERS], faces=[BOX_FACES])
        run(model, "geometry.assign_representation",
            product=product, representation=representation)
        placement = np.eye(4)
        placement[:3, 3] = position
        run(model, "geometry.edit_object_placement", product=product, matrix=placement)

    return model
