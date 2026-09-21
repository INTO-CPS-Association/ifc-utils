"""Tests for writing a building's name into its IFC file.

The property that matters most is what does not change. This edits an
architect's deliverable, so every byte outside the one argument it sets has
to be exactly as it was, and ifcopenshell, the reference reader, has to find
the name there afterwards.

The statements are copied from the real models in the shared library.
"""

import ifcopenshell
import pytest

from ifc_converter import set_name

# Building_1912_AK_v4.ifc, as written: the Revit template, never filled in.
TEMPLATE = (
    "#1= IFCPROJECT('0FHQg$qdvEPQB6VPH27kii',#18,'Project Number',$,$,"
    "'Project Name','Project Status',(#22),#167926);"
)

# substation_ok.ifc, as written: LongName is unset.
UNSET = "#1= IFCPROJECT('0b5j3C6_v5kA2vi1RMUzh5',$,'SWiM',$,$,$,$,(#10),#5);"


class TestEncodeStepString:
    def test_plain_ascii_is_written_as_it_is(self):
        assert set_name.encode_step_string("Bygning 1912") == "'Bygning 1912'"

    def test_a_quote_and_a_backslash_are_doubled(self):
        assert set_name.encode_step_string("O'Brien\\x") == "'O''Brien\\\\x'"

    def test_a_letter_outside_ascii_is_escaped_as_utf16(self):
        # How the real L187x model spells Ø.
        assert set_name.encode_step_string("UDFØRT") == "'UDF\\X2\\00D8\\X0\\RT'"

    def test_a_run_of_letters_outside_ascii_is_one_escape(self):
        assert set_name.encode_step_string("æø") == "'\\X2\\00E600F8\\X0\\'"

    def test_a_character_past_the_basic_plane_is_escaped_as_utf32(self):
        assert set_name.encode_step_string("🏠") == "'\\X4\\0001F3E0\\X0\\'"


class TestArgumentSpans:
    def test_finds_every_top_level_argument(self):
        spans = set_name.argument_spans(TEMPLATE, "IFCPROJECT")
        assert len(spans) == 9
        begin, end = spans[set_name.LONG_NAME]
        assert TEMPLATE[begin:end] == "'Project Name'"

    def test_a_comma_inside_a_string_or_a_list_does_not_split(self):
        text = "#1= IFCPROJECT('a, b',(#1,#2),'c');"
        spans = set_name.argument_spans(text, "IFCPROJECT")
        assert [text[b:e] for b, e in spans] == ["'a, b'", "(#1,#2)", "'c'"]

    def test_a_missing_statement_gives_nothing(self):
        assert set_name.argument_spans("#1= IFCWALL('a');", "IFCPROJECT") is None


class TestSetName:
    def test_replaces_the_template_text(self):
        updated, old, new = set_name.set_name(TEMPLATE, "Bygning 1912")
        assert old == "'Project Name'"
        assert new == "'Bygning 1912'"
        assert "'Bygning 1912','Project Status'" in updated

    def test_fills_a_long_name_that_was_unset(self):
        updated, old, _ = set_name.set_name(UNSET, "District Cooling")
        assert old == "$"
        assert "$,$,'District Cooling',$" in updated

    def test_changes_nothing_but_that_argument(self):
        updated, _, _ = set_name.set_name(TEMPLATE, "Bygning 1912")
        before, after = TEMPLATE.split("'Project Name'")
        assert updated.startswith(before)
        assert updated.endswith(after)
        assert updated == before + "'Bygning 1912'" + after

    def test_refuses_an_empty_name(self):
        with pytest.raises(ValueError):
            set_name.set_name(TEMPLATE, "   ")

    def test_refuses_a_file_with_no_project(self):
        with pytest.raises(ValueError):
            set_name.set_name("#1= IFCWALL('a');", "Bygning")


def _write_model(path, long_name="Project Name"):
    model = ifcopenshell.file(schema="IFC4X3_ADD2")
    model.create_entity(
        "IfcProject",
        GlobalId=ifcopenshell.guid.new(),
        Name="Project Number",
        LongName=long_name,
    )
    model.create_entity("IfcWall", GlobalId=ifcopenshell.guid.new(), Name="Wall")
    model.write(str(path))


class TestMain:
    def test_the_name_is_read_back_by_ifcopenshell(self, tmp_path):
        path = tmp_path / "model.ifc"
        _write_model(path)

        assert set_name.main([str(path), "Pædagogisk Center"]) == 0

        project = ifcopenshell.open(str(path)).by_type("IfcProject")[0]
        assert project.LongName == "Pædagogisk Center"

    def test_every_other_byte_of_the_file_is_unchanged(self, tmp_path):
        path = tmp_path / "model.ifc"
        _write_model(path)
        before = path.read_bytes()

        set_name.main([str(path), "Bygning 1912"])
        after = path.read_bytes()

        old = b"'Project Name'"
        new = b"'Bygning 1912'"
        assert before.count(old) == 1
        assert after == before.replace(old, new)

    def test_no_global_id_changes(self, tmp_path):
        # A manifest binds sensors by GlobalId, so none may move.
        path = tmp_path / "model.ifc"
        _write_model(path)
        ids = {e.GlobalId for e in ifcopenshell.open(str(path)).by_type("IfcRoot")}

        set_name.main([str(path), "Bygning 1912"])

        after = {e.GlobalId for e in ifcopenshell.open(str(path)).by_type("IfcRoot")}
        assert after == ids

    def test_a_dry_run_writes_nothing(self, tmp_path, capsys):
        path = tmp_path / "model.ifc"
        _write_model(path)
        before = path.read_bytes()

        set_name.main([str(path), "Bygning 1912", "--dry-run"])

        assert path.read_bytes() == before
        assert "nothing written" in capsys.readouterr().out

    def test_refuses_a_path_that_is_not_a_file(self, tmp_path):
        with pytest.raises(SystemExit):
            set_name.main([str(tmp_path / "nowhere.ifc"), "Bygning"])
