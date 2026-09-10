"""Tests for the GLB exporter.

Like the explorer tests, the models are built in memory, so the suite needs
no fixture file on disk. The same building is built twice, once in metres and
once in millimetres, because a unit bug in an exporter produces a model that
loads and is a thousand times too small rather than a crash.

Every check reads the GLB back from its bytes. Asserting on what the builder
was about to write would pass even if the container were malformed.
"""

import struct

import ifcopenshell
import ifcopenshell.api
import numpy as np
import pytest

from ifc_converter import to_glb

# A box, one by two by three metres, written as the corner list and the six
# quad faces that close it. Small enough to check an exported coordinate by
# eye, and asymmetric so a swapped axis shows up.
BOX_CORNERS = [
    (0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (1.0, 2.0, 0.0), (0.0, 2.0, 0.0),
    (0.0, 0.0, 3.0), (1.0, 0.0, 3.0), (1.0, 2.0, 3.0), (0.0, 2.0, 3.0),
]
BOX_FACES = [
    [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4],
    [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4],
]

# Where the pump sits relative to the rest of the building, in metres. Off
# the origin, so a test can tell a placement that was converted from one that
# was dropped.
PUMP_OFFSET = (2.0, 0.0, 0.5)


def run(model, command, **kwargs):
    """Small wrapper so the fixtures read as a list of modelling steps."""
    return ifcopenshell.api.run(command, model, **kwargs)


def add_box(model, context, product, position=(0.0, 0.0, 0.0)):
    """Give a product the box geometry, in metres.

    Metres whatever unit the model declares, because IfcOpenShell's authoring
    API takes metres and writes the file's own unit itself. Handing it
    millimetres for a millimetre model made it convert them a second time, and
    the resulting fixture was a two kilometre box that the exporter's own
    unit handling then shrank back to two metres. Two errors that cancelled,
    and between them they hid the fact that the geometry kernel already
    returns metres.
    """
    representation = run(
        model, "geometry.add_mesh_representation",
        context=context, vertices=[BOX_CORNERS], faces=[BOX_FACES],
    )
    run(model, "geometry.assign_representation",
        product=product, representation=representation)

    placement = np.eye(4)
    placement[:3, 3] = position
    run(model, "geometry.edit_object_placement", product=product, matrix=placement)


def build_model(unit, origin=(0.0, 0.0, 0.0)):
    """Build a small model: a pump and a sensor with geometry, plus a space.

    Args:
        unit: "METERS" or "MILLIMETERS". The unit the file declares. The
            building is the same size either way, which is the point: a
            millimetre model is the same box written in different numbers.
        origin: where the whole building stands, in metres. A georeferenced
            IFC file puts it hundreds of kilometres out.
    """
    pump_position = [origin[axis] + PUMP_OFFSET[axis] for axis in range(3)]

    model = ifcopenshell.file(schema="IFC4X3")
    run(model, "root.create_entity", ifc_class="IfcProject", name="Test")
    run(model, "unit.assign_unit", length={"is_metric": True, "raw": unit})

    parent = run(model, "context.add_context", context_type="Model")
    body = run(model, "context.add_context", context_type="Model",
               context_identifier="Body", target_view="MODEL_VIEW", parent=parent)

    pump = run(model, "root.create_entity", ifc_class="IfcPump", name="P-1")
    add_box(model, body, pump, pump_position)

    sensor = run(model, "root.create_entity", ifc_class="IfcSensor", name="TS-01")
    add_box(model, body, sensor, origin)

    # A space has geometry and must not reach the viewer, because it is a box
    # around a room that would hide the room.
    space = run(model, "root.create_entity", ifc_class="IfcSpace", name="Room")
    add_box(model, body, space, origin)

    # No geometry at all, so it must not become a mesh either.
    run(model, "root.create_entity", ifc_class="IfcBuildingStorey", name="L1")

    return model


@pytest.fixture
def model():
    """A model authored in metres."""
    return build_model("METERS")


@pytest.fixture
def model_in_millimetres():
    """The same building, authored in millimetres."""
    return build_model("MILLIMETERS")


@pytest.fixture
def exported(model):
    """The metre model, written to GLB and read back."""
    return to_glb.read_glb(to_glb.glb_from(model))


def meshes_by_name(gltf):
    """Return {object name: mesh}, following each node to its mesh."""
    return {
        node["name"]: gltf["meshes"][node["mesh"]]
        for node in gltf["nodes"] if "mesh" in node
    }


def positions_of(gltf, blob, mesh):
    """Read one mesh's vertices back out of the binary chunk, in metres."""
    accessor = gltf["accessors"][mesh["primitives"][0]["attributes"]["POSITION"]]
    view = gltf["bufferViews"][accessor["bufferView"]]

    return np.frombuffer(
        blob, dtype=np.float32, count=accessor["count"] * 3,
        offset=view["byteOffset"],
    ).reshape(-1, 3)


def indices_of(gltf, blob, mesh):
    """Read one mesh's triangle indices back out of the binary chunk."""
    accessor = gltf["accessors"][mesh["primitives"][0]["indices"]]
    view = gltf["bufferViews"][accessor["bufferView"]]
    dtype = np.uint16 if accessor["componentType"] == to_glb.UNSIGNED_SHORT else np.uint32

    return np.frombuffer(
        blob, dtype=dtype, count=accessor["count"], offset=view["byteOffset"]
    )


class TestContainer:
    def test_starts_with_the_glb_magic(self, model):
        # "glTF" as four little-endian bytes. A viewer refuses the file
        # without ever looking at the geometry if this is wrong.
        assert to_glb.glb_from(model)[:4] == b"glTF"

    def test_declares_its_own_length(self, model):
        data = to_glb.glb_from(model)
        assert struct.unpack_from("<I", data, 8)[0] == len(data)

    def test_declares_glTF_2(self, exported):
        gltf, _ = exported
        assert gltf["asset"]["version"] == "2.0"

    def test_the_buffer_matches_the_binary_chunk(self, exported):
        gltf, blob = exported
        assert gltf["buffers"][0]["byteLength"] == len(blob)

    def test_rejects_something_that_is_not_a_glb(self):
        with pytest.raises(ValueError):
            to_glb.read_glb(b"ISO-10303-21;" + b"\x00" * 32)


class TestGlobalId:
    """The GlobalId is how the viewer names a building object. If it does
    not survive the export, nothing downstream can bind to the geometry."""

    def test_every_mesh_carries_its_global_id(self, model, exported):
        gltf, _ = exported
        expected = {
            product.Name: product.GlobalId
            for product in model.by_type("IfcProduct") if product.Name
        }

        for name, mesh in meshes_by_name(gltf).items():
            assert mesh["extras"]["globalId"] == expected[name]

    def test_the_id_survives_the_round_trip_unchanged(self, model, exported):
        gltf, _ = exported
        exported_ids = {mesh["extras"]["globalId"] for mesh in gltf["meshes"]}

        drawn = {"P-1", "TS-01"}
        model_ids = {
            product.GlobalId
            for product in model.by_type("IfcProduct") if product.Name in drawn
        }
        assert exported_ids == model_ids

    def test_the_node_agrees_with_its_mesh(self, exported):
        gltf, _ = exported
        for node in gltf["nodes"]:
            if "mesh" in node:
                mesh = gltf["meshes"][node["mesh"]]
                assert node["extras"]["globalId"] == mesh["extras"]["globalId"]

    def test_the_ifc_class_travels_with_it(self, exported):
        gltf, _ = exported
        by_name = meshes_by_name(gltf)
        assert by_name["P-1"]["extras"]["ifcClass"] == "IfcPump"
        assert by_name["TS-01"]["extras"]["ifcClass"] == "IfcSensor"

    def test_the_predefined_type_travels_with_it(self, model):
        # The class says "sensor", the predefined type says which quantity it
        # measures, and the viewer shows both.
        sensor = next(p for p in model.by_type("IfcSensor"))
        sensor.PredefinedType = "TEMPERATURESENSOR"

        gltf, _ = to_glb.read_glb(to_glb.glb_from(model))
        assert meshes_by_name(gltf)["TS-01"]["extras"]["predefinedType"] == \
            "TEMPERATURESENSOR"

    def test_an_object_without_one_does_not_carry_the_key(self, exported):
        # The fixture leaves the attribute unset, and an empty string on every
        # object of a large model is bytes that say nothing.
        gltf, _ = exported
        assert "predefinedType" not in meshes_by_name(gltf)["P-1"]["extras"]


class TestWhatIsExported:
    def test_only_the_objects_with_geometry(self, exported):
        gltf, _ = exported
        assert sorted(meshes_by_name(gltf)) == ["P-1", "TS-01"]

    def test_a_space_is_left_out(self, exported):
        gltf, _ = exported
        # It has geometry, so it is skipped on purpose rather than by accident.
        assert "Room" not in meshes_by_name(gltf)

    def test_a_storey_is_left_out(self, exported):
        gltf, _ = exported
        assert "L1" not in meshes_by_name(gltf)

    def test_a_model_without_geometry_still_produces_a_file(self):
        empty = ifcopenshell.file(schema="IFC4X3")
        run(empty, "root.create_entity", ifc_class="IfcProject", name="Empty")
        run(empty, "unit.assign_unit", length={"is_metric": True, "raw": "METERS"})

        gltf, blob = to_glb.read_glb(to_glb.glb_from(empty))

        # The root node is still there, so the scene is valid glTF. The
        # arrays are absent rather than empty, because glTF allows none of
        # them to be empty, and there is no binary chunk to describe.
        assert len(gltf["nodes"]) == 1
        assert "meshes" not in gltf
        assert "buffers" not in gltf
        assert blob == b""


class TestUnits:
    def test_metres_arrive_unchanged(self, exported):
        gltf, blob = exported
        box = positions_of(gltf, blob, meshes_by_name(gltf)["P-1"])
        assert box.max(axis=0).tolist() == [1.0, 2.0, 3.0]

    def test_millimetres_come_back_in_metres(self, model_in_millimetres):
        # The file stores 3000. Without conversion the box would be three
        # kilometres tall, which is the bug this test exists to catch.
        gltf, blob = to_glb.read_glb(to_glb.glb_from(model_in_millimetres))
        box = positions_of(gltf, blob, meshes_by_name(gltf)["P-1"])
        assert box.max(axis=0).tolist() == [1.0, 2.0, 3.0]

    def test_both_units_give_the_same_vertices(self, model, model_in_millimetres):
        metres = to_glb.read_glb(to_glb.glb_from(model))
        millimetres = to_glb.read_glb(to_glb.glb_from(model_in_millimetres))

        for name in ("P-1", "TS-01"):
            in_metres = positions_of(*metres, meshes_by_name(metres[0])[name])
            in_millimetres = positions_of(
                *millimetres, meshes_by_name(millimetres[0])[name]
            )
            assert in_metres.tolist() == in_millimetres.tolist()

    def test_the_placement_is_converted_too(self, model, model_in_millimetres):
        # The vertices are local, so an object in the wrong place is a
        # separate bug from an object of the wrong size.
        for source in (model, model_in_millimetres):
            gltf, _ = to_glb.read_glb(to_glb.glb_from(source))
            node = next(n for n in gltf["nodes"] if n.get("name") == "P-1")
            assert node["matrix"][12:15] == list(PUMP_OFFSET)


class TestGeometry:
    def test_the_triangles_are_triangles(self, exported):
        gltf, blob = exported
        for mesh in gltf["meshes"]:
            assert len(indices_of(gltf, blob, mesh)) % 3 == 0

    def test_no_index_points_past_the_vertices(self, exported):
        gltf, blob = exported
        for mesh in gltf["meshes"]:
            assert indices_of(gltf, blob, mesh).max() < len(positions_of(gltf, blob, mesh))

    def test_a_box_becomes_twelve_triangles(self, exported):
        gltf, blob = exported
        # Six quads, two triangles each. A different number means the
        # triangulation lost or duplicated a face.
        assert len(indices_of(gltf, blob, meshes_by_name(gltf)["P-1"])) == 36

    def test_the_bounds_match_the_vertices(self, exported):
        gltf, blob = exported
        # A viewer frames the model from these without reading the vertices,
        # and they are shortened before being written, so they are checked
        # against what the binary chunk actually holds.
        for mesh in gltf["meshes"]:
            accessor = gltf["accessors"][mesh["primitives"][0]["attributes"]["POSITION"]]
            box = positions_of(gltf, blob, mesh)
            assert box.min(axis=0).tolist() == accessor["min"]
            assert box.max(axis=0).tolist() == accessor["max"]

    def test_every_buffer_view_is_aligned(self, exported):
        gltf, _ = exported
        # glTF requires an accessor to start on a multiple of its component
        # size, and four is the largest one used here.
        for view in gltf["bufferViews"]:
            assert view["byteOffset"] % 4 == 0


class TestScene:
    def test_one_node_per_mesh_under_one_root(self, exported):
        gltf, _ = exported
        root = gltf["nodes"][gltf["scenes"][0]["nodes"][0]]
        assert len(root["children"]) == len(gltf["meshes"])

    def test_the_root_turns_the_model_upright(self, exported):
        gltf, _ = exported
        root = gltf["nodes"][gltf["scenes"][0]["nodes"][0]]
        assert root["matrix"] == to_glb.Z_UP_TO_Y_UP

    def test_the_schema_travels_with_the_file(self, exported):
        gltf, _ = exported
        assert gltf["scenes"][0]["extras"]["schema"] == "IFC4X3_ADD2"

    def test_the_applied_scale_is_recorded(self, model_in_millimetres):
        """What the converter did to the geometry, not what the file declares.

        The kernel already returns metres for this model, so nothing further
        was applied and the honest record is 1.0. The declared unit is in the
        property tree, where it belongs, since a storey elevation is read from
        an attribute and does still need it.
        """
        gltf, _ = to_glb.read_glb(to_glb.glb_from(model_in_millimetres))
        assert gltf["scenes"][0]["extras"]["metreScale"] == 1.0


class TestMaterials:
    def test_one_material_per_ifc_class(self, exported):
        gltf, _ = exported
        names = [material["name"] for material in gltf["materials"]]
        assert sorted(names) == ["IfcPump", "IfcSensor"]

    def test_the_fallback_colour_is_written_as_linear(self, exported):
        gltf, _ = exported
        # glTF asks for a linear base colour and the table is written in sRGB,
        # so the transfer function has to be applied on the way out. Derived
        # from the table rather than restated: writing the numbers here made
        # this test fail the day the sensor colour changed, which told nobody
        # anything about the conversion, which is the part that can break.
        expected = to_glb._to_linear(
            [int(to_glb.COLOURS["IfcSensor"].lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        )

        sensor = next(m for m in gltf["materials"] if m["name"] == "IfcSensor")
        red, green, blue, alpha = sensor["pbrMetallicRoughness"]["baseColorFactor"]

        assert [round(v, 6) for v in (red, green, blue)] == [round(v, 6) for v in expected]
        assert alpha == 1.0

    def test_the_fallback_is_not_the_raw_srgb_value(self, exported):
        # The guard on the test above. Deriving the expected value from the
        # same table would also pass if the conversion were dropped from both
        # sides, so this states the one thing that must not be true.
        gltf, _ = exported
        sensor = next(m for m in gltf["materials"] if m["name"] == "IfcSensor")
        raw = int(to_glb.COLOURS["IfcSensor"].lstrip("#")[0:2], 16) / 255

        assert round(sensor["pbrMetallicRoughness"]["baseColorFactor"][0], 3) != round(raw, 3)

    def test_surfaces_are_drawn_from_both_sides(self, exported):
        gltf, _ = exported
        # A viewer standing inside a room looks at the back of its walls.
        assert all(material["doubleSided"] for material in gltf["materials"])

    def test_every_primitive_points_at_a_real_material(self, exported):
        gltf, _ = exported
        for mesh in gltf["meshes"]:
            assert mesh["primitives"][0]["material"] < len(gltf["materials"])


class TestFarFromOrigin:
    """Both AU models are georeferenced. L187x places its objects 1,227 km
    from zero, which no 32-bit float can hold to the millimetre."""

    def test_a_nearby_model_is_left_where_it_is(self, exported):
        gltf, _ = exported
        assert gltf["scenes"][0]["extras"]["originOffset"] == [0.0, 0.0, 0.0]

    def test_a_distant_model_is_moved_back(self):
        far = build_model("METERS", origin=(412837.0, 1227421.0, 59.0))
        gltf, _ = to_glb.read_glb(to_glb.glb_from(far))

        assert gltf["scenes"][0]["extras"]["originOffset"] != [0.0, 0.0, 0.0]
        for node in gltf["nodes"]:
            if "mesh" in node:
                assert max(abs(v) for v in node["matrix"][12:15]) < to_glb.FAR_FROM_ORIGIN

    def test_the_shift_recovers_the_original_position(self):
        origin = (412837.0, 1227421.0, 59.0)
        far = build_model("METERS", origin=origin)
        gltf, _ = to_glb.read_glb(to_glb.glb_from(far))

        # Adding the offset back gives the coordinate the IFC file states,
        # so the georeferencing is moved aside rather than thrown away.
        shift = gltf["scenes"][0]["extras"]["originOffset"]
        node = next(n for n in gltf["nodes"] if n.get("name") == "P-1")
        recovered = [node["matrix"][12 + axis] + shift[axis] for axis in range(3)]
        assert recovered == [origin[axis] + PUMP_OFFSET[axis] for axis in range(3)]


class TestCommandLine:
    def test_no_arguments_is_rejected(self, capsys):
        assert to_glb.main([]) == 2

    def test_a_missing_file_is_rejected(self, tmp_path, capsys):
        target = tmp_path / "out.glb"
        assert to_glb.main([str(tmp_path / "nothing.ifc"), str(target)]) == 2

    def test_a_file_that_is_not_ifc_is_rejected(self, tmp_path, capsys):
        source = tmp_path / "model.txt"
        source.write_text("not a model")
        assert to_glb.main([str(source), str(tmp_path / "out.glb")]) == 2

    # IfcOpenShell 0.8.5 raises a KeyError from its own file.__del__ when a
    # parse fails, which pytest reports as an unraisable exception. It is an
    # upstream teardown detail and says nothing about the exit code.
    @pytest.mark.filterwarnings("ignore::pytest.PytestUnraisableExceptionWarning")
    def test_unreadable_ifc_reports_a_read_error(self, tmp_path, capsys):
        source = tmp_path / "broken.ifc"
        source.write_text("this is not a STEP file")
        assert to_glb.main([str(source), str(tmp_path / "out.glb")]) == 1

    def test_a_good_run_writes_the_file(self, model, tmp_path, capsys):
        source = tmp_path / "model.ifc"
        model.write(str(source))
        target = tmp_path / "scene" / "model.glb"

        assert to_glb.main([str(source), str(target)]) == 0
        # The parent directory did not exist, so this also covers the
        # exporter creating it.
        assert target.read_bytes()[:4] == b"glTF"
        assert "2 objects" in capsys.readouterr().out


class TestDefaultMatrices:
    """glTF assumes the identity matrix when a node gives none, so writing it
    out is redundant. The Khronos validator reports it as NODE_MATRIX_DEFAULT,
    and five of the ten project models contained at least one such object.

    build_model puts the sensor at the origin and the pump offset from it, so
    one model exercises both halves.
    """

    def test_an_unplaced_object_gets_no_matrix(self, exported):
        gltf, _ = exported
        sensor = next(n for n in gltf["nodes"] if n.get("name") == "TS-01")

        assert "matrix" not in sensor

    def test_a_placed_object_keeps_its_matrix(self, exported):
        """The other half, and the one that matters. Dropping a real placement
        would stack every object at the origin, which still renders and still
        looks like a building."""
        gltf, _ = exported
        pump = next(n for n in gltf["nodes"] if n.get("name") == "P-1")

        assert "matrix" in pump
        assert pump["matrix"][12:15] == [round(v, 6) for v in PUMP_OFFSET]


class TestModelSurfaceStyles:
    """An IFC file can carry its own colours, and they win over the class
    table. Ignoring them is why an AU building drew as a uniform grey mass:
    the table holds five entries, all substation equipment, so a wall, a slab
    and a roof all fell through to the same default."""

    def test_the_class_table_still_applies_with_no_authored_style(self, exported):
        """The generated substation declares no surface styles. IfcOpenShell
        hands back a placeholder named DefaultMaterial for such an object, and
        treating that as a real style would paint every piece of equipment one
        grey."""
        gltf, _ = exported
        names = {m["name"] for m in gltf["materials"]}

        assert "IfcPump" in names
        assert "DefaultMaterial" not in names

    def test_no_colour_channel_is_nan(self, exported):
        """IfcOpenShell reports transparency as NaN when a style sets none.
        NaN passes an `or 0.0` guard unharmed and then poisons the alpha, and
        a NaN in a colour is invalid glTF."""
        gltf, _ = exported

        for material in gltf["materials"]:
            for channel in material["pbrMetallicRoughness"]["baseColorFactor"]:
                assert channel == channel, f"NaN in {material['name']}"
                assert 0.0 <= channel <= 1.0
