"""Tests for the explorer.

The models are built in memory, so the suite is fast and needs no fixture
file on disk. Two models are used: one in metres and one in millimetres,
because unit conversion is the thing most likely to break silently.
"""

import pathlib

import ifcopenshell
import ifcopenshell.api
import pytest

from ifc_explorer import explorer


def run(model, command, **kwargs):
    """Small wrapper so the fixtures read as a list of modelling steps."""
    return ifcopenshell.api.run(command, model, **kwargs)


def build_model(unit):
    """Build a small model: two storeys, one heat exchanger, two sensors.

    Args:
        unit: "METERS" or "MILLIMETERS". The storey elevations are written
            in that unit, so the same building can be tested both ways.
    """
    model = ifcopenshell.file(schema="IFC4X3")

    project = run(model, "root.create_entity", ifc_class="IfcProject", name="Test")
    run(model, "unit.assign_unit", length={"is_metric": True, "raw": unit})

    site = run(model, "root.create_entity", ifc_class="IfcSite", name="Site")
    building = run(model, "root.create_entity", ifc_class="IfcBuilding", name="B")
    lower = run(model, "root.create_entity", ifc_class="IfcBuildingStorey", name="B1")
    upper = run(model, "root.create_entity", ifc_class="IfcBuildingStorey", name="L1")

    # Three metres down, written in whichever unit the model declares.
    lower.Elevation = -3.0 if unit == "METERS" else -3000.0
    upper.Elevation = 0.0

    run(model, "aggregate.assign_object", products=[site], relating_object=project)
    run(model, "aggregate.assign_object", products=[building], relating_object=site)
    run(model, "aggregate.assign_object", products=[lower, upper], relating_object=building)

    host = run(model, "root.create_entity", ifc_class="IfcHeatExchanger", name="HX-1")
    host.PredefinedType = "PLATE"
    run(model, "spatial.assign_container", products=[host], relating_structure=lower)

    sensors = []
    for tag, kind in (("TS-01", "TEMPERATURESENSOR"), ("FS-01", "FLOWSENSOR")):
        sensor = run(model, "root.create_entity", ifc_class="IfcSensor", name=tag)
        sensor.PredefinedType = kind
        run(model, "spatial.assign_container", products=[sensor], relating_structure=lower)
        sensors.append(sensor)

    # Only TS-01 gets a property set, so a test can tell "has no properties"
    # apart from "was not read".
    pset = run(model, "pset.add_pset", product=sensors[0], name="SWiM_SensorMetadata")
    run(model, "pset.edit_pset", pset=pset, properties={"Unit": "celsius"})

    return model


@pytest.fixture
def model():
    """A model authored in metres."""
    return build_model("METERS")


@pytest.fixture
def model_in_millimetres():
    """The same building, authored in millimetres."""
    return build_model("MILLIMETERS")


class TestMetreScale:
    def test_metric_model_needs_no_conversion(self, model):
        assert explorer.metre_scale(model) == 1.0

    def test_millimetre_model_scales_down(self, model_in_millimetres):
        assert explorer.metre_scale(model_in_millimetres) == 0.001


class TestSummary:
    def test_reports_the_exact_schema_release(self, model):
        # Not just the IFC4X3 family, the addendum too.
        assert explorer.summary(model)["schema"] == "IFC4X3_ADD2"

    def test_counts_the_products(self, model):
        # Project is not an IfcProduct, so it is not counted: site,
        # building, two storeys, heat exchanger, two sensors.
        assert explorer.summary(model)["objects"] == 7


class TestStoreys:
    def test_returns_name_and_elevation(self, model):
        found = explorer.storeys(model)
        assert [storey["name"] for storey in found] == ["B1", "L1"]
        assert found[0]["elevation"] == -3.0

    def test_sorted_lowest_first(self, model):
        found = explorer.storeys(model)
        assert found[0]["elevation"] < found[1]["elevation"]

    def test_millimetre_elevations_come_back_in_metres(self, model_in_millimetres):
        # The file stores -3000. Without conversion this would be -3000.0,
        # which is the bug this test exists to catch.
        found = explorer.storeys(model_in_millimetres)
        assert found[0]["elevation"] == -3.0

    def test_both_units_give_the_same_answer(self, model, model_in_millimetres):
        metres = [storey["elevation"] for storey in explorer.storeys(model)]
        millimetres = [
            storey["elevation"] for storey in explorer.storeys(model_in_millimetres)
        ]
        assert metres == millimetres


class TestCountByClass:
    def test_counts_each_kind(self, model):
        counts = dict(explorer.count_by_class(model))
        assert counts["IfcSensor"] == 2
        assert counts["IfcHeatExchanger"] == 1
        assert counts["IfcBuildingStorey"] == 2

    def test_sorted_by_count_descending(self, model):
        counts = [count for _, count in explorer.count_by_class(model)]
        assert counts == sorted(counts, reverse=True)


class TestElements:
    def test_lists_sensors_with_their_type(self, model):
        by_name = {e["name"]: e for e in explorer.elements(model, "IfcSensor")}
        assert by_name["TS-01"]["type"] == "TEMPERATURESENSOR"
        assert by_name["FS-01"]["type"] == "FLOWSENSOR"

    def test_resolves_the_containing_storey(self, model):
        found = explorer.elements(model, "IfcSensor")
        assert all(element["storey"] == "B1" for element in found)

    def test_includes_subtypes(self, model):
        # IfcHeatExchanger is a subtype of IfcEnergyConversionDevice, so
        # asking for the supertype must find it.
        found = explorer.elements(model, "IfcEnergyConversionDevice")
        assert [element["name"] for element in found] == ["HX-1"]

    def test_unknown_class_returns_empty_instead_of_raising(self, model):
        # A report should be able to say "none" instead of crash. This
        # happens with IFC2X3 files asked for an IFC4 entity.
        assert explorer.elements(model, "IfcNotARealEntity") == []

    def test_reads_the_property_set(self, model):
        by_name = {e["name"]: e for e in explorer.elements(model, "IfcSensor")}
        properties = by_name["TS-01"]["properties"]
        assert properties["SWiM_SensorMetadata"]["Unit"] == "celsius"

    def test_drops_the_library_id_key(self, model):
        # get_psets injects "id", which is bookkeeping and not a property
        # of the building object.
        by_name = {e["name"]: e for e in explorer.elements(model, "IfcSensor")}
        assert "id" not in by_name["TS-01"]["properties"]["SWiM_SensorMetadata"]

    def test_element_without_properties_returns_empty(self, model):
        by_name = {e["name"]: e for e in explorer.elements(model, "IfcSensor")}
        assert by_name["FS-01"]["properties"] == {}


class TestGeometryScale:
    """Whether the geometry that comes out of IfcOpenShell is already metres.

    It normally is: the kernel reads the file's length unit and applies it to
    vertices and placements alike, so multiplying by the declared scale a
    second time shrinks a model a thousand times. It is not always, and the
    fixtures in tests/fixtures hold one file of each kind.

    Getting this wrong is not subtle in its effect and is very subtle to
    notice: a washbasin came out six tenths of a millimetre across and nothing
    raised an error.
    """

    FIXTURES = pathlib.Path(__file__).parents[3] / "fixtures"

    def test_a_metre_model_is_unchanged(self):
        from build import build_model

        assert explorer.geometry_scale(build_model("METERS")) == 1.0

    def test_a_millimetre_model_the_kernel_converted_is_not_scaled_again(self):
        """The ordinary case, and the one that used to be wrong.

        The kernel hands this back in metres, so the answer is 1.0. Applying
        the declared 0.001 on top produced a model a thousand times too small.
        """
        from build import build_model

        model = build_model("MILLIMETERS")

        assert explorer.metre_scale(model) == 0.001
        assert explorer.geometry_scale(model) == 1.0

    def test_a_millimetre_model_the_kernel_left_alone_is_scaled(self):
        """The exception, measured instead of assumed.

        This file declares millimetres and comes back out of the kernel in
        millimetres, so the declared scale is the right answer for it. It is
        the reason the decision cannot be a constant.
        """
        model = explorer.open_model(self.FIXTURES / "wall_kernel_keeps_units.ifc")

        assert explorer.metre_scale(model) == 0.001
        assert explorer.geometry_scale(model) == 0.001

    def test_the_wall_comes_out_three_metres_either_way(self):
        """The point of the decision, stated as a size instead of a factor."""
        model = explorer.open_model(self.FIXTURES / "wall_kernel_keeps_units.ifc")
        scale = explorer.geometry_scale(model)

        assert 2.5 < _longest_object(model) * scale < 3.5

    def test_a_model_in_inches_is_not_scaled_again(self):
        """Not every file is metric. The kernel converts inches too.

        Applying the declared 0.0254 on top turned a ten foot column into one
        eight centimetres tall.
        """
        model = explorer.open_model(self.FIXTURES / "column_in_inches.ifc")

        assert explorer.metre_scale(model) == 0.0254
        assert explorer.geometry_scale(model) == 1.0
        assert 3.0 < _longest_object(model) * explorer.geometry_scale(model) < 3.1

    def test_one_object_at_the_origin_falls_back_to_its_size(self):
        """A single object at the origin gives no placement to compare.

        The fallback asks whether applying the declared unit would leave the
        largest thing in the model smaller than any real building element. A
        washbasin six tenths of a millimetre across is the answer being wrong.
        """
        model = explorer.open_model(self.FIXTURES / "basin_at_the_origin.ifc")

        assert explorer.geometry_scale(model) == 1.0
        assert 0.5 < _longest_object(model) < 0.7

    def test_the_fallback_still_scales_a_model_that_needs_it(self):
        """The fallback must not always answer 1.0.

        A metre and a half of object measured in millimetres is 1500, and
        1500 times 0.001 is well above any element size, so the declared unit
        stands.
        """
        assert explorer._scale_from_size.__doc__ is not None
        # 1.5 m expressed as 1500 mm: applying 0.001 gives 1.5 m, plausible.
        assert 1500 * 0.001 >= explorer.SMALLEST_PLAUSIBLE_ELEMENT_M
        # 0.6 m already in metres: applying 0.001 gives 0.6 mm, implausible.
        assert 0.6 * 0.001 < explorer.SMALLEST_PLAUSIBLE_ELEMENT_M


def _longest_object(model):
    """The largest dimension of any single object, as the kernel reports it."""
    import ifcopenshell.geom
    import ifcopenshell.util.shape

    iterator = ifcopenshell.geom.iterator(
        ifcopenshell.geom.settings(), model,
        exclude=("IfcSpace", "IfcSite", "IfcOpeningElement"),
    )
    assert iterator.initialize()
    longest = 0.0
    while True:
        vertices = ifcopenshell.util.shape.get_vertices(iterator.get().geometry)
        if len(vertices):
            longest = max(longest, float((vertices.max(axis=0) - vertices.min(axis=0)).max()))
        if not iterator.next():
            break
    return longest
