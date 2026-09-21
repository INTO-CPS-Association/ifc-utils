"""Tests for naming the buildings from their IFC files.

The cases are the ones the real models present: a name on the project's
LongName and a misspelt one on the building, a Revit template nobody filled
in, a job number where a name should be, and two files sharing one name.

Every model here is built in memory, except where a test needs files on disk
to scan a directory.
"""

import json

import ifcopenshell
import pytest

from ifc_converter import to_catalogue

SCHEMA = "IFC4X3_ADD2"


def _model(project_name=None, project_long=None, building_name=None,
           building_long=None):
    model = ifcopenshell.file(schema=SCHEMA)
    model.create_entity(
        "IfcProject",
        GlobalId=ifcopenshell.guid.new(),
        Name=project_name,
        LongName=project_long,
    )
    model.create_entity(
        "IfcBuilding",
        GlobalId=ifcopenshell.guid.new(),
        Name=building_name,
        LongName=building_long,
    )
    return model


class TestUsable:
    @pytest.mark.parametrize("value", [
        "Project Name", "BUILDING NAME", "Default", "Site", "  ", "",
    ])
    def test_template_text_is_not_a_name(self, value):
        assert to_catalogue.usable(value) is None

    @pytest.mark.parametrize("value", ["0001", "34372", "39043-02"])
    def test_a_job_number_is_not_a_name(self, value):
        assert to_catalogue.usable(value) is None

    def test_a_value_that_is_not_text_is_not_a_name(self):
        assert to_catalogue.usable(None) is None
        assert to_catalogue.usable(42) is None

    def test_a_real_name_is_kept_and_trimmed(self):
        assert to_catalogue.usable("  FEAS - Kommunehospital ") == (
            "FEAS - Kommunehospital"
        )


class TestBuildingName:
    def test_the_project_long_name_wins_over_a_misspelt_building(self):
        # Building_1911_AK_v2: the project is right and the building is not.
        model = _model(
            project_name="34372",
            project_long="Pædagogisk Center",
            building_name="Pædagosik Center",
        )
        assert to_catalogue.building_name(model) == "Pædagogisk Center"

    def test_a_job_number_is_passed_over_for_the_next_name(self):
        model = _model(project_name="39043-02", building_name="Bygning 1870")
        assert to_catalogue.building_name(model) == "Bygning 1870"

    def test_the_building_is_read_when_the_project_says_nothing(self):
        model = _model(project_name="Project Name", building_name="Deli")
        assert to_catalogue.building_name(model) == "Deli"

    def test_a_template_nobody_filled_in_has_no_name(self):
        # Seven of the twelve real models are this.
        model = _model(
            project_name="Project Number",
            project_long="Project Name",
            building_name="Building Name",
            building_long="Building Name",
        )
        assert to_catalogue.building_name(model) is None


class TestBuildCatalogue:
    def test_a_file_with_no_name_has_no_entry(self):
        catalogue = to_catalogue.build_catalogue(
            {"a.ifc": "Alpha", "b.ifc": None}, {},
        )
        assert catalogue == {"a.ifc": "Alpha"}

    def test_a_name_two_files_share_is_dropped_for_both(self):
        # The two substation models are both "SWiM district cooling
        # substation", and their file names are what tells them apart.
        catalogue = to_catalogue.build_catalogue(
            {"ok.ifc": "Substation", "faults.ifc": "Substation", "c.ifc": "C"},
            {},
        )
        assert catalogue == {"c.ifc": "C"}

    def test_an_override_wins_over_the_file(self):
        catalogue = to_catalogue.build_catalogue(
            {"a.ifc": "From the file"}, {"a.ifc": "From a person"},
        )
        assert catalogue == {"a.ifc": "From a person"}

    def test_an_override_names_a_building_its_file_does_not(self):
        catalogue = to_catalogue.build_catalogue(
            {"a.ifc": None}, {"a.ifc": "Named by hand"},
        )
        assert catalogue == {"a.ifc": "Named by hand"}


class TestReadJson:
    def test_an_absent_file_is_an_empty_map(self, tmp_path):
        assert to_catalogue.read_json(tmp_path / "missing.json") == {}

    def test_an_entry_that_is_not_a_title_is_skipped(self, tmp_path):
        path = tmp_path / "overrides.json"
        path.write_text(json.dumps({"a.ifc": "Kept", "b.ifc": 3, "c.ifc": "  "}))
        assert to_catalogue.read_json(path) == {"a.ifc": "Kept"}

    def test_a_file_that_is_not_an_object_is_refused(self, tmp_path):
        path = tmp_path / "overrides.json"
        path.write_text("[1, 2]")
        with pytest.raises(ValueError):
            to_catalogue.read_json(path)


class TestMain:
    def _write(self, directory, name, **names):
        _model(**names).write(str(directory / name))

    def test_writes_the_catalogue_beside_the_models(self, tmp_path):
        self._write(tmp_path, "real.ifc", project_long="Pædagogisk Center")
        self._write(tmp_path, "template.ifc", project_long="Project Name")

        assert to_catalogue.main([str(tmp_path)]) == 0

        written = json.loads((tmp_path / "catalogue.json").read_text("utf-8"))
        assert written == {"real.ifc": "Pædagogisk Center"}

    def test_keeps_the_letters_of_the_name_readable(self, tmp_path):
        # Escaped as \\u00e6 the file is valid JSON and unreadable to the
        # person who has to check it.
        self._write(tmp_path, "real.ifc", project_long="Pædagogisk Center")
        to_catalogue.main([str(tmp_path)])
        assert "Pædagogisk" in (tmp_path / "catalogue.json").read_text("utf-8")

    def test_applies_the_overrides_a_person_wrote(self, tmp_path):
        self._write(tmp_path, "template.ifc", project_long="Project Name")
        (tmp_path / "catalogue.overrides.json").write_text(
            json.dumps({"template.ifc": "The Deli"}), encoding="utf-8",
        )

        to_catalogue.main([str(tmp_path)])

        written = json.loads((tmp_path / "catalogue.json").read_text("utf-8"))
        assert written == {"template.ifc": "The Deli"}

    def test_a_dry_run_writes_nothing(self, tmp_path, capsys):
        self._write(tmp_path, "real.ifc", project_long="Alpha")

        to_catalogue.main([str(tmp_path), "--dry-run"])

        assert not (tmp_path / "catalogue.json").exists()
        assert '"real.ifc": "Alpha"' in capsys.readouterr().out

    # ifcopenshell raises from its own destructor after an open it refused,
    # which pytest reports as an unraisable exception. The code under test
    # handles the refusal, which is what this test checks, so the warning is
    # about the library and is silenced here and nowhere else.
    @pytest.mark.filterwarnings("ignore::pytest.PytestUnraisableExceptionWarning")
    def test_a_file_that_cannot_be_read_does_not_stop_the_rest(self, tmp_path):
        (tmp_path / "broken.ifc").write_text("not an ifc file")
        self._write(tmp_path, "real.ifc", project_long="Alpha")

        assert to_catalogue.main([str(tmp_path)]) == 0

        written = json.loads((tmp_path / "catalogue.json").read_text("utf-8"))
        assert written == {"real.ifc": "Alpha"}

    def test_refuses_a_path_that_is_not_a_directory(self, tmp_path):
        with pytest.raises(SystemExit):
            to_catalogue.main([str(tmp_path / "nowhere")])
