"""Turn an IFC file into a scene the browser can draw.

A web page cannot open an IFC file. IFC is text, and a real building model is
tens of megabytes of it. So the geometry is extracted once, here, and written
as a small JSON file that the viewer loads.

For a large building this step would produce GLB, which is binary and much
smaller. JSON is used here because the substation has eleven objects, and a
format you can open and read is worth more than a compact one while the
pipeline is being agreed.

Run it:

    python -m ifc_explorer.to_scene model.ifc scene.json
"""

import json
import sys
from pathlib import Path

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element

from ifc_explorer import explorer

# A colour per IFC class, so a person can tell equipment apart without
# reading a single label.
COLOURS = {
    "IfcSensor": "#e03131",
    "IfcHeatExchanger": "#1971c2",
    "IfcPump": "#f08c00",
    "IfcValve": "#2f9e44",
    "IfcFlowMeter": "#e8b800",
}
DEFAULT_COLOUR = "#adb5bd"


def place(shape, scale):
    """Return the vertices in building coordinates, in metres.

    IfcOpenShell hands back two things: `geometry.verts`, which are local to
    the object, and `transformation.matrix`, which says where that object sits
    in the building. Writing the vertices without the matrix puts every object
    at the origin, which looks plausible on a model whose placements happen to
    be near identity and is wrong on every real one.

    The matrix is 4x4 and column-major, so it arrives as sixteen numbers laid
    out column by column. Rotation is in the first three columns and the
    translation in the fourth, at indices 12, 13 and 14.
    """
    m = shape.transformation.matrix
    verts = shape.geometry.verts

    placed = []
    for i in range(0, len(verts), 3):
        x, y, z = verts[i], verts[i + 1], verts[i + 2]
        placed.append(round((m[0] * x + m[4] * y + m[8] * z + m[12]) * scale, 4))
        placed.append(round((m[1] * x + m[5] * y + m[9] * z + m[13]) * scale, 4))
        placed.append(round((m[2] * x + m[6] * y + m[10] * z + m[14]) * scale, 4))
    return placed


def scene_from(model):
    """Extract every object that has geometry, as triangles.

    Each object becomes one entry with its vertices and its triangle indices,
    which is exactly what a 3D library needs and nothing more.
    """
    settings = ifcopenshell.geom.settings()
    # The geometry scale, not the declared one: two models disagree
    # with their own header. See explorer.geometry_scale.
    scale = explorer.geometry_scale(model)

    objects = []
    for product in model.by_type("IfcProduct"):
        # No representation means nothing to draw: a storey, a system, a site.
        if not product.Representation:
            continue

        # A spatial container is a box that would hide everything inside it.
        if product.is_a("IfcSpace") or product.is_a("IfcSite"):
            continue

        try:
            shape = ifcopenshell.geom.create_shape(settings, product)
        except RuntimeError:
            # Some products declare a representation the kernel cannot build.
            # Skipping one object is better than losing the whole scene.
            continue

        ifc_class = product.is_a()
        objects.append({
            "name": product.Name or "<unnamed>",
            "class": ifc_class,
            "type": getattr(product, "PredefinedType", None) or "",
            "globalId": product.GlobalId,
            "colour": COLOURS.get(ifc_class, DEFAULT_COLOUR),
            # Vertices arrive flat as x, y, z, x, y, z, and in the object's
            # own local coordinates. Where the object sits in the building is
            # a separate matrix, so it has to be applied here or every object
            # lands on top of the others at the origin.
            "vertices": place(shape, scale),
            "triangles": list(shape.geometry.faces),
        })

    return {
        "schema": model.schema_identifier,
        "metreScale": scale,
        "objects": objects,
    }


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]

    if len(argv) < 2:
        print("Usage: python -m ifc_explorer.to_scene <file.ifc> <scene.json>",
              file=sys.stderr)
        return 2

    source = Path(argv[0]).expanduser().resolve()
    target = Path(argv[1]).expanduser().resolve()

    if not source.is_file() or source.suffix.lower() != ".ifc":
        print("Cannot run: expected an existing .ifc file", file=sys.stderr)
        return 2

    model = explorer.open_model(source)
    scene = scene_from(model)

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(scene))

    triangles = sum(len(o["triangles"]) // 3 for o in scene["objects"])
    size_kb = target.stat().st_size / 1024
    print(f"{len(scene['objects'])} objects, {triangles} triangles, {size_kb:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
