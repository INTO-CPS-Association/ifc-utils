# Fixtures

IFC files this repository did not produce, kept because each one breaks an assumption a converter is likely to make.

They live here instead of beside one package because **both converters run against them**: the browser one under `packages/bim-glb-viewer` and the Python one under `python/`. Two implementations of one job are only comparable if they are asked the same questions, and a copy of a fixture is a question that drifts. They are small enough to read, and they are committed as plain files instead of through Git LFS so the tests run on a fresh clone with nothing fetched.

## Where They Come From

All three are from the buildingSMART Certification datasets, copyright buildingSMART International Ltd. and licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Downloaded on 2026-09-09 from <https://github.com/buildingSMART/Certification-datasets>, directory `IFC 4.0.2.1 (IFC 4 ADD2 TC1)/ISO Spec - ReferenceView_V1.2/`. They are renamed here after what each one is for, and are otherwise unmodified.

| File | Original name | What it is for |
|---|---|---|
| `wall_kernel_keeps_units.ifc` | `wall-with-opening-and-window.ifc` | The one file measured so far whose geometry IfcOpenShell hands back in the file's own millimetres instead of in metres. Every other file tested comes back converted. |
| `column_in_inches.ifc` | `column-straight-rectangle-tessellation.ifc` | Declares inches, not a metric unit at all. An 8 inch column, 10 feet tall. |
| `basin_at_the_origin.ifc` | `basin-tessellation.ifc` | One object, at the origin, so no placement can say what the kernel did to the units. Forces the fallback. |

## Why They Are Here

`explorer.geometry_scale` decides whether the geometry kernel already applied the file's length unit. Getting it wrong scales a whole model by a thousand. Before these fixtures existed the decision was a guess from the model's overall span, which is a measurement a single small object cannot supply: the basin came out six tenths of a millimetre across and the column five millimetres tall.
