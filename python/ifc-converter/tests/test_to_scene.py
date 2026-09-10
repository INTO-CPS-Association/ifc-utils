"""Tests for the JSON geometry exporter.

The test that matters here is placement. IfcOpenShell returns vertices in each
object's own local coordinates plus a separate matrix saying where the object
sits. Writing the vertices without applying that matrix puts every object at
the origin, and the result still renders, still has the right shapes and the
right colours, and is silently wrong. That is exactly the kind of defect a
test has to catch, because looking at the screen does not.
"""

import ifcopenshell
import ifcopenshell.api
import pytest

from ifc_converter import to_scene


def run(model, command, **kwargs):
    return ifcopenshell.api.run(command, model, **kwargs)


@pytest.fixture
def model():
    """Three identical boxes at three different places.

    Identical on purpose: if placement is dropped, all three collapse onto
    each other and the failure is unmistakable.
    """
    model = ifcopenshell.file(schema="IFC4X3")
    run(model, "root.create_entity", ifc_class="IfcProject", name="Test")
    run(model, "unit.assign_unit", length={"is_metric": True, "raw": "METERS"})
    context = run(model, "context.add_context", context_type="Model")
    body = run(
        model, "context.add_context",
        context_type="Model", context_identifier="Body",
        target_view="MODEL_VIEW", parent=context,
    )

    for name, (x, y, z) in (
        ("A", (0.0, 0.0, 0.0)),
        ("B", (5.0, 0.0, 0.0)),
        ("C", (0.0, 3.0, 2.0)),
    ):
        wall = run(model, "root.create_entity", ifc_class="IfcWall", name=name)
        representation = run(
            model, "geometry.add_wall_representation",
            context=body, length=1.0, height=1.0, thickness=0.2,
        )
        run(model, "geometry.assign_representation",
            product=wall, representation=representation)
        run(model, "geometry.edit_object_placement",
            product=wall,
            matrix=(
                (1.0, 0.0, 0.0, x),
                (0.0, 1.0, 0.0, y),
                (0.0, 0.0, 1.0, z),
                (0.0, 0.0, 0.0, 1.0),
            ))

    return model


def first_vertex(entry):
    """The first x, y, z of one exported object."""
    return tuple(entry["vertices"][:3])


class TestPlacement:
    def test_objects_do_not_collapse_onto_each_other(self, model):
        scene = to_scene.scene_from(model)
        positions = {first_vertex(o) for o in scene["objects"]}
        assert len(positions) == len(scene["objects"])

    def test_each_object_lands_where_its_placement_says(self, model):
        scene = to_scene.scene_from(model)
        by_name = {o["name"]: first_vertex(o) for o in scene["objects"]}

        # B is five metres along x from A, and C is three along y and two up.
        ax, ay, az = by_name["A"]
        bx, by_, bz = by_name["B"]
        cx, cy, cz = by_name["C"]

        assert round(bx - ax, 3) == 5.0
        assert round(cy - ay, 3) == 3.0
        assert round(cz - az, 3) == 2.0


class TestSceneShape:
    def test_carries_the_globalid_on_every_object(self, model):
        scene = to_scene.scene_from(model)
        for entry in scene["objects"]:
            assert len(entry["globalId"]) == 22

    def test_records_the_schema_and_scale(self, model):
        scene = to_scene.scene_from(model)
        assert scene["schema"] == "IFC4X3_ADD2"
        assert scene["metreScale"] == 1.0

    def test_vertices_are_flat_triples(self, model):
        scene = to_scene.scene_from(model)
        for entry in scene["objects"]:
            assert len(entry["vertices"]) % 3 == 0
            assert len(entry["triangles"]) % 3 == 0
