"""The commands a person types after installing the package.

Each one answers -h and --help with how to call it, by the name it is installed
under, and refuses a call without its arguments the same way. The names are
what the README tells a person to type, so a usage line naming a module path
instead would send them to something that does not run.
"""

import pytest

from ifc_converter import to_glb, to_manifest, to_metadata

COMMANDS = [
    (to_glb, "ifc-to-glb"),
    (to_manifest, "ifc-to-manifest"),
    (to_metadata, "ifc-to-metadata"),
]


@pytest.mark.parametrize("module, command", COMMANDS)
@pytest.mark.parametrize("flag", ["-h", "--help"])
def test_help_names_the_installed_command(module, command, flag, capsys):
    assert module.main([flag]) == 0
    assert capsys.readouterr().out.startswith(f"Usage: {command} <file.ifc> ")


@pytest.mark.parametrize("module, command", COMMANDS)
def test_no_arguments_is_refused_with_the_same_usage(module, command, capsys):
    assert module.main([]) == 2
    assert capsys.readouterr().err.startswith(f"Usage: {command} ")
