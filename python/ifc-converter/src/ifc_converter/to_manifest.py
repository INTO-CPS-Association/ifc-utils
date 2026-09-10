"""Generate a binding manifest from an IFC model.

A binding manifest says, for each sensor, which model element it is and where
its data can be read. It is the contract between this side, which runs once
per model in Python, and the viewer, which runs in a browser. The schema
follows the proposal in DTaaS issue 1762.

Until now the manifest was written by hand. That works for one substation and
stops working the moment a model is re-exported from Revit, because the
GlobalIds change and a hand-written file goes quietly out of date.

Run it:

    python -m ifc_explorer.to_manifest model.ifc manifest.yaml

What it cannot know, and therefore leaves for a person to fill in, is marked
with TODO in the output. See the notes at the bottom of this file.
"""

import sys
from pathlib import Path

import ifcopenshell.util.element

from ifc_explorer import explorer
from ifc_explorer.explorer import sensors_in

from . import manifest as manifest_module

# What a field says when the model cannot supply it. Written into the manifest
# rather than left out, so a person can search for what is still open.
TODO_ROLE = "TODO"


# Named in the manifest so a reader knows which program produced the file.
# Issue 1762 asks for the converter name and version alongside the source
# hash, because without both there is no way to tell whether a derived file
# was produced by the tool the reader assumes.
CONVERTER = "ifc_explorer.to_manifest"
CONVERTER_VERSION = "0.1.0"

# Display ranges per measured quantity, in the unit given below. These are
# starting points for a district cooling substation, not measured values:
# chilled water supply sits around 6 °C and return around 12 °C, so a range of
# 4 to 16 covers normal operation with room either side. Whoever specifies the
# substation should replace them.
DISPLAY = {
    "TEMPERATURESENSOR": {"unit": "°C", "ramp": [4, 16], "measurement": "temperature"},
    "FLOWSENSOR": {"unit": "m³/h", "ramp": [0, 50], "measurement": "flow"},
    "PRESSURESENSOR": {"unit": "kPa", "ramp": [100, 600], "measurement": "pressure"},
    "HUMIDITYSENSOR": {"unit": "%", "ramp": [0, 100], "measurement": "humidity"},
}
UNKNOWN = {"unit": "TODO", "ramp": [0, 100], "measurement": "TODO"}


# The property a model uses to record a sensor's topic and unit, when it
# records them at all. IFC has no standard place for either, so exporters put
# them in a property set of their own naming. Any set is searched rather than
# one being named here, because naming one would make this converter work for
# one project and no other.
RECORDED_TOPIC = "MqttTopic"
RECORDED_UNIT = "Unit"

# The range a viewer draws its colours across, when the model states one. The
# table below holds one default per sensor type, and a default cannot know
# whether a temperature sensor is on a chilled water pipe or on an office wall.
# Those two want ranges that do not overlap, and a room drawn on the plant's
# scale reads as a plausible picture of nothing.
RECORDED_RANGE = ("RangeLow", "RangeHigh")

# A placement tool marks the sensors it invented, so a reader of the model
# alone cannot take a proposal for a survey. When every sensor says so, the
# manifest says so too: a viewer reads the model half, not each binding.
RECORDED_PROPOSED = "Proposed"
RECORDED_BASIS = "Basis"


def recorded(sensor, key):
    """A value the model itself records for a sensor, from any property set."""
    for properties in ifcopenshell.util.element.get_psets(sensor).values():
        value = properties.get(key)
        if value:
            return value
    return None


def topic_for(sensor, model, prefix=None):
    """Return the MQTT topic for a sensor.

    Prefers the topic already recorded in the model, whichever property set
    holds it, because reusing it keeps the manifest and the model saying the
    same thing.

    When the model has none, one is built from where the sensor sits:

        prefix/Building/floor/room/location/measurement/id

    `prefix` defaults to the project's name, so a manifest is namespaced by the
    thing it describes rather than by whoever wrote this converter.
    """
    found = recorded(sensor, RECORDED_TOPIC)
    if found:
        return found

    building = model.by_type("IfcBuilding")
    storey = ifcopenshell.util.element.get_container(
        sensor, ifc_class="IfcBuildingStorey"
    )
    space = ifcopenshell.util.element.get_container(sensor, ifc_class="IfcSpace")
    host = explorer.host_of(sensor)
    kind = DISPLAY.get(sensor.PredefinedType or "", UNKNOWN)

    project = model.by_type("IfcProject")
    parts = [
        prefix or (project[0].Name if project and project[0].Name else "site"),
        (building[0].Name if building and building[0].Name else "TODO"),
        (storey.Name if storey else "TODO"),
        (space.Name if space else "TODO"),
        (host.Name if host else "TODO"),
        kind["measurement"],
        sensor.Name or "TODO",
    ]
    return "/".join(str(p) for p in parts)


def ramp_of(sensor, fallback):
    """The colour range the model states for a sensor, or the type's default.

    Both ends or neither. Half a range is not a range, and silently keeping one
    default end beside one stated end would draw a scale nobody chose.
    """
    low = recorded(sensor, RECORDED_RANGE[0])
    high = recorded(sensor, RECORDED_RANGE[1])
    if low is None or high is None or float(low) >= float(high):
        return fallback
    return [float(low), float(high)]


def binding_for(sensor, model, bucket=None, prefix=None):
    """Build one manifest entry for one sensor."""
    kind = DISPLAY.get(sensor.PredefinedType or "", UNKNOWN)
    host = explorer.host_of(sensor)
    recorded_unit = recorded(sensor, RECORDED_UNIT)

    label = f"{host.Name} {kind['measurement']} {sensor.Name}" if host else (sensor.Name or "unnamed")

    return {
        "globalId": sensor.GlobalId,
        # The short tag a person says out loud, TS-01, which the IFC declares
        # as the sensor's Name. The viewer prints it on the card, and without
        # it the card would show a 22 character GlobalId instead.
        "id": sensor.Name or "",
        "label": label,
        "topic": topic_for(sensor, model, prefix),
        "bucket": bucket,
        "measurement": kind["measurement"],
        "unit": kind["unit"],
        "ramp": ramp_of(sensor, kind["ramp"]),
        # Recorded so a reader can see what the model itself claims, which may
        # differ from the display unit above.
        "model_unit": recorded_unit,
        "host": host.Name if host else None,
        "predefined_type": sensor.PredefinedType or "",
    }


def proposal_of(sensors):
    """Whether every sensor was proposed rather than surveyed, and on what basis.

    All of them, not any: one proposed sensor among real ones does not make
    the model a proposal, and marking it so would hide the real ones. That
    case has no answer here and is left for the person who mixed them.
    """
    if not sensors:
        return None, None
    if not all(recorded(sensor, RECORDED_PROPOSED) for sensor in sensors):
        return None, None
    bases = {recorded(sensor, RECORDED_BASIS) for sensor in sensors}
    return True, bases.pop() if len(bases) == 1 else None


def manifest_from(model, source_path, bucket=None, prefix=None):
    """Build the whole manifest for a model.

    `bucket` names the time series database that stores the readings. Left
    unset, every binding carries only its live half, which is honest: nobody
    but the deployment knows where its history lives.

    `prefix` is the first segment of a generated topic, defaulting to the
    project's own name.
    """
    sensors = list(sensors_in(model))
    proposed, basis = proposal_of(sensors)
    manifest = {
        # The file name, not the path it happened to sit at when this ran.
        # A manifest sits beside its model, and an absolute path from one
        # machine is noise on every other.
        "source": Path(source_path).name,
        "source_sha256": explorer.file_digest(source_path),
        "converter": f"{CONVERTER} {CONVERTER_VERSION}",
        "schema": explorer.summary(model)["schema"],
        "metre_scale": explorer.metre_scale(model),
        "bindings": [binding_for(s, model, bucket, prefix) for s in sensors],
    }
    if proposed:
        manifest["proposed"] = True
        if basis:
            manifest["basis"] = basis
    return manifest


def as_yaml(manifest):
    """Render the manifest as YAML.

    The shape comes from `ifc_explorer.manifest`, which is the one place that
    knows it. It used to be written out here as f-strings, which meant the
    schema was defined twice and drifted: the viewer read a different shape
    entirely.

    The notes are kept, because a generated file a person has to finish is more
    useful when it says where to look.
    """
    header = [
        "Binding manifest, generated from the IFC model.",
        "",
        "Schema follows the proposal in DTaaS issue 1762. Generated by",
        "ifc_explorer.to_manifest, so regenerate rather than edit by hand when",
        "the model changes.",
        "",
        "Anything marked TODO could not be read from the model and needs a",
        "person. See the notes at the end.",
    ]

    # Everything `manifest_from` produced except the bindings is the
    # provenance, passed through rather than listed again here. Listing it
    # twice is how `proposed` and `basis` were computed and then dropped on
    # the way out, and how the next field added would be dropped too.
    #
    # Provenance is asked for in issue 1762. The hash is what says whether
    # this manifest still describes the model beside it.
    provenance = {key: value for key, value in manifest.items() if key != "bindings"}
    provenance["source_sha256"] = provenance["source_sha256"] or "unknown"

    document = manifest_module.document(
        provenance,
        [
            manifest_module.binding(
                global_id=b["globalId"],
                label=b["label"],
                topic=b["topic"],
                unit=b["unit"],
                ramp=b["ramp"],
                sensor_id=b["id"],
                bucket=b.get("bucket"),
                measurement=b["measurement"],
                # The equipment the sensor is nested on, when the model says
                # so. Recorded as a field rather than a comment, so a reader
                # does not have to parse comments to find it.
                mounted_on=b["host"],
                # Not derivable from IFC, and named rather than left silent.
                role=TODO_ROLE,
            )
            for b in manifest["bindings"]
        ],
    )

    lines = manifest_module.to_yaml(document, header).splitlines()

    lines += [
        "",
        "# What could not be generated",
        "#",
        "# role: which of the four measurement points on a plate heat exchanger",
        "#   this sensor sits at, one of network_supply, network_return,",
        "#   building_supply, building_return. IFC records that a sensor is",
        "#   nested under equipment but not where on it, and delta-T is the",
        "#   difference between two specific points, so this cannot be guessed.",
        "#",
        "# mountedOn: the equipment a sensor is mounted on, read from IfcRelNests.",
        "#   Written as a field, so it can be read without parsing comments.",
        "#",
        "# ramp: the display range. The values above are typical for district",
        "#   cooling, not measured. Whoever specifies the substation should set",
        "#   them.",
        "",
    ]
    return "\n".join(lines)


def _option(argv, name):
    """Read `--name value` out of the arguments, or None."""
    return argv[argv.index(name) + 1] if name in argv[:-1] else None


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]

    if len(argv) < 2:
        print("Usage: python -m ifc_explorer.to_manifest <file.ifc> <manifest.yaml>",
              file=sys.stderr)
        return 2

    source = Path(argv[0]).expanduser().resolve()
    target = Path(argv[1]).expanduser().resolve()
    # Optional and unset by default, because no default is right for someone
    # else's deployment.
    bucket = _option(argv, "--bucket")
    prefix = _option(argv, "--topic-prefix")

    if not source.is_file() or source.suffix.lower() != ".ifc":
        print("Cannot run: expected an existing .ifc file", file=sys.stderr)
        return 2

    model = explorer.open_model(source)
    manifest = manifest_from(model, source, bucket=bucket, prefix=prefix)

    if not manifest["bindings"]:
        # Worth saying out loud. Every AU building model has this problem, and
        # an empty manifest looks like a bug rather than a fact about the file.
        print(f"No IfcSensor in {source.name}, so the manifest has no bindings",
              file=sys.stderr)

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(as_yaml(manifest))

    todos = as_yaml(manifest).count("TODO")
    print(f"{len(manifest['bindings'])} bindings written to {target.name}, "
          f"{todos} TODO markers left for a person")
    return 0


if __name__ == "__main__":
    sys.exit(main())
