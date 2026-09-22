"""Command line entry point.

Run it like this:

    ifc-explorer model.ifc
    ifc-explorer model.ifc IfcSensor

This file only reads arguments and prints. All the IFC work lives in
explorer.py, so a different output format is a change here and nowhere else.

Exit codes:
    0  the report printed
    1  the file could not be read as an IFC model
    2  the arguments were rejected
"""

import sys
from pathlib import Path

from . import explorer

EXIT_OK = 0
EXIT_READ_ERROR = 1
EXIT_BAD_INPUT = 2


def check_path(raw_path):
    """Validate the path before opening anything.

    Resolving first means a path containing ".." cannot quietly point
    somewhere other than it appears to.
    """
    path = Path(raw_path).expanduser().resolve()

    if not path.is_file():
        raise ValueError("file not found")
    if path.suffix.lower() != ".ifc":
        raise ValueError("expected a .ifc file")

    return path


def print_summary(model, path):
    """Print what the file is."""
    facts = explorer.summary(model)

    print(f"File:    {path.name}")
    print(f"Schema:  {facts['schema']}")
    print(f"Objects: {facts['objects']}")

    # Worth saying out loud, because it means every length below was
    # converted before being printed.
    if facts["metre_scale"] != 1.0:
        print(f"Units:   not metres, lengths multiplied by {facts['metre_scale']:g}")


def print_storeys(model):
    """Print the floors, lowest first."""
    print("\nStoreys")

    found = explorer.storeys(model)
    if not found:
        print("  (none)")
        return

    # Pad the names so the elevations line up in a column.
    width = max(len(storey["name"]) for storey in found)
    for storey in found:
        print(f"  {storey['name']:{width}}  {storey['elevation']} m")


def print_classes(model):
    """Print how many objects of each kind the file holds."""
    print("\nObjects by class")

    counts = explorer.count_by_class(model)
    if not counts:
        print("  (none)")
        return

    width = max(len(name) for name, _ in counts)
    for name, count in counts:
        print(f"  {name:{width}}  {count}")


def print_elements(model, ifc_class):
    """Print the elements of one class, with their properties."""
    found = explorer.elements(model, ifc_class)
    print(f"\n{ifc_class}: {len(found)} found")

    for element in found:
        print(f"\n  {element['name']}  {element['type']}")
        if element["storey"]:
            print(f"      storey: {element['storey']}")

        for pset_name, properties in element["properties"].items():
            for key, value in properties.items():
                print(f"      {pset_name}.{key} = {value}")


USAGE = "Usage: ifc-explorer <file.ifc> [IfcClass]"


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]

    if argv and argv[0] in ("-h", "--help"):
        print(USAGE)
        return 0
    if not argv:
        print(USAGE, file=sys.stderr)
        return EXIT_BAD_INPUT

    try:
        path = check_path(argv[0])
    except ValueError as error:
        print(f"Cannot run: {error}", file=sys.stderr)
        return EXIT_BAD_INPUT

    try:
        model = explorer.open_model(path)
    except Exception:
        # The parser message can name internal paths, so the user gets a
        # short generic line and nothing more.
        print("Cannot read the file as an IFC model", file=sys.stderr)
        return EXIT_READ_ERROR

    print_summary(model, path)

    if len(argv) > 1:
        # A class was given, so show those elements in detail.
        print_elements(model, argv[1])
    else:
        # No class given, so show the overview.
        print_storeys(model)
        print_classes(model)

    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
