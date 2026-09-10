"""Write the property tree of an IFC model as JSON.

This is the `model.json` that DTaaS issue 1762 asks for beside the GLB:
"IFC in, viewable artifact plus property tree out".

Two different JSON files are easy to confuse, and they are not the same thing:

    the JSON inside the GLB    the glTF structure. Nodes, meshes, accessors,
                               byte offsets. It answers "how do I draw this".
                               Written by to_glb.py, and every glTF file has
                               one because it is what glTF is.

    this file, model.json      the property tree. What each object is, which
                               storey contains it, what equipment it is
                               nested on, and its property sets. It answers
                               "what am I looking at".

The GLB deliberately carries only three fields per object, because putting a
building's worth of properties into geometry a browser has to parse would
defeat the point of converting. This file is where the rest goes, and a
viewer loads it only when someone clicks something.

It is not the manifest either. The manifest binds a few sensors to live data
and a person edits it. This is generated, covers every object, and nobody
edits it by hand.

Run it:

    python -m ifc_explorer.to_metadata model.ifc model.json

Exit codes match the rest of the package: 0 the file was written, 1 the model
could not be read, 2 the arguments were rejected.
"""

import json
import sys
from pathlib import Path

import ifcopenshell.util.element

from ifc_explorer import explorer

from .to_manifest import CONVERTER_VERSION

CONVERTER = "ifc_explorer.to_metadata"

# Kept out of the tree. A space and a site are containers the viewer does not
# draw, so an entry describing one would point at geometry that is not there.
NOT_INCLUDED = ("IfcOpeningElement",)


def _clean(value):
    """Return a property value JSON can hold, or None.

    IfcOpenShell hands back plain Python for most property values, but a
    select type arrives as an entity instance, which json cannot serialise.
    Those become their string form instead of being dropped, because a
    reader is better served by an imperfect value than by a missing key.
    """
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (list, tuple)):
        return [_clean(item) for item in value]
    return str(value)


def properties_of(element):
    """Return the property sets of one element, as plain JSON types.

    The `id` IfcOpenShell adds to each set is dropped: it is an internal
    entity number that changes on every re-export, and keeping it would
    invite someone to use it as an identifier. The GlobalId is the identifier.
    """
    psets = {}
    for name, values in ifcopenshell.util.element.get_psets(element).items():
        psets[name] = {k: _clean(v) for k, v in values.items() if k != "id"}
    return psets


# A curtain wall made of members and plates can nest a few levels deep. The
# limit stops a malformed model with a relationship cycle from recursing until
# the interpreter gives up, and no real building is this deep.
MAX_PARENT_HOPS = 12


def storey_of(element, hops=0):
    """Return the name of the storey containing an element, or None.

    An element reaches its storey by one of three routes, and exactly one of
    them applies to any given element, because in IFC an element has one
    answer to where it is.

        ContainedInStructure   a wall sits in a storey directly
        Nests                  a sensor is a component of equipment, so its
                               answer is "on the heat exchanger" and the
                               storey comes from the host
        Decomposes             a mullion is part of a curtain wall, so its
                               answer is "part of that wall"

    Missing the third route left 704 of the 1,273 objects in
    `Building_Deli_AK_v1` with no storey: 499 members and 169 plates, which
    are the pieces curtain walls and railings are assembled from.
    """
    if hops > MAX_PARENT_HOPS:
        return None

    for relation in getattr(element, "ContainedInStructure", None) or []:
        structure = relation.RelatingStructure
        if structure.is_a("IfcBuildingStorey"):
            return structure.Name

    for relation in getattr(element, "Nests", None) or []:
        return storey_of(relation.RelatingObject, hops + 1)

    for relation in getattr(element, "Decomposes", None) or []:
        whole = relation.RelatingObject
        # An element decomposed directly by a storey is in that storey. This
        # is how IfcBuildingStorey relates to a building, so it also stops the
        # walk from climbing past the storey into the site.
        if whole.is_a("IfcBuildingStorey"):
            return whole.Name
        return storey_of(whole, hops + 1)

    return None


def room_of(element, hops=0):
    """Return the name of the space containing an element, or None.

    A room is `IfcSpace`, and an element reaches one the same three ways it
    reaches a storey: contained in it, nested on something that is, or part of
    something that is.

    Not every model declares rooms, and the difference matters more than it
    looks. `Building_1911_AK_v2` declares 102 and `2116_FEAS_kedelhuset` 72,
    while six of the ten declare none at all. A room is the zone a person
    thinks in, so where one exists a reading can be attributed to it, and
    where none exists the storey is the finest zone the model supports.
    """
    if hops > MAX_PARENT_HOPS:
        return None

    for relation in getattr(element, "ContainedInStructure", None) or []:
        structure = relation.RelatingStructure
        if structure.is_a("IfcSpace"):
            return structure.Name or structure.LongName

    for relation in getattr(element, "Nests", None) or []:
        return room_of(relation.RelatingObject, hops + 1)

    for relation in getattr(element, "Decomposes", None) or []:
        whole = relation.RelatingObject
        if whole.is_a("IfcSpace"):
            return whole.Name or whole.LongName
        if whole.is_a("IfcBuildingStorey"):
            return None
        return room_of(whole, hops + 1)

    return None


def host_name_of(element):
    """Return the name of the equipment this element is nested on, or None.

    A label instead of the entity, because this file is read by a viewer that
    wants something to print. The relationship itself is resolved once, in
    `explorer.host_of`.
    """
    host = explorer.host_of(element)
    if host is None:
        return None
    return host.Name or host.GlobalId


def entry_for(element):
    """Build the tree entry for one element, keyed by GlobalId elsewhere."""
    return {
        "name": element.Name,
        "ifcClass": element.is_a(),
        "predefinedType": getattr(element, "PredefinedType", None) or "",
        "storey": storey_of(element),
        "room": room_of(element),
        "host": host_name_of(element),
        "properties": properties_of(element),
    }


def _spaces(model):
    """The rooms a model declares, or nothing when its schema has none."""
    try:
        return model.by_type("IfcSpace")
    except RuntimeError:
        return []


def metadata_from(model, source_path):
    """Build the whole property tree for a model.

    Keyed by GlobalId, because that is the key the GLB carries and the
    manifest selects on. A viewer holding a GlobalId from a click can look
    up this file directly, with no search.
    """
    objects = {}
    for element in model.by_type("IfcProduct"):
        if element.is_a() in NOT_INCLUDED or not element.GlobalId:
            continue
        objects[element.GlobalId] = entry_for(element)

    return {
        "model": {
            "source": str(source_path),
            # The same provenance the manifest carries, for the same reason:
            # this file is derived, and nothing else in it says from which
            # version of the model.
            "source_sha256": explorer.file_digest(source_path),
            "converter": f"{CONVERTER} {CONVERTER_VERSION}",
            "schema": explorer.summary(model)["schema"],
            "metre_scale": explorer.metre_scale(model),
        },
        "storeys": [
            {"name": s["name"], "elevation_m": s["elevation"]}
            for s in explorer.storeys(model)
        ],
        # The rooms the model declares, in the order it lists them. Empty for
        # the six models that declare none, which is a fact about those files
        # instead of a gap here.
        "rooms": sorted({
            space.Name or space.LongName
            for space in _spaces(model)
            if space.Name or space.LongName
        }),
        "objects": objects,
    }


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv

    if len(argv) != 2:
        print("Usage: python -m ifc_explorer.to_metadata <file.ifc> <out.json>",
              file=sys.stderr)
        return 2

    source, destination = Path(argv[0]), Path(argv[1])
    if not source.is_file():
        print(f"file not found: {source}", file=sys.stderr)
        return 2

    try:
        model = explorer.open_model(source)
    except Exception as error:
        print(f"could not read {source.name} as IFC: {error}", file=sys.stderr)
        return 1

    metadata = metadata_from(model, source.resolve())
    destination.write_text(json.dumps(metadata, indent=2, ensure_ascii=False))

    with_properties = sum(1 for o in metadata["objects"].values() if o["properties"])
    size_kb = destination.stat().st_size // 1024
    print(f"{len(metadata['objects'])} objects, {with_properties} with property sets, "
          f"{size_kb} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
