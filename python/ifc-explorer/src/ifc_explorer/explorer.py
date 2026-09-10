"""Read an IFC file and answer simple questions about it.

Every function takes an open model and returns plain Python values. Nothing
here prints, so the same functions can feed a terminal today and a JSON file
later.

The whole module uses five IfcOpenShell calls, which is the entire basic API:

    ifcopenshell.open(path)          open a file
    model.schema                     which IFC version it is
    model.by_type("IfcWall")         find all elements of a class
    element.Name, element.GlobalId   read an attribute
    get_psets(element)               read the property sets
"""

import hashlib

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element
import ifcopenshell.util.placement
import ifcopenshell.util.shape
import ifcopenshell.util.unit
import numpy


def open_model(path):
    """Open an IFC file.

    This is the only function that touches the disk. Everything else takes
    an already open model, which is what makes the rest testable without a
    file.
    """
    return ifcopenshell.open(str(path))


def metre_scale(model):
    """Return the number that turns this model's lengths into metres.

    An IFC file declares its own units, and millimetres are common in files
    exported from architectural software. In such a file a three metre wall
    is stored as 3000.

    The factor is 1.0 for a model already in metres and 0.001 for one in
    millimetres. Multiply every length by it and the unit question
    disappears for the rest of the code.

    Without this, data/ifc/2116_FEAS_kedelhuset.ifc reports its storeys at
    -4740 instead of -4.74 metres.
    """
    return float(ifcopenshell.util.unit.calculate_unit_scale(model))


def summary(model):
    """Return the headline facts about the file.

    `schema` gives the family, IFC4X3. `schema_identifier` gives the exact
    release, IFC4X3_ADD2. The exact one is reported because enumerations
    change between addenda.
    """
    # IfcProduct covers everything with a place in the building: walls,
    # spaces, sensors, equipment. A large file also holds millions of
    # geometry entities, and counting those would say nothing useful.
    products = model.by_type("IfcProduct")

    return {
        "schema": model.schema_identifier,
        "objects": len(products),
        "metre_scale": metre_scale(model),
    }


def storeys(model):
    """Return the floors of the building, lowest first, in metres."""
    scale = metre_scale(model)
    found = []

    for storey in model.by_type("IfcBuildingStorey"):
        # Elevation is optional in IFC, so a missing one becomes 0.0
        # instead of crashing the report.
        raw = storey.Elevation if storey.Elevation is not None else 0.0
        found.append({
            "name": storey.Name or "<unnamed>",
            "elevation": round(float(raw) * scale, 3),
        })

    return sorted(found, key=lambda storey: storey["elevation"])


def count_by_class(model):
    """Count the objects of each kind, most numerous first.

    This is usually the most useful thing to look at first. It answers
    "is there any HVAC in this model?" in one screen.

    Returns a list of (class name, count).
    """
    counts = {}
    for product in model.by_type("IfcProduct"):
        # is_a() gives the class name of one object, like "IfcWall".
        name = product.is_a()
        counts[name] = counts.get(name, 0) + 1

    # Sort by count descending, then by name, so two runs on the same file
    # always print in the same order.
    return sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))


def elements(model, ifc_class):
    """Return the elements of one class, with their properties.

    Subtypes are included. Asking for IfcFlowController also returns valves,
    because by_type follows the schema hierarchy. That is usually what you
    want, and it surprises people expecting an exact match.

    An unknown class returns an empty list instead of raising, so a report
    can say "none" instead of crash. This matters for IFC2X3 files, where
    entities added in IFC4 simply do not exist.
    """
    try:
        found = model.by_type(ifc_class)
    except RuntimeError:
        return []

    return [_describe(element) for element in found]


def host_of(element):
    """Return the equipment an element is nested on, or None.

    IFC records this through `IfcRelNests`: the sensor is a component nested
    under the equipment. This is also why a nested sensor is not directly
    contained in a storey, since an element has exactly one answer to where it
    is, and for a nested one that answer is its host.

    Returns the entity instead of its name, because one caller wants the
    object and another wants the label, and the caller that wants a label can
    reach for `.Name` itself.
    """
    for relation in getattr(element, "Nests", None) or []:
        return relation.RelatingObject
    return None


def file_digest(path):
    """Return the SHA-256 of a file, or None when it cannot be read.

    Every derived artifact records this, so a reader can tell whether it still
    describes the model beside it: a re-export from Revit keeps the file name
    and changes every GlobalId inside.

    Read in one megabyte blocks, because the largest model here is 61 MB and
    there is no reason to hold it in memory to hash it. Returns None instead
    of raising, since a missing hash is worth less than the artifact and the
    artifact is still worth writing.
    """
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(block)
    except OSError:
        return None
    return digest.hexdigest()


# Smaller than any modelled building element. A washbasin is 60 centimetres
# and a door handle is 12, so nothing real survives being a thousand times
# smaller than this. Used only when a model gives no other way to decide.
SMALLEST_PLAUSIBLE_ELEMENT_M = 0.005

# How close a measured ratio has to be to count as a match. The two answers it
# separates differ by a factor of at least twenty-five, the inch, so this is
# wide enough for floating point and nowhere near wide enough to confuse them.
RATIO_TOLERANCE = 0.01


def geometry_scale(model, sample=64):
    """Return the factor that turns this model's geometry into metres.

    IfcOpenShell's geometry iterator normally returns metres already. It reads
    the file's own length unit and applies it, to the vertices and to the
    placements alike, so a model declared in millimetres comes back in metres
    and multiplying by the declared scale a second time shrinks it a thousand
    times.

    It does not always manage it. `tests/fixtures/wall_kernel_keeps_units.ifc`
    is a buildingSMART certification file that declares millimetres, holds
    millimetres, and comes back out of the kernel still in millimetres. Its
    unit assignment, its project and its representation contexts all read as
    ordinary, and what stops the kernel converting it was not identified. It
    is committed as a fixture so the claim can be rechecked instead of taken
    on trust. Either answer, the declared unit or none, is right for some file
    and wrong for another.

    So neither is trusted and the conversion is measured instead. The
    measurement is exact instead of a guess: `transformation.matrix` holds an
    object's position as the kernel computed it, and `get_local_placement`
    reads the same position straight out of the file with no unit applied.
    Their ratio is precisely what the kernel did, 1 when it applied nothing
    and 1/declared when it applied the file's unit.

    Only a sample is read, because this runs before the full conversion and a
    few dozen objects answer a question the whole model would answer no
    better.
    """
    declared = metre_scale(model)
    if declared == 1.0:
        # Both answers agree, so there is nothing to measure.
        return 1.0

    measured = _kernel_scale(model, declared, sample)
    return measured if measured is not None else _scale_from_size(model, declared)


def _kernel_scale(model, declared, sample):
    """What the geometry kernel did to the units, or None when unmeasurable.

    Returns 1.0 when the kernel already converted to metres, the declared
    scale when it left the file's own numbers alone, and None when no sampled
    object sits far enough from the origin for the ratio to mean anything.
    """
    settings = ifcopenshell.geom.settings()
    iterator = ifcopenshell.geom.iterator(
        settings, model, exclude=("IfcSpace", "IfcSite", "IfcOpeningElement")
    )
    if not iterator.initialize():
        return None

    # The object furthest from the origin, because a ratio taken from a
    # position of nearly zero is noise divided by noise.
    furthest = None
    for _ in range(sample):
        shape = iterator.get()
        found = _placement_pair(model, shape)
        if found is not None and (furthest is None or found[0] > furthest[0]):
            furthest = found
        if not iterator.next():
            break

    if furthest is None:
        return None

    _, raw, computed = furthest
    ratio = raw / computed
    if abs(ratio - 1.0) < RATIO_TOLERANCE:
        return declared
    if abs(ratio * declared - 1.0) < RATIO_TOLERANCE:
        return 1.0
    # Neither, which means the kernel did something this does not model. The
    # caller falls back to measuring sizes instead of acting on a number
    # nothing here explains.
    return None


def _placement_pair(model, shape):
    """One object's position read both ways: (magnitude, from file, computed).

    Returns None when the object cannot be looked up, carries no placement, or
    sits at the origin, where the two readings agree whatever the units are.
    """
    try:
        element = model.by_guid(shape.guid)
        placement = element.ObjectPlacement
    except (RuntimeError, AttributeError):
        return None
    if placement is None:
        return None

    try:
        raw = ifcopenshell.util.placement.get_local_placement(placement)[:3, 3]
    except (AttributeError, IndexError, TypeError):
        return None

    computed = numpy.asarray(shape.transformation.matrix).reshape(4, 4).T[:3, 3]

    # Compared on the axis the object is furthest along, so a building that
    # happens to sit on one axis still gives a usable number.
    axis = int(numpy.argmax(numpy.abs(raw)))
    if abs(raw[axis]) < 1e-6 or abs(computed[axis]) < 1e-12:
        return None
    return abs(raw[axis]), float(raw[axis]), float(computed[axis])


def _scale_from_size(model, declared):
    """Decide from the size of the objects, when no placement can say.

    This is the case for a file holding one object at the origin, which is
    what most single-element test files are. The rule is that applying the
    declared unit must not shrink the largest thing in the model below any
    real building element: a washbasin that comes out six tenths of a
    millimetre across means the kernel had already converted it.
    """
    settings = ifcopenshell.geom.settings()
    iterator = ifcopenshell.geom.iterator(
        settings, model, exclude=("IfcSpace", "IfcSite", "IfcOpeningElement")
    )
    if not iterator.initialize():
        return declared

    largest = 0.0
    while True:
        vertices = ifcopenshell.util.shape.get_vertices(iterator.get().geometry)
        if len(vertices):
            largest = max(largest, float((vertices.max(axis=0) - vertices.min(axis=0)).max()))
        if not iterator.next():
            break

    if largest == 0.0:
        return declared
    return declared if largest * declared >= SMALLEST_PLAUSIBLE_ELEMENT_M else 1.0


def _describe(element):
    """Build the summary of one element. Used by elements()."""
    # PredefinedType says which kind it is, for example TEMPERATURESENSOR.
    # Not every class has one.
    kind = getattr(element, "PredefinedType", None) or ""

    storey = ifcopenshell.util.element.get_container(
        element, ifc_class="IfcBuildingStorey"
    )

    return {
        "name": element.Name or "<unnamed>",
        "type": kind,
        "storey": storey.Name if storey else "",
        "global_id": element.GlobalId,
        "properties": _properties_of(element),
    }


def _properties_of(element):
    """Return the property sets of one element.

    Properties are never stored on the element itself. They hang off it
    through a relationship, and get_psets follows that relationship for us.

    The shape is {pset name: {property name: value}}.
    """
    psets = ifcopenshell.util.element.get_psets(element)

    # get_psets adds an "id" key holding the internal entity number. That is
    # bookkeeping from the library, not a property of the building object.
    return {
        name: {key: value for key, value in properties.items() if key != "id"}
        for name, properties in psets.items()
    }

def sensors_in(model):
    """Return the sensors, or nothing if the schema has no such entity.

    IfcSensor was added in IFC4. Asking an IFC2X3 file for it raises, and one
    of the project's models is IFC2X3, so this has to be handled instead of
    left to crash.
    """
    try:
        return model.by_type("IfcSensor")
    except RuntimeError:
        return []
