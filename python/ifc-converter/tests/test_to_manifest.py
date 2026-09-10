"""Tests for the manifest generator.

The model is built in memory, so the suite needs no fixture file and states
exactly what the generator depends on.
"""

import hashlib

import ifcopenshell
import ifcopenshell.api
import pytest
import yaml

from ifc_converter import to_manifest
from ifc_explorer import explorer


def run(model, command, **kwargs):
    return ifcopenshell.api.run(command, model, **kwargs)


@pytest.fixture
def model():
    """A substation: one heat exchanger with three sensors nested on it.

    Only TS-01 carries a recorded MQTT topic, so a test can tell the two paths
    apart: reusing what the model says, and building a topic from the naming
    scheme when it says nothing.
    """
    model = ifcopenshell.file(schema="IFC4X3")

    project = run(model, "root.create_entity", ifc_class="IfcProject", name="Test")
    run(model, "unit.assign_unit", length={"is_metric": True, "raw": "METERS"})

    site = run(model, "root.create_entity", ifc_class="IfcSite", name="Site")
    building = run(model, "root.create_entity", ifc_class="IfcBuilding", name="DemoBuilding")
    storey = run(model, "root.create_entity", ifc_class="IfcBuildingStorey", name="B1")
    storey.Elevation = -3.0

    run(model, "aggregate.assign_object", products=[site], relating_object=project)
    run(model, "aggregate.assign_object", products=[building], relating_object=site)
    run(model, "aggregate.assign_object", products=[storey], relating_object=building)

    host = run(model, "root.create_entity", ifc_class="IfcHeatExchanger", name="HX-1")
    host.PredefinedType = "PLATE"
    run(model, "spatial.assign_container", products=[host], relating_structure=storey)

    sensors = []
    for tag, kind in (
        ("TS-01", "TEMPERATURESENSOR"),
        ("FS-01", "FLOWSENSOR"),
        ("PS-01", "PRESSURESENSOR"),
    ):
        sensor = run(model, "root.create_entity", ifc_class="IfcSensor", name=tag)
        sensor.PredefinedType = kind
        run(model, "spatial.assign_container", products=[sensor], relating_structure=storey)
        sensors.append(sensor)

    run(model, "nest.assign_object", related_objects=sensors, relating_object=host)

    pset = run(model, "pset.add_pset", product=sensors[0], name="SWiM_SensorMetadata")
    run(model, "pset.edit_pset", pset=pset, properties={
        "MqttTopic": "swim/DemoBuilding/B1/PlantRoom/HX-1/temperature/TS-01",
        "Unit": "celsius",
    })

    return model


@pytest.fixture
def empty_model():
    """A model with no sensors at all, like every AU building model."""
    model = ifcopenshell.file(schema="IFC4X3")
    run(model, "root.create_entity", ifc_class="IfcProject", name="Empty")
    run(model, "unit.assign_unit", length={"is_metric": True, "raw": "METERS"})
    run(model, "root.create_entity", ifc_class="IfcWall", name="W-1")
    return model


class TestHostOf:
    def test_finds_the_equipment_a_sensor_is_nested_on(self, model):
        sensor = model.by_type("IfcSensor")[0]
        assert explorer.host_of(sensor).Name == "HX-1"

    def test_returns_none_when_nothing_hosts_it(self, empty_model):
        wall = empty_model.by_type("IfcWall")[0]
        assert explorer.host_of(wall) is None


class TestTopicFor:
    def test_reuses_the_topic_recorded_in_the_model(self, model):
        # Keeping the model and the manifest saying the same thing matters
        # more than regenerating a topic that might differ.
        sensor = next(s for s in model.by_type("IfcSensor") if s.Name == "TS-01")
        topic = to_manifest.topic_for(sensor, model)
        assert topic == "swim/DemoBuilding/B1/PlantRoom/HX-1/temperature/TS-01"

    def test_builds_a_topic_when_the_model_has_none(self, model):
        sensor = next(s for s in model.by_type("IfcSensor") if s.Name == "FS-01")
        topic = to_manifest.topic_for(sensor, model)
        # The first segment is the project's own name, not a name this
        # converter chose. A converter that stamps one project's prefix on
        # every model works for that project and no other.
        assert topic.startswith("Test/DemoBuilding/B1/")
        assert topic.endswith("/flow/FS-01")

    def test_marks_what_it_could_not_find(self, model):
        # This model has no IfcSpace, so the room segment cannot be filled.
        sensor = next(s for s in model.by_type("IfcSensor") if s.Name == "FS-01")
        assert "TODO" in to_manifest.topic_for(sensor, model)


class TestBindingFor:
    def test_carries_the_globalid_as_the_binding_key(self, model):
        sensor = model.by_type("IfcSensor")[0]
        binding = to_manifest.binding_for(sensor, model)
        assert binding["globalId"] == sensor.GlobalId
        assert len(binding["globalId"]) == 22

    def test_display_matches_the_sensor_type(self, model):
        by_name = {s.Name: s for s in model.by_type("IfcSensor")}
        assert to_manifest.binding_for(by_name["TS-01"], model)["unit"] == "°C"
        assert to_manifest.binding_for(by_name["FS-01"], model)["unit"] == "m³/h"
        assert to_manifest.binding_for(by_name["PS-01"], model)["unit"] == "kPa"

    def test_unknown_sensor_type_is_marked_rather_than_guessed(self, model):
        sensor = run(model, "root.create_entity", ifc_class="IfcSensor", name="XX-01")
        sensor.PredefinedType = "CO2SENSOR"
        binding = to_manifest.binding_for(sensor, model)
        assert binding["unit"] == "TODO"

    def test_label_names_the_host(self, model):
        by_name = {s.Name: s for s in model.by_type("IfcSensor")}
        assert to_manifest.binding_for(by_name["TS-01"], model)["label"] == "HX-1 temperature TS-01"


class TestManifestFrom:
    def test_one_binding_per_sensor(self, model):
        manifest = to_manifest.manifest_from(model, "test.ifc")
        assert len(manifest["bindings"]) == 3

    def test_records_the_schema_and_scale(self, model):
        manifest = to_manifest.manifest_from(model, "test.ifc")
        assert manifest["schema"] == "IFC4X3_ADD2"
        assert manifest["metre_scale"] == 1.0

    def test_a_model_with_no_sensors_gives_no_bindings(self, empty_model):
        # Every AU building model behaves this way, so it must not crash.
        manifest = to_manifest.manifest_from(empty_model, "empty.ifc")
        assert manifest["bindings"] == []


class TestAsYaml:
    def test_output_is_valid_yaml(self, model):
        manifest = to_manifest.manifest_from(model, "test.ifc")
        parsed = yaml.safe_load(to_manifest.as_yaml(manifest))
        assert len(parsed["bindings"]) == 3

    def test_follows_the_agreed_schema(self, model):
        manifest = to_manifest.manifest_from(model, "test.ifc")
        parsed = yaml.safe_load(to_manifest.as_yaml(manifest))
        binding = parsed["bindings"][0]
        assert "globalId" in binding["selector"]
        assert binding["source"]["live"]["transport"] == "mqtt"
        # No history half without a bucket, because nobody but the deployment
        # knows where its readings are stored, and inventing a name would put a
        # wrong one in every manifest.
        assert "history" not in binding["source"]
        assert "unit" in binding["display"] and "ramp" in binding["display"]

    def test_says_what_a_person_still_has_to_fill_in(self, model):
        # A generated file that hides its gaps is worse than one that names
        # them. Role in particular cannot be derived: IFC records that a
        # sensor is nested on equipment, not where on it.
        text = to_manifest.as_yaml(to_manifest.manifest_from(model, "test.ifc"))
        assert "role: TODO" in text
        assert "network_supply" in text

    def test_empty_model_still_produces_valid_yaml(self, empty_model):
        manifest = to_manifest.manifest_from(empty_model, "empty.ifc")
        parsed = yaml.safe_load(to_manifest.as_yaml(manifest))
        assert parsed["bindings"] is None or parsed["bindings"] == []


class TestOldSchema:
    def test_ifc2x3_has_no_sensor_entity_and_must_not_crash(self):
        # IfcSensor was added in IFC4. One of the project's models is IFC2X3,
        # and asking it for that entity raises instead of returning nothing.
        model = ifcopenshell.file(schema="IFC2X3")
        assert explorer.sensors_in(model) == []

    def test_manifest_from_an_ifc2x3_model_is_still_valid(self, tmp_path):
        # Written as a file instead of built with the api, because IFC2X3
        # requires an owner history on every created entity and setting that
        # up says nothing about the generator.
        source = tmp_path / "old.ifc"
        source.write_text(
            "ISO-10303-21;\n"
            "HEADER;\n"
            "FILE_DESCRIPTION((''),'2;1');\n"
            "FILE_NAME('old.ifc','2026-09-07T00:00:00',(''),(''),'','','');\n"
            "FILE_SCHEMA(('IFC2X3'));\n"
            "ENDSEC;\n"
            "DATA;\n"
            "#1=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);\n"
            "#2=IFCUNITASSIGNMENT((#1));\n"
            "#3=IFCPROJECT('0abcdefghijklmnopqrstu',$,'Old',$,$,$,$,$,#2);\n"
            "ENDSEC;\n"
            "END-ISO-10303-21;\n"
        )
        model = ifcopenshell.open(str(source))
        manifest = to_manifest.manifest_from(model, source)

        assert manifest["schema"] == "IFC2X3"
        assert manifest["bindings"] == []
        # And the output still parses, so a report can say "no sensors here".
        assert yaml.safe_load(to_manifest.as_yaml(manifest))["model"]["schema"] == "IFC2X3"


class TestProvenance:
    """The manifest must say which model version it was built from.

    Issue 1762 asks for this, and the reason is specific: a manifest and a
    geometry file are both derived from a model, the file name stays the same
    across a re-export, and the GlobalIds inside do not. Without the hash
    there is no way to notice a manifest has gone stale.
    """

    def test_records_the_hash_of_the_source_file(self, model, tmp_path):
        source = tmp_path / "model.ifc"
        model.write(str(source))

        manifest = to_manifest.manifest_from(model, source)

        assert manifest["source_sha256"] == hashlib.sha256(source.read_bytes()).hexdigest()

    def test_a_changed_model_produces_a_different_hash(self, model, tmp_path):
        """The point of the field. If editing a model left the hash alone it
        would be decoration instead of provenance."""
        first = tmp_path / "first.ifc"
        model.write(str(first))
        before = to_manifest.manifest_from(model, first)["source_sha256"]

        second = tmp_path / "second.ifc"
        second.write_bytes(first.read_bytes() + b"\n/* edited */\n")
        after = to_manifest.manifest_from(model, second)["source_sha256"]

        assert before != after

    def test_names_the_converter_that_wrote_the_file(self, model, tmp_path):
        """IfcConvert and this generator produce different manifests. A reader
        who assumes the wrong one reads the fields wrong."""
        source = tmp_path / "model.ifc"
        model.write(str(source))

        assert to_manifest.manifest_from(model, source)["converter"] == (
            "ifc_explorer.to_manifest 0.1.0"
        )

    def test_provenance_survives_into_the_yaml(self, model, tmp_path):
        source = tmp_path / "model.ifc"
        model.write(str(source))

        written = yaml.safe_load(
            to_manifest.as_yaml(to_manifest.manifest_from(model, source))
        )["model"]

        assert written["source_sha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
        assert written["converter"] == "ifc_explorer.to_manifest 0.1.0"

    def test_an_unreadable_source_still_produces_a_manifest(self, model, tmp_path):
        """A missing hash is worth less than the manifest, so it is recorded
        as unknown instead of raised. The bindings are the useful part."""
        missing = tmp_path / "never_written.ifc"

        manifest = to_manifest.manifest_from(model, missing)

        assert manifest["source_sha256"] is None
        assert yaml.safe_load(to_manifest.as_yaml(manifest))["model"]["source_sha256"] == "unknown"


class TestGeneralRatherThanOneProject:
    """The converter must not carry one project's conventions.

    It used to read a property set named for this project, prefix every topic
    with that project's name, and default the history bucket to it. A converter
    that does any of those works for one deployment and silently misnames
    everything in another.
    """

    def test_reads_a_recorded_topic_from_any_property_set(self, model):
        # IFC has no standard place for an MQTT topic, so exporters put it in a
        # set of their own naming. The key is searched for, not the set.
        sensors = to_manifest.sensors_in(model)
        assert to_manifest.recorded(sensors[0], "MqttTopic")

    def test_the_history_half_appears_once_a_bucket_is_named(self, model):
        manifest = to_manifest.manifest_from(model, "test.ifc", bucket="readings")
        parsed = yaml.safe_load(to_manifest.as_yaml(manifest))

        assert parsed["bindings"][0]["source"]["history"]["bucket"] == "readings"

    def test_a_caller_can_choose_the_topic_prefix(self, model):
        manifest = to_manifest.manifest_from(model, "test.ifc", prefix="campus")
        generated = [b for b in manifest["bindings"] if b["topic"].startswith("campus/")]

        assert generated, "a generated topic should use the prefix given"
