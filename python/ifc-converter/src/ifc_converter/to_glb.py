"""Turn an IFC file into a GLB the browser can draw.

A JSON form of the same geometry is readable, and it is
fine for the substation, which has ten objects and produces four kilobytes.
It does not survive a real building: `L187x_AK_v_done_v3b_processed.ifc` is
61 MB of IFC holding 10,505 objects, and every coordinate written as decimal
text costs around ten bytes instead of four.

GLB is the binary packaging of glTF, the format the DTaaS viewer expects. One
file, one JSON header describing the structure, one block of raw little-endian
numbers after it.

The part that matters for this project is that **the GlobalId survives**. The
viewer identifies a building object by its GlobalId, so each object is written
as its own glTF node and mesh carrying `extras.globalId`. Merging objects into
one big mesh would produce a smaller file and would destroy the binding.

Run it:

    python -m ifc_explorer.to_glb model.ifc model.glb

Exit codes match the rest of the package: 0 the file was written, 1 the model
could not be read, 2 the arguments were rejected.
"""

import json
import multiprocessing
import struct
import sys
from pathlib import Path

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.shape
import numpy as np

from ifc_explorer import explorer


# Objects the viewer must not draw. A space and a site are boxes that would
# hide everything inside them. An opening
# is a hole in a wall: it exists to be subtracted, and drawing it puts a
# solid block back where the window should be.
NOT_DRAWN = ("IfcSpace", "IfcSite", "IfcOpeningElement")

# glTF component types, from the specification. Named because 5126 in the
# middle of a dictionary says nothing.
FLOAT = 5126
UNSIGNED_SHORT = 5123
UNSIGNED_INT = 5125

ARRAY_BUFFER = 34962
ELEMENT_ARRAY_BUFFER = 34963

# An index fits in two bytes below this. Most IFC objects have a few hundred
# vertices, so the narrow type applies almost everywhere and halves the
# space the triangles take.
UINT16_LIMIT = 65536

# Past this many metres from the origin a 32-bit float can no longer resolve
# a millimetre: the gap between neighbouring floats at 8192 is 2^13 * 2^-23,
# which is exactly one millimetre, and it doubles from there. A model placed
# beyond it is moved back towards the origin, and the shift is recorded so
# nothing is lost. Both AU models need this: they are georeferenced, and
# L187x sits 1,227 km out.
FAR_FROM_ORIGIN = 8192.0

# IFC is Z-up, glTF is Y-up. Every object hangs under one root node carrying
# this rotation, so the building stands upright in any glTF viewer instead of
# lying on its side. It is a turn of -90 degrees about X, written as the
# sixteen column-major numbers glTF wants, and it maps (x, y, z) to (x, z, -y).
Z_UP_TO_Y_UP = [
    1.0, 0.0, 0.0, 0.0,
    0.0, 0.0, -1.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 1.0,
]


def shapes_of(model):
    """Yield the triangulated objects of a model, one at a time.

    IfcOpenShell's iterator is used rather than a `create_shape` call per
    product, because it triangulates on every core and hands back one
    finished object at a time. Nothing but the current object is ever held
    in memory, which is what makes a 61 MB model possible on a laptop.
    """
    settings = ifcopenshell.geom.settings()
    iterator = ifcopenshell.geom.iterator(
        settings, model, multiprocessing.cpu_count(), exclude=NOT_DRAWN
    )

    # initialize() returns False when the model has no geometry at all.
    if not iterator.initialize():
        return

    while True:
        yield iterator.get()
        if not iterator.next():
            return


def _add_block(blob, array):
    """Append an array to the binary blob and return where it starts.

    Every block is padded so the next one begins on a multiple of four. glTF
    requires an accessor to start on a multiple of its component size, and
    four is the largest of those, so padding to four satisfies all of them
    at once.
    """
    offset = len(blob)
    blob.extend(array.tobytes())

    while len(blob) % 4:
        blob.append(0)

    return offset


def _to_linear(channels):
    """Apply the standard sRGB transfer function to three channels.

    glTF stores a base colour in linear values, which is how light actually
    adds up, and both sources here give sRGB, which is how a colour is picked.
    The simple `value ** 2.2` approximation is wrong in the dark end, and the
    equipment colours are saturated enough for that to show.
    """
    linear = []
    for value in channels:
        if value <= 0.04045:
            linear.append(value / 12.92)
        else:
            linear.append(((value + 0.055) / 1.055) ** 2.4)
    return linear


# A colour per IFC class, used only when the model declares no surface style
# for an object. Substation equipment is the case: those files carry no
# IfcSurfaceStyle at all, so without this a plant room draws as one grey mass.
# Every building model here does declare its own styles and never reaches this.
COLOURS = {
    "IfcSensor": "#e03131",
    "IfcHeatExchanger": "#1971c2",
    "IfcPump": "#f08c00",
    "IfcValve": "#2f9e44",
    "IfcFlowMeter": "#e8b800",
}
DEFAULT_COLOUR = "#adb5bd"


def _colour_of(ifc_class):
    """Return the fallback glTF base colour of an IFC class, as linear RGBA.

    Used when the model declares no surface style for an object. The table is
    the substation equipment, which is the only family of models here that
    arrives with no styles at all.
    """
    hex_colour = COLOURS.get(ifc_class, DEFAULT_COLOUR).lstrip("#")
    channels = [int(hex_colour[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return _to_linear(channels) + [1.0]


def _model_style_of(shape):
    """Return the colour the model itself declares for a shape, or None.

    An IFC file can carry its own presentation: an architect assigns surface
    styles, and `IfcSurfaceStyleRendering` holds the resulting colour. The AU
    building models do this, and `2116_FEAS_kedelhuset` declares 17 distinct
    colours across its objects.

    Ignoring them is why an AU building used to draw as a uniform grey mass:
    the fallback table above holds five entries, all substation equipment, and
    a wall, a slab or a roof matched none of them. ProBIM looks correct on the
    same models because its OBJ export carries these styles through its `.mtl`
    file, so it draws the architect's own colours rather than its own opinion.

    Returns a (name, linear RGBA) pair, so equal styles can share one glTF
    material instead of one being written per object.
    """
    materials = getattr(shape.geometry, "materials", None) or []
    if not materials:
        return None

    style = materials[0]
    # IfcOpenShell hands back a placeholder called DefaultMaterial for an
    # object the model gives no style to. Treating it as a real style would
    # paint the whole substation one grey and throw away the equipment
    # colours, which is a regression this check exists to prevent.
    if getattr(style, "name", "") == "DefaultMaterial":
        return None

    diffuse = getattr(style, "diffuse", None)
    if diffuse is None:
        return None

    # The transparency an IFC style records is the inverse of glTF alpha:
    # 0 means fully opaque in IFC, 1 means fully opaque in glTF. It reads as
    # NaN when the style does not set one, and `has_transparency()` is the
    # only reliable way to tell, since NaN passes an `or 0.0` guard unharmed
    # and then poisons every arithmetic it touches.
    alpha = 1.0
    if style.has_transparency():
        alpha = 1.0 - float(style.transparency)

    colour = _to_linear([diffuse.r(), diffuse.g(), diffuse.b()]) + [alpha]

    # The style name is stable within a model, so it keys the material cache.
    return getattr(style, "name", None) or "style", colour


def _predefined_type_of(model, global_id):
    """Return an object's IFC PredefinedType, or an empty string.

    The triangulated shape the iterator hands back carries the class and the
    GlobalId but not the attributes, so the product is looked up again. It is
    a hash lookup on an index the model already keeps, not a second parse.

    Not every IFC class declares the attribute at all, and a file is free to
    leave it unset, so both cases come back as an empty string.
    """
    try:
        product = model.by_guid(global_id)
    except RuntimeError:
        return ""

    return getattr(product, "PredefinedType", None) or ""


def _shortest(value):
    """Return the shortest decimal that still reads back as the same float32.

    A float32 written in full is `-0.17499999701976776`, nineteen characters
    for a number the file already rounded to `-0.175`. The header holds six
    of these per object, so on a ten thousand object model the difference is
    megabytes of text. Every candidate is checked for equality in float32,
    so the value a viewer ends up with is bit for bit the one measured.
    """
    for digits in range(1, 9):
        candidate = float(f"{value:.{digits}g}")
        if np.float32(candidate) == value:
            return candidate

    return float(value)


def _node_matrix(matrix, scale):
    """Return an object's placement as sixteen glTF numbers.

    IfcOpenShell gives the placement already column-major, which is the order
    glTF uses, so only the units change. The first twelve numbers hold the
    rotation, which has no unit. The next three are the position, in the
    file's own length unit, and have to become metres. The last is the 1 that
    closes a homogeneous matrix.

    Keeping the placement here rather than baking it into the vertices is
    what keeps the coordinates small. `2116_FEAS_kedelhuset.ifc` is
    georeferenced, so its objects sit around 404,000 mm from the origin, and
    a 32-bit float cannot hold that with millimetre precision.

    Both are rounded, because IfcOpenShell reports a two degree turn as
    0.03479342425724875 and a building is not measured to seventeen digits.
    Nine decimals on a rotation is a nanometre of error across a hundred
    metre building, and six on a position is a micrometre.
    """
    numbers = list(matrix)
    rotation = [round(value, 9) for value in numbers[:12]]
    position = [round(value * scale, 6) for value in numbers[12:15]]

    return rotation + position + [numbers[15]]


# The matrix glTF assumes when a node does not give one. Writing it out
# anyway is valid but redundant, and the Khronos validator says so with
# NODE_MATRIX_DEFAULT.
IDENTITY_MATRIX = [
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 1.0, 0.0,
    0.0, 0.0, 0.0, 1.0,
]


def _drop_default_matrices(nodes):
    """Remove the placement from any node that is not actually placed.

    An object modelled at the origin with no rotation gets the identity
    matrix, and glTF treats that as the default, so stating it is noise. Five
    of the ten models here contain at least one such object.

    Run after _recentre rather than instead of a matrix, because recentring
    reads every node's position and a node with no matrix has none to read.
    """
    for node in nodes:
        if node.get("matrix") == IDENTITY_MATRIX:
            del node["matrix"]


def _recentre(nodes):
    """Move a far away model back towards the origin. Returns the shift.

    A georeferenced IFC file places its objects in a national coordinate
    system, kilometres or hundreds of kilometres from zero. Vertices are not
    affected, because each object keeps its own local coordinates, but any
    tool that flattens the node tree and bakes world positions into 32-bit
    floats, which is what the usual web optimisers do, would destroy the
    model at that distance.

    The shift is whole metres, so a coordinate keeps its decimals and stays
    easy to check by eye against the IFC file.
    """
    positions = [node["matrix"][12:15] for node in nodes]
    if not positions:
        return [0.0, 0.0, 0.0]

    middle = [
        (min(axis) + max(axis)) / 2
        for axis in zip(*positions)
    ]
    if all(abs(value) < FAR_FROM_ORIGIN for value in middle):
        return [0.0, 0.0, 0.0]

    shift = [float(round(value)) for value in middle]
    for node in nodes:
        for axis in range(3):
            node["matrix"][12 + axis] = round(
                node["matrix"][12 + axis] - shift[axis], 6
            )

    return shift


def _pack(gltf, blob):
    """Wrap the glTF header and the binary blob in the GLB container.

    The layout is fixed by the specification: a twelve byte file header, then
    the JSON chunk, then the binary chunk. Each chunk is padded to a multiple
    of four, the JSON with spaces so it stays valid JSON.
    """
    header = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    header += b" " * (-len(header) % 4)

    parts = [b"", struct.pack("<II", len(header), 0x4E4F534A), header]  # "JSON"

    # The binary chunk is optional, and a model with no geometry has nothing
    # to put in it. Writing an empty one instead would be a chunk the
    # specification does not describe.
    if blob:
        blob += b"\x00" * (-len(blob) % 4)
        parts += [struct.pack("<II", len(blob), 0x004E4942), bytes(blob)]  # "BIN"

    length = 12 + sum(len(part) for part in parts)
    parts[0] = struct.pack("<III", 0x46546C67, 2, length)  # "glTF", version 2

    return b"".join(parts)


def glb_from(model):
    """Build the GLB bytes for a whole model.

    Every drawable object becomes one mesh and one node. The node carries the
    placement and the name, the mesh carries the triangles, and both carry the
    GlobalId, because a consumer may reach for either one.
    """
    # The geometry scale, not the declared one: two models disagree
    # with their own header. See explorer.geometry_scale.
    scale = explorer.geometry_scale(model)

    blob = bytearray()
    accessors = []
    buffer_views = []
    meshes = []
    nodes = []
    materials = []
    material_of_class = {}

    for shape in shapes_of(model):
        vertices = ifcopenshell.util.shape.get_vertices(shape.geometry)
        faces = ifcopenshell.util.shape.get_faces(shape.geometry)

        # An object can declare a representation that triangulates to nothing.
        # An empty accessor is invalid glTF, so it is dropped instead.
        if len(vertices) == 0 or len(faces) == 0:
            continue

        positions = (vertices * scale).astype(np.float32)
        narrow = len(positions) < UINT16_LIMIT
        index_type = UNSIGNED_SHORT if narrow else UNSIGNED_INT
        indices = faces.astype(np.uint16 if narrow else np.uint32)

        position_view = len(buffer_views)
        buffer_views.append({
            "buffer": 0,
            "byteOffset": _add_block(blob, positions),
            "byteLength": positions.nbytes,
            "target": ARRAY_BUFFER,
        })
        buffer_views.append({
            "buffer": 0,
            "byteOffset": _add_block(blob, indices),
            "byteLength": indices.nbytes,
            "target": ELEMENT_ARRAY_BUFFER,
        })

        position_accessor = len(accessors)
        accessors.append({
            "bufferView": position_view,
            "componentType": FLOAT,
            "count": len(positions),
            "type": "VEC3",
            # min and max are required on a position accessor. A viewer uses
            # them to frame the model without reading the vertices.
            "min": [_shortest(value) for value in positions.min(axis=0)],
            "max": [_shortest(value) for value in positions.max(axis=0)],
        })
        accessors.append({
            "bufferView": position_view + 1,
            "componentType": index_type,
            "count": indices.size,
            "type": "SCALAR",
        })

        ifc_class = shape.type

        # The model's own surface style wins when it has one. An architect
        # assigned those colours, and they are what makes a building read as a
        # building rather than as a grey mass. The class table is the fallback
        # for models that carry no presentation, which is the case for the
        # generated substation.
        style = _model_style_of(shape)
        key, colour = style if style else (ifc_class, _colour_of(ifc_class))

        if key not in material_of_class:
            material_of_class[key] = len(materials)
            materials.append({
                "name": key,
                "pbrMetallicRoughness": {
                    "baseColorFactor": colour,
                    "metallicFactor": 0.0,
                    "roughnessFactor": 1.0,
                },
                # An IFC wall is a surface with a side, and a viewer walking
                # inside the building looks at its back. Culling that face
                # would make the room look open to the sky.
                "doubleSided": True,
            })
            # A style with alpha below one has to be marked, or glTF draws it
            # opaque and a window becomes a wall.
            if colour[3] < 1.0:
                materials[-1]["alphaMode"] = "BLEND"

        name = shape.name or "<unnamed>"
        identity = {"globalId": shape.guid, "ifcClass": ifc_class}

        # The predefined type is what separates a temperature sensor from a
        # pressure one, and the class alone does not say it. Only written when
        # the object declares one, because an empty string on every object of
        # a ten thousand object model is two hundred kilobytes of nothing.
        predefined_type = _predefined_type_of(model, shape.guid)
        if predefined_type:
            identity["predefinedType"] = predefined_type

        # The mesh is left unnamed: its node carries the name, and repeating
        # a Revit name like "Basic Wall:011001 Generisk Udv. Vaeg, 470mm" ten
        # thousand times costs more than it explains.
        meshes.append({
            "primitives": [{
                "attributes": {"POSITION": position_accessor},
                "indices": position_accessor + 1,
                "material": material_of_class[key],
            }],
            # No NORMAL attribute is written. glTF says a primitive without
            # normals is shaded flat, which is what triangulated IFC geometry
            # looks like anyway, and it keeps a third of the bytes out.
            "extras": identity,
        })
        nodes.append({
            "name": name,
            "mesh": len(meshes) - 1,
            "matrix": _node_matrix(shape.transformation.matrix, scale),
            "extras": identity,
        })

    shift = _recentre(nodes)
    _drop_default_matrices(nodes)

    # The root node is added last, so the object nodes keep the indices they
    # were given while the loop ran.
    root = len(nodes)
    nodes.append({
        "name": "IFC",
        "matrix": Z_UP_TO_Y_UP,
        "children": list(range(root)),
    })

    gltf = {
        "asset": {"version": "2.0", "generator": "ifc_explorer.to_glb"},
        "scene": 0,
        "scenes": [{
            "nodes": [root],
            "extras": {
                "schema": model.schema_identifier,
                "metreScale": scale,
                # Metres in the IFC axes, before the Z-up to Y-up rotation.
                # Add it back to a node position to recover the coordinate
                # the IFC file states.
                "originOffset": shift,
            },
        }],
        "nodes": nodes,
    }

    # glTF allows none of these arrays to be empty, so a model with no
    # geometry writes a scene holding its root node and nothing else.
    if meshes:
        gltf["meshes"] = meshes
        gltf["materials"] = materials
        gltf["accessors"] = accessors
        gltf["bufferViews"] = buffer_views
        gltf["buffers"] = [{"byteLength": len(blob)}]

    return _pack(gltf, blob)


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]

    if len(argv) < 2:
        print("Usage: python -m ifc_explorer.to_glb <file.ifc> <model.glb>",
              file=sys.stderr)
        return 2

    source = Path(argv[0]).expanduser().resolve()
    target = Path(argv[1]).expanduser().resolve()

    if not source.is_file() or source.suffix.lower() != ".ifc":
        print("Cannot run: expected an existing .ifc file", file=sys.stderr)
        return 2

    try:
        model = explorer.open_model(source)
    except Exception:
        # The parser message can name internal paths, so the user gets a
        # short generic line and nothing more.
        print("Cannot read the file as an IFC model", file=sys.stderr)
        return 1

    data = glb_from(model)

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)

    # Read back what was just written, so the numbers reported are the file's
    # own and not the builder's opinion of it.
    gltf, _ = read_glb(data)

    # A model with no geometry writes neither array, so both are optional.
    triangles = sum(
        accessor["count"] // 3
        for accessor in gltf.get("accessors", [])
        if accessor["type"] == "SCALAR"
    )
    size_kb = target.stat().st_size / 1024
    objects = len(gltf.get("meshes", []))
    print(f"{objects} objects, {triangles} triangles, {size_kb:.0f} KB")

    shift = gltf["scenes"][0]["extras"]["originOffset"]
    if any(shift):
        # Worth saying out loud: the coordinates in the file are no longer
        # the ones in the IFC.
        place = ", ".join(f"{value:.0f}" for value in shift)
        print(f"Moved to the origin from {place} m")

    return 0


def read_glb(data):
    """Split a GLB back into its glTF dictionary and its binary blob.

    A GLB is opaque once written, and the one thing this project cannot
    afford to get wrong is the GlobalId. This makes the file inspectable
    from a test or from a terminal, without a second library to read what
    the first one wrote.
    """
    magic, _, _ = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise ValueError("not a GLB file")

    header_length, kind = struct.unpack_from("<II", data, 12)
    if kind != 0x4E4F534A:
        raise ValueError("first GLB chunk is not JSON")
    gltf = json.loads(data[20:20 + header_length])

    # A model with no geometry has no binary chunk at all.
    blob_start = 20 + header_length
    if blob_start == len(data):
        return gltf, b""

    blob_length, kind = struct.unpack_from("<II", data, blob_start)
    if kind != 0x004E4942:
        raise ValueError("second GLB chunk is not binary")

    return gltf, data[blob_start + 8:blob_start + 8 + blob_length]


if __name__ == "__main__":
    sys.exit(main())
