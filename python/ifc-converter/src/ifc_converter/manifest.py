"""The binding manifest, defined once.

A manifest says which sensor belongs to which object in a model. It is the
contract between the conversion step, which runs once per model in Python, and
the viewer, which runs in the browser every time someone opens the page.
Neither side needs to know the other, which is the point: DTaaS issue 1762
calls the manifest the load-bearing piece, because if its schema is right the
conversion, the viewer and the transport can each be replaced without touching
the others.

The shape is the one that issue proposes:

    model:
      geometry: model.glb
      metadata: model.json
      source: model.ifc
      source_sha256: <hex>
      converter: ifc_explorer.to_manifest 0.1.0
    bindings:
      - selector: { globalId: 1yETHMphv6LwABqR4Pbs5g }
        label: Room 204 temperature
        source:
          live: { transport: mqtt, topic: building/204/temp }
          history: { bucket: readings, measurement: temperature }
        display: { unit: "°C", ramp: [18, 26] }

Two fields are ours and are optional, so a reader that only knows the proposal
still reads a manifest this writes:

    id          the short tag a person says out loud, TS-01. The IFC declares
                it as the sensor's Name, and the viewer prints it on the card.
                Losing it would mean showing a 22 character GlobalId instead.
    mountedOn   the equipment a sensor sits on. Read from IfcRelNests for a
                declared sensor, and the object chosen for a proposed one, so
                either way the binding says what it is attached to.
    role        which measurement point on that equipment. IFC records that a
                sensor is nested under equipment and not where on it, so this
                is written as TODO when it cannot be derived. A generated file
                that hides its gaps is worse than one that names them.

This module exists because the shape used to be written out by hand in three
places, in two different forms: the generator produced the nested shape above
and nothing read it, while the viewer and the publisher read a flat shape that
a person maintained by hand. They agreed by luck instead of by construction.
"""

import json

import yaml

# The transport the live half of a binding uses. One value today, and named
# instead of repeated, because a second transport would be a change here.
LIVE_TRANSPORT = "mqtt"

# Where readings are stored. The history half of a binding names a bucket in
# the time series database the platform provides. There is no sensible default
# for someone else's deployment, so a caller that wants a history half says
# which bucket, and one that does not gets a binding with only a live half.
DEFAULT_BUCKET = None


def binding(global_id, label, topic, unit, ramp,
            sensor_id=None, measurement=None, bucket=DEFAULT_BUCKET,
            mounted_on=None, role=None):
    """Build one binding, in the agreed shape.

    `live` and `history` are separate on purpose, which is the issue's design:
    MQTT supplies the current value on the marker, and the time series database
    supplies the panel behind a click. Charting is not reimplemented inside the
    3D view.

    Optional parts are left out instead of written as null, so a manifest
    holds what is known and does not claim the rest.
    """
    source = {"live": {"transport": LIVE_TRANSPORT, "topic": topic}}
    if measurement and bucket:
        source["history"] = {"bucket": bucket, "measurement": measurement}

    entry = {
        "selector": {"globalId": global_id},
        "label": label,
        "source": source,
        "display": {"unit": unit, "ramp": list(ramp)},
    }
    if sensor_id:
        entry["id"] = sensor_id
    if mounted_on:
        entry["mountedOn"] = mounted_on
    if role:
        entry["role"] = role
    return entry


def document(model, bindings):
    """Build the whole manifest.

    `model` carries the provenance: which file this came from, its hash, and
    which converter produced it. Without those there is no way to tell whether
    a manifest still describes the model beside it, since a re-export keeps the
    file name and changes every GlobalId inside.
    """
    return {"model": model, "bindings": list(bindings)}


def to_json(manifest):
    """Serialise for the browser, which fetches JSON and not YAML."""
    return json.dumps(manifest, indent=2, ensure_ascii=False)


def to_yaml(manifest, notes=()):
    """Serialise for a person, who reads and sometimes writes the manifest.

    `notes` are comment lines placed at the top, because a generated file
    should say it is generated and where to look when something is missing.
    Comments do not survive a load, so they are the writer's job.
    """
    head = "".join(f"# {line}\n".rstrip() + "\n" for line in notes)
    body = yaml.safe_dump(manifest, sort_keys=False, allow_unicode=True,
                          default_flow_style=False)
    return f"{head}\n{body}" if head else body


def topic_of(entry):
    """The MQTT topic a binding listens on, or None when it has no live half."""
    return entry.get("source", {}).get("live", {}).get("topic")


def global_id_of(entry):
    """The object a binding is attached to."""
    return entry.get("selector", {}).get("globalId")
