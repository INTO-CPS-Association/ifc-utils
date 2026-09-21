"""Write the name of a building into its IFC file.

A viewer names a model by what its IFC file says, and most files say nothing:
a Revit export that nobody filled in keeps the template text, "Project Name"
and "Building Name". This writes the name into the file, on the project's
LongName, which is where the files that do carry a name keep it and where
bim-kit reads first. The name then travels with the file to any IFC viewer.

This is the one tool in this package that writes to a model
------------------------------------------------------------
Everything else here reads an IFC file and produces something beside it. This
changes the file, so it changes as little as it can: one argument of one
statement. It does not open the model through ifcopenshell and write it back,
because that serialises the whole file again, and an architect's deliverable
of 64 MB could come back with every number and space formatted differently.
Here, every byte outside that one argument is left as it was, and the test
suite checks that.

No GlobalId changes, so a manifest that binds sensors by GlobalId keeps
working. The files generated beside the model record the hash of the version
they were made from, and after this they record the version before the name,
which is true, and nothing compares that hash with the file.

Run it:

    ifc-set-name Building_1912_AK_v4.ifc "Navn på bygningen"
    ifc-set-name Building_1912_AK_v4.ifc "Navn på bygningen" --dry-run
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import re
import sys
from pathlib import Path

LOG = logging.getLogger(__name__)

# The position of LongName among IfcProject's attributes, counted from zero.
# The same in IFC2X3 and IFC4: GlobalId, OwnerHistory, Name, Description,
# ObjectType, LongName.
LONG_NAME = 5

# An IFC file is ISO 10303-21, seven bit ASCII. Latin-1 maps every byte to one
# character and back, so reading and writing through it changes no byte.
ENCODING = 'latin-1'


def encode_step_string(value: str) -> str:
    """A name as an ISO 10303-21 string, quoted.

    Printable ASCII is written as it is, with a quote and a backslash doubled.
    Anything else is escaped: a run inside the basic multilingual plane as
    UTF-16, \\X2\\...\\X0\\, which is how the real models spell Ø, and
    anything past it as UTF-32, \\X4\\...\\X0\\.
    """
    out: list[str] = []
    run: list[str] = []

    def flush() -> None:
        if not run:
            return
        if all(ord(char) <= 0xFFFF for char in run):
            out.append('\\X2\\' + ''.join(f'{ord(c):04X}' for c in run) + '\\X0\\')
        else:
            out.append('\\X4\\' + ''.join(f'{ord(c):08X}' for c in run) + '\\X0\\')
        run.clear()

    for char in value:
        if 32 <= ord(char) < 127:
            flush()
            out.append("''" if char == "'" else '\\\\' if char == '\\' else char)
        else:
            run.append(char)
    flush()
    return "'" + ''.join(out) + "'"


def argument_spans(text: str, entity: str) -> list[tuple[int, int]] | None:
    """Where each top-level argument of the first entity of a type sits.

    Returns (start, end) offsets into the text, so one argument can be replaced
    without touching the rest. None when there is no such statement, or it does
    not close.
    """
    match = re.search(rf'=\s*{entity}\s*\(', text, re.IGNORECASE)
    if not match:
        return None

    spans: list[tuple[int, int]] = []
    start = match.end()
    depth = 0
    in_string = False
    i = start
    while i < len(text):
        char = text[i]
        if in_string:
            if char == "'":
                # A doubled quote is a quote inside the string.
                if i + 1 < len(text) and text[i + 1] == "'":
                    i += 2
                    continue
                in_string = False
        elif char == "'":
            in_string = True
        elif char == '(':
            depth += 1
        elif char == ')':
            if depth == 0:
                spans.append((start, i))
                return spans
            depth -= 1
        elif char == ',' and depth == 0:
            spans.append((start, i))
            start = i + 1
        i += 1
    return None


def set_name(text: str, name: str) -> tuple[str, str, str]:
    """The file with its project's LongName set, and the old and new argument."""
    if not name.strip():
        raise ValueError('a building name cannot be empty')

    spans = argument_spans(text, 'IFCPROJECT')
    if spans is None or len(spans) <= LONG_NAME:
        raise ValueError('the file has no IfcProject whose name can be set')

    begin, end = spans[LONG_NAME]
    old = text[begin:end]
    # The leading and trailing space inside the argument is kept, so the only
    # characters that change are the value's own.
    lead = len(old) - len(old.lstrip())
    trail = len(old) - len(old.rstrip())
    new = encode_step_string(name.strip())
    updated = text[:begin + lead] + new + text[end - trail:]
    return updated, old.strip(), new


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Write a building's name into its IFC file, on the project.",
    )
    parser.add_argument('ifc', type=Path, help='the IFC file to name')
    parser.add_argument('name', help='the name of the building it holds')
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='show the change instead of writing it',
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format='%(message)s')

    if not args.ifc.is_file():
        parser.error(f'{args.ifc} is not a file')

    data = args.ifc.read_bytes()
    try:
        updated, old, new = set_name(data.decode(ENCODING), args.name)
    except ValueError as error:
        parser.error(str(error))

    LOG.info('%s', args.ifc.name)
    LOG.info('  LongName was  %s', old)
    LOG.info('  LongName is   %s', new)

    if args.dry_run:
        sys.stdout.write('dry run, nothing written\n')
        return 0

    written = updated.encode(ENCODING)
    args.ifc.write_bytes(written)
    LOG.info(
        '  sha256 %s -> %s',
        hashlib.sha256(data).hexdigest()[:12],
        hashlib.sha256(written).hexdigest()[:12],
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
