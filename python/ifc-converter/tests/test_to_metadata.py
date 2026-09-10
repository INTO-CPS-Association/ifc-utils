"""Tests for the property tree writer.

The tree is what a viewer reads after a click, so the fields that matter are
the ones a click needs: what this object is, where it is, what it is attached
to, and what the model records about it.

Every model here is built in memory. Nothing reads a file from disk except
the tests that need a real path to hash.
"""

import hashlib
import json

import ifcopenshell
import pytest

from ifc_converter import to_metadata

SCHEMA = "IFC4X3_ADD2"


def _placement(model, point=(0.0, 0.0, 0.0)):
    return model.create_entity(
        "IfcLocalPlacement",
        RelativePlacement=model.create_entity(
            "IfcAxis2Placement3D",
            Location=model.create_entity("IfcCartesianPoint", Coordinates=point),
        ),
    )


@pytest.fixture
def model():
    """A basement with a heat exchanger, one sensor nested on it, and a pump
    contained in the storey directly.

    The two placements are the point: a nested element and a contained one
    reach their storey by different relationships, and only one of the two
    applies to any element.
    """
    model = ifcopenshell.file(schema=SCHEMA)
    model.create_entity("IfcProject", GlobalId="0project00000000000000", Name="Test")
    model.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Name="METRE")

    storey = model.create_entity(
        "IfcBuildingStorey", GlobalId="0storey000000000000000",
        Name="B1", Elevation=-3.0, ObjectPlacement=_placement(model),
    )

    exchanger = model.create_entity(
        "IfcHeatExchanger", GlobalId="0exchanger000000000000",
        Name="HX-1", PredefinedType="PLATE", ObjectPlacement=_placement(model),
    )
    sensor = model.create_entity(
        "IfcSensor", GlobalId="0sensor000000000000000",
        Name="TS-01", PredefinedType="TEMPERATURESENSOR",
        ObjectPlacement=_placement(model),
    )
    pump = model.create_entity(
        "IfcPump", GlobalId="0pump00000000000000000",
        Name="P-1", ObjectPlacement=_placement(model),
    )

    # The sensor hangs off the exchanger, so it has no storey of its own.
    model.create_entity(
        "IfcRelNests", GlobalId="0nests0000000000000000",
        RelatingObject=exchanger, RelatedObjects=[sensor],
    )
    # The exchanger and the pump sit in the storey directly.
    model.create_entity(
        "IfcRelContainedInSpatialStructure", GlobalId="0contains00000000000000"[:22],
        RelatingStructure=storey, RelatedElements=[exchanger, pump],
    )

    properties = model.create_entity(
        "IfcPropertySet", GlobalId="0pset00000000000000000", Name="SWiM_SensorMetadata",
        HasProperties=[
            model.create_entity(
                "IfcPropertySingleValue", Name="Unit",
                NominalValue=model.create_entity("IfcLabel", "celsius"),
            ),
        ],
    )
    model.create_entity(
        "IfcRelDefinesByProperties", GlobalId="0defines00000000000000",
        RelatedObjects=[sensor], RelatingPropertyDefinition=properties,
    )
    return model


class TestTheTree:
    def test_is_keyed_by_globalid(self, model):
        """The GLB carries the GlobalId and the manifest selects on it, so a
        viewer holding one must be able to look it up with no search."""
        tree = to_metadata.metadata_from(model, "model.ifc")

        assert "0sensor000000000000000" in tree["objects"]

    def test_records_what_an_object_is(self, model):
        entry = to_metadata.metadata_from(model, "model.ifc")["objects"]["0sensor000000000000000"]

        assert entry["name"] == "TS-01"
        assert entry["ifcClass"] == "IfcSensor"
        assert entry["predefinedType"] == "TEMPERATURESENSOR"

    def test_carries_the_property_sets_the_glb_drops(self, model):
        """The reason this file exists. The GLB keeps three fields per object
        and everything else has to live somewhere."""
        entry = to_metadata.metadata_from(model, "model.ifc")["objects"]["0sensor000000000000000"]

        assert entry["properties"]["SWiM_SensorMetadata"]["Unit"] == "celsius"

    def test_lists_the_storeys_with_their_elevations(self, model):
        tree = to_metadata.metadata_from(model, "model.ifc")

        assert tree["storeys"] == [{"name": "B1", "elevation_m": -3.0}]


class TestWhereThingsAre:
    """The part most likely to be wrong, because IFC answers it two ways."""

    def test_a_contained_element_finds_its_storey(self, model):
        tree = to_metadata.metadata_from(model, "model.ifc")

        assert tree["objects"]["0pump00000000000000000"]["storey"] == "B1"

    def test_a_nested_sensor_finds_its_storey_through_its_host(self, model):
        """A nested element is not also contained in a storey: in IFC an
        element has exactly one answer to where it is. Reading only
        ContainedInStructure would leave every sensor with no storey."""
        tree = to_metadata.metadata_from(model, "model.ifc")

        assert tree["objects"]["0sensor000000000000000"]["storey"] == "B1"

    def test_records_the_equipment_a_sensor_is_attached_to(self, model):
        """The relationship the GLB cannot carry and the manifest holds only
        as a comment."""
        tree = to_metadata.metadata_from(model, "model.ifc")

        assert tree["objects"]["0sensor000000000000000"]["host"] == "HX-1"

    def test_an_unattached_element_has_no_host(self, model):
        tree = to_metadata.metadata_from(model, "model.ifc")

        assert tree["objects"]["0pump00000000000000000"]["host"] is None


class TestProvenance:
    def test_records_the_hash_of_the_source(self, model, tmp_path):
        source = tmp_path / "model.ifc"
        model.write(str(source))

        tree = to_metadata.metadata_from(model, source)

        assert tree["model"]["source_sha256"] == hashlib.sha256(source.read_bytes()).hexdigest()

    def test_names_itself_not_the_manifest_generator(self, model):
        """Two generators write two different files. A reader who confuses
        them looks for fields that are not there."""
        tree = to_metadata.metadata_from(model, "model.ifc")

        assert tree["model"]["converter"].startswith("ifc_explorer.to_metadata")


class TestItIsAlwaysValidJson:
    def test_the_whole_tree_serialises(self, model):
        """An IFC property value can arrive as an entity instance, which json
        refuses. If that reaches the output the file is unreadable, and the
        failure appears in a browser rather than here."""
        tree = to_metadata.metadata_from(model, "model.ifc")

        assert json.loads(json.dumps(tree))["objects"]

    def test_an_entity_valued_property_becomes_text(self):
        """Better an imperfect value than a missing key or a crash."""
        assert isinstance(to_metadata._clean(ifcopenshell.file().createIfcLabel("x")), str)


class TestTheCommandLine:
    def test_rejects_a_missing_file(self, tmp_path, capsys):
        assert to_metadata.main([str(tmp_path / "nope.ifc"), str(tmp_path / "o.json")]) == 2
        assert "file not found" in capsys.readouterr().err

    def test_rejects_the_wrong_number_of_arguments(self, tmp_path):
        assert to_metadata.main([str(tmp_path)]) == 2

    def test_writes_a_readable_file(self, model, tmp_path):
        source = tmp_path / "model.ifc"
        model.write(str(source))
        destination = tmp_path / "out.json"

        assert to_metadata.main([str(source), str(destination)]) == 0
        assert json.loads(destination.read_text())["objects"]


def _guid(label):
    """A valid 22 character GlobalId built from a readable label.

    IFC fixes the length at 22, and hand-padding one in each test is where
    an off-by-one slips in unnoticed.
    """
    return (label + "0" * 22)[:22]


class TestTheThirdRouteToAStorey:
    """An element reaches its storey three ways, not two. Missing the third
    left 704 of the 1,273 objects in Building_Deli_AK_v1 with no storey: the
    members and plates that curtain walls and railings are assembled from."""

    @pytest.fixture
    def assembly_model(self):
        """A storey holding a curtain wall, itself made of one member.

        The member is contained in nothing and nested on nothing. Its only
        route to the storey is through the wall it decomposes.
        """
        model = ifcopenshell.file(schema=SCHEMA)
        model.create_entity("IfcProject", GlobalId=_guid("project"), Name="T")

        storey = model.create_entity(
            "IfcBuildingStorey", GlobalId=_guid("storey"), Name="L1")
        wall = model.create_entity(
            "IfcCurtainWall", GlobalId=_guid("wall"), Name="CW-1")
        member = model.create_entity(
            "IfcMember", GlobalId=_guid("member"), Name="M-1")

        model.create_entity(
            "IfcRelContainedInSpatialStructure", GlobalId=_guid("contains"),
            RelatingStructure=storey, RelatedElements=[wall])
        model.create_entity(
            "IfcRelAggregates", GlobalId=_guid("aggregates"),
            RelatingObject=wall, RelatedObjects=[member])
        return model

    def test_a_part_finds_its_storey_through_the_whole(self, assembly_model):
        tree = to_metadata.metadata_from(assembly_model, "m.ifc")

        assert tree["objects"][_guid("member")]["storey"] == "L1"

    def test_the_walk_stops_rather_than_recursing_forever(self, assembly_model):
        """A malformed model can relate two elements to each other. Without a
        limit that recurses until the interpreter gives up, which is a crash
        rather than a missing field."""
        a = assembly_model.create_entity("IfcMember", GlobalId=_guid("loopA"), Name="A")
        b = assembly_model.create_entity("IfcMember", GlobalId=_guid("loopB"), Name="B")
        assembly_model.create_entity(
            "IfcRelAggregates", GlobalId=_guid("cycle1"),
            RelatingObject=a, RelatedObjects=[b])
        assembly_model.create_entity(
            "IfcRelAggregates", GlobalId=_guid("cycle2"),
            RelatingObject=b, RelatedObjects=[a])

        assert to_metadata.storey_of(b) is None


class TestRooms:
    """Six of the ten models declare no IfcSpace and three do. An earlier
    draft of the specification said none did, from checking one model and
    generalising, so the room a reading belongs to is recorded and tested."""

    @pytest.fixture
    def room_model(self):
        model = ifcopenshell.file(schema=SCHEMA)
        model.create_entity("IfcProject", GlobalId=_guid("project"), Name="T")
        storey = model.create_entity(
            "IfcBuildingStorey", GlobalId=_guid("storey"), Name="L1")
        room = model.create_entity(
            "IfcSpace", GlobalId=_guid("space"), Name="204", LongName="Meeting")
        sensor = model.create_entity(
            "IfcSensor", GlobalId=_guid("sensor"), Name="TS-01",
            PredefinedType="TEMPERATURESENSOR")
        outside = model.create_entity(
            "IfcWall", GlobalId=_guid("wall"), Name="W-1")

        model.create_entity(
            "IfcRelAggregates", GlobalId=_guid("aggr"),
            RelatingObject=storey, RelatedObjects=[room])
        model.create_entity(
            "IfcRelContainedInSpatialStructure", GlobalId=_guid("inroom"),
            RelatingStructure=room, RelatedElements=[sensor])
        model.create_entity(
            "IfcRelContainedInSpatialStructure", GlobalId=_guid("instorey"),
            RelatingStructure=storey, RelatedElements=[outside])
        return model

    def test_an_element_in_a_room_records_it(self, room_model):
        tree = to_metadata.metadata_from(room_model, "m.ifc")

        assert tree["objects"][_guid("sensor")]["room"] == "204"

    def test_an_element_only_in_a_storey_has_no_room(self, room_model):
        """A wall in the storey but in no space must not borrow one."""
        tree = to_metadata.metadata_from(room_model, "m.ifc")

        assert tree["objects"][_guid("wall")]["room"] is None

    def test_the_rooms_are_listed(self, room_model):
        """The viewer offers room scope only when this list is not empty."""
        assert to_metadata.metadata_from(room_model, "m.ifc")["rooms"] == ["204"]

    def test_a_model_with_no_rooms_lists_none(self, model):
        assert to_metadata.metadata_from(model, "m.ifc")["rooms"] == []
