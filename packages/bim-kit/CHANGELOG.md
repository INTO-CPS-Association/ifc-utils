# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package follows [semantic versioning](https://semver.org/).

## [Unreleased]

## [0.1.1]

### Added

- `BuildingModels` takes `onPersistGeometry`, called with a model and the GLB when that model was converted in the browser because no geometry sat beside it. A host that stores the bytes stops the model being reconverted on every visit. The package does not store anything itself and holds no opinion about where the library is written to, so the transport stays the host's choice, the same way readings are. The GLB is the model alone, before any marker or outline, so it reloads as the same shape a GLB produced outside the browser has, with the `GlobalId` of each object carried in glTF `extras`.
- `BimCanvas` takes `onConverted`, the lower half of the same feature: it is handed the converted GLB once, and the exporter that produces it is fetched only when a host asks for the bytes, so a viewer that never stores a conversion never pulls it in.
- `BuildingModels` shows each model by the name its IFC file gives the building, read from the file itself, with no separate file of names. Only the first 64 KB of each file is requested, with an HTTP range, since the project and the building are named within the first 6 KB of every model this was written against, including one of 64 MB. Twelve models are named in about 150 ms, and a server that ignores the range is read no further than that. The name is the project's `LongName`, then its `Name`, then the building's; template text and job numbers are skipped, and a name two files share is left out for both. `ifcBuildingName`, `decodeStepString`, `readIfcName` and `uniqueNames` are exported.
- A model whose file gives no name shows its file name with its separators read as spaces, `Building_1912_AK_v4` as "Building 1912 AK v4", through `readableName`. The case is left alone, because in these names it carries meaning. The name is written into a file that lacks one with `ifc-set-name` in `ifc-converter`.

### Changed

- `MODELS_DIRECTORY` is deprecated, and a host passes `directory` to `BuildingModels` instead. Where a deployment keeps its models is that deployment's convention, so the package should be told and not assume it. The default stays for compatibility with 0.1.0, which exported it, and goes in 0.2.0.
- The model is chosen from a menu instead of a list down the page, and the one being drawn is named above its own drawing. A library with a dozen IFC files pushed the viewer below the fold, so a person scrolling names had no way to tell a model was drawn underneath. The menu keeps every file one click away, the name and the size stay in the menu where there is room for them, and a line under it says how many models the library holds.
- The class legend rows are 32 pixels high. A host theme that gives every list button a 44 pixel minimum, right for a navigation drawer, made each row of the legend that tall and pushed most of a dozen classes out of sight. Thirty two pixels stays above the 24 pixel target size WCAG 2.2 sets at level AA.
- The model picker sits on the page at the width of the search field on every other page, instead of filling the row inside a padded panel of its own, which made it read as a different kind of control.
- The model picker is named by a heading above it, `IFC Model`, instead of by a floating label inside the control, so the section is named the same way the chosen model is named above its drawing.
- The building models view no longer renders its own page heading or the copy about where models are uploaded. That framing is the host application's, so a page does not show the title twice and the package stays a viewer instead of carrying deployment-specific text.

### Fixed

- The page no longer repaints the model without end once it is drawn. A host that passes no readings, as DTaaS does, got a new empty map on every render, and the effect that applies readings depends on it and repaints, which rendered again. The viewer applied readings and refreshed every material continuously for as long as the page was open. The default is now one map made once.
- The model picker has an accessible name. The label was passed as `aria-labelledby` straight to the select, where it lands on the outer box and not on the element with the combobox role, so a screen reader announced a combobox with no name. It is passed as `labelId`, which is the prop MUI puts on that element.
- The heading above the drawing names the model once its name has been read from its file. It was bound to the object picked from the menu, so a model chosen before its name arrived kept its file name there, while the chip beside it moved on.
- The page says when it is storing a conversion, and says when it has. A large model goes up in dozens of pieces, and the page used to show nothing while that happened, so a person who looked at the menu in the meantime saw the model still marked From IFC and concluded the save had failed. It shows a progress message while saving, a success message once stored, and a warning when the store is refused, since that cost lands on the next visit.
- The model being drawn is described by the latest listing. The chosen model was the object picked from the menu and was never refreshed, so after a save the chip beside its name and the notice that it was read from the IFC file both stayed wrong until the model was chosen again. The canvas stays bound to the object it was mounted with, so the model already on screen is not redrawn.
- Surfaces no longer speckle against each other as the camera moves in. The far clipping plane was floored at five kilometres whatever the model measured, so a substation twenty metres across carried a depth range fifty thousand times its near plane and ran out of the precision needed to order two faces in the same plane, which an IFC model has wherever a slab meets a wall. The plane is a ceiling now and follows the model: for that substation the ratio drops from 50,000 to 1,407.

## [0.1.0]

The first published version. What it does:

### Added

- A viewer for a GLB produced from an IFC model, with the building's own colours, object outlines and a coordinates gizmo.
- Reading and validating a binding manifest, the file that maps an IFC `GlobalId` to a sensor and its MQTT topic. Every error names the binding and the field, because a manifest is written by a person and will frequently be wrong.
- Resolving a binding to the object it names, by `globalId`, `nodeName` or `expressId`. A binding whose object is absent is reported and counted instead of dropped, which is the ordinary consequence of a model being re-exported.
- Live readings drawn on the model. The package subscribes to nothing and draws what it is handed, so the transport is the host's choice.
- Four heatmap scopes: per sensor, per room, per storey and per building. Per sensor rasterises the floor and floods it from each sensor, so walls stop the colour and a doorway lets it through, which is the only scope that says anything on a model that declares no `IfcSpace`.
- Sensor alerts: a sensor that has gone quiet, a value outside the range the model declares for it, a unit the payload and the manifest disagree on, and a value the payload says was not measured directly.
- A floor filter, a transparency mode, a selection halo, a class legend, a property panel and a keyboard shortcut table.
- React components for a host that wants the whole page, and a renderer-free entry point for a host that only needs the manifest logic.
- Converting IFC to glTF in the browser, reached at `./converter`. The `web-ifc` geometry kernel is embedded as base64, so a consumer installs one package and serves no extra file, and a production build contains no `.wasm` and fetches none.

### Notes on the shape

This was two packages during development, a viewer and a converter. They are one because the split delivered nothing: the converter was a normal dependency of the viewer, so installing the viewer installed both anyway, and a host had to declare a package it never imported for the inner dependency to resolve. One package is one install, one version and one changelog.

### Notes

Versions 0.10.0 to 0.19.0 exist in this repository's git history and were never published to any registry. They were the development of the above, and the entries below are kept for the record.

---

## Development History, Unpublished

## [0.19.0]

### Added

- `alerts.ts`: what is wrong with a sensor, said in words. A sensor that has gone quiet, a value outside the range the model declares for it, a unit the payload and the manifest disagree on, and a value the payload says was not measured directly. Every bound comes from the manifest, which the converter reads out of the sensor's own property set, so a building with different limits gets different alerts without a line of the package changing.
- `Reading.kind` carries the payload's own word for what a value is: a sample read off the instrument, an average over an interval, a prediction, the output of a simulation. Without it a viewer presents all four as a measurement.
- `SensorCards` shows those alerts as chips, with the sentence behind each on hover, and a count above the cards so a person knows whether any of twenty needs them before reading them.
- `viewer/glow.ts`: a halo around the selected object, built from the object's own geometry drawn a little larger and added to the light already there. The selection was a translucent repaint, which works on a wall and leaves an 85 mm wall thermostat an 85 mm yellow speck. The halo grows by a fixed margin in metres instead of by a scale factor, so a thermostat gains a ring a person can see across a room and a wall does not become a second wall.
- `SceneView.attachGlow`, so the decision of when the halo is on sits beside the rest of the appearance rules while the scene stays owned by whatever draws.

### Fixed

- The Per Sensor heatmap described only the first floor looked at. The field was keyed on the bindings alone, so changing storey never rebuilt it, and every sensor in the building was flooded onto whichever plan was on screen. The storey is now part of the key, and only the sensors standing on the floor being drawn feed it.

## [0.18.0]

### Added

- A Per Sensor heat scope, drawn as a sheet over the floor. Each part of the floor takes the reading of the sensor whose walk reaches it, so a wall between two rooms is where one colour ends. It answers what the other three scopes cannot on a model that declares no `IfcSpace` and draws one storey, where every object is in the same zone.
- `SceneView.zoneFor`, `SceneView.buildField`, `SceneView.zoneAtCell` and `SceneView.heatZones`, and `viewer/fieldSheet.ts` which draws it.
- `ViewerHandle.drawField`, called by whatever changes a reading or a scope. It is separate from `view.refresh` because that repaints the model's own objects and the sheet is beside the model.

### Changed

- `zonesOf` and `availableScopes` take the zone from the caller instead of a place to look one up in. `readings.ts` no longer knows what a room or a storey is, which was IFC knowledge in a module about readings, and it is what lets a scope be a position on the plan.

## [0.17.0]

### Added

- `viewer/field.ts`: which sensor reaches each point of a floor, as a grid that spreads by walking. Walls block, doors open again because a doorway is how air moves between rooms, and furniture does not block because air moves over a desk. It answers what the room, floor and building groupings cannot on a model that declares no `IfcSpace` and draws one storey, where every object is in the same zone and a dozen readings average into one colour over everything.
- Straight-line distance was the obvious alternative and goes through walls: a sensor in one office colours the office next door, which shares no air with it.
- The idea of a grid over the plan comes from ProBIM's `ExportHeatmap`, which samples a floor into cells and scores each one.

## [0.16.0]

### Changed

- A heat scope is offered when the sensors divide into more than one group, instead of when the model declares the grouping. A model that declares ten storeys and carries all ten of its sensors on one of them could be grouped by storey and gained nothing from it: the whole building took one colour, which is the building mean under another name.
- `availableScopes` takes the bindings and a lookup instead of a summary of what the model declares, and `SceneView.scopesFor` answers it for a set of bindings.

### Added

- Each legend row carries the number of objects of its class. On the row instead of behind a hover, because a count is what a person wants from a legend.
- `SceneView.classCounts`.

## [0.15.0]

### Added

- Picking a class in the legend lights every object of that class. A legend that only names colours answers "what is this colour", and the question a person has in front of a grey building is "where are the columns". The selection still wins over it, so pointing at one object still says which one.

## [0.14.0]

### Added

- A thin line along the edges of every object. Without it a building is a field of grey boxes that touch, and where one wall ends and the next begins is invisible. It does more for legibility than any change of colour, because the colours come from the model and most models paint a whole discipline the same.

### Changed

- The background and the field of view match the viewer this package was taken from, `#e9edef` and 45 degrees. A lighter background washes into the pale surfaces of a model and the silhouette disappears, and a wider lens bends the walls of a room outwards.
- The properties button reads Properties instead of counting them.

## [0.13.0]

### Changed

- The property sets move behind a button that says how many fields it holds, and open in a dialog. One interior wall of a real model carries around sixty fields across twelve sets, which under a click is not an answer but a haystack. Nothing is dropped: a person asking about a wall's U-value has nowhere else to look.
- A sensor that has not reported is drawn in a grey that is not on the ramp. It used to sit at the cold end of its own ramp, so a temperature marker read as four degrees while the card beside it said no message had ever arrived.

## [0.12.0]

### Added

- The object panel shows the object's name, its predefined type, what it is hosted in, and its size in metres measured from the geometry. It also shows the property sets the model carries, which it could always draw and was never given, so every object looked like it held four facts when the tree holds dozens.
- `SceneView.sizeOf`, the extent of one object along each world axis.
- The blue notes close. They are worth reading once, and after that they are two paragraphs between a person and the model. What was closed is remembered by its text, so another model's note still appears.

### Changed

- The two lamps were at 2 each, which clipped every pale surface to white: a window frame, a plastered wall and a ceiling all came out the same flat white and the model read as untextured instead of as lit. They now match the viewer this was taken from, 0.75 and 0.9, and the sun sits above and to one side so the faces of a box differ.

### Removed

- The paragraph explaining that a model binds no sensors. Most architectural models declare none, so it appeared almost always, and a person reads it once and then scrolls past it forever.

## [0.11.2]

### Changed

- When the library address answers with a web page, the message now states the likely cause instead of only the fact. Both times this happened the cause was the user name: once not known yet, once a deployment serving a workspace under a different name than the one signed in. Naming that turns a long search into a line of configuration.

## [0.11.1]

### Fixed

- A response that is not JSON now says so and names the address, instead of surfacing "Unexpected token '<'". A library URL is built by the host from parts, and asking before every part is known lands the request on the host application itself, which answers with its own page and HTTP 200. Blaming JSON for that sends the reader to the wrong place.

## [0.11.0]

### Added

- An axes indicator in the bottom left of the view. A building on a plain background gives a person nothing to tell which way is up until they recognise a roof, and a model that arrives rotated then looks like an odd camera angle instead of a bug. This repository had exactly that: a converter laid every model on its side and it went unnoticed for weeks.

## [0.10.2]

### Fixed

- A manifest whose placements are proposed instead of surveyed now says so. A tool that guesses where a sensor sits marks its output, and drawing that guess as a fact is how it ends up in a report as a measurement.
- "1 sensors" now reads "1 sensor".
- Switching to a model with no manifest kept the previous model's sensors on screen.

## [0.10.1]

### Fixed

- The floor picker drew its label on top of its value, so All Floors read as "AlbFloors". Showing the empty choice at all stops the label floating on its own, so the label has to be pinned.

## [0.10.0]

### Added

- The three views the demo this came from had and this did not: a card per sensor, the heatmap legend, and the legend of what the model's own colours mean. The class legend reads the colours the model arrived with instead of a table written here, because an architect assigned them and a legend that invented its own would describe a different building.
- `BuildingModels` takes the readings and the feed state as properties. Pushed in instead of fetched, so a broker, a database and a test all reach the viewer the same way, and a burst of messages is one repaint instead of one per message.
- `SceneView.classColours`, which the class legend reads.

### Fixed

- The floor picker rendered nothing while All Floors was chosen, because its value is the empty string. An empty control reads as broken instead of as a choice.

## [0.9.0]

### Added

- The interface: a toolbar generated from the shortcut table, a floor picker, a panel saying what the selected object is, and the shortcut list. The table binds the keys, builds the toolbar and writes the help, so a button and a key cannot disagree.
- `BimCanvas` hands the page a `SceneView` and the camera commands, and reports what the cursor is over and what was clicked. Picking only considers visible objects, so a floor filter that hides a wall also stops that wall being clicked through the floor above it.
- The property tree is loaded beside the model, which is what gives the floor filter and the heatmap something to group by. A model without one still draws.
- `@mui/icons-material` as an optional peer, so the toolbar uses the host's own icon set instead of introducing a second design language.

## [0.8.0]

### Added

- The `./viewer` entry point: the three.js layer with no React, so a consumer that draws its own interface never pulls React and MUI in behind it.
- `SceneView`, which holds the state of one loaded model. One place decides what an object is painted with and one place writes `visible`, which is what stops the floor filter bringing back a slab the lid toggle just removed.
- `bandsFrom`, which measures where the floors are from the objects instead of reading the elevations a header declares. Two models declare millimetres and carry metres, one lists its storeys out of order, and one names four floors that sit within twenty centimetres of each other.
- The reading helpers: how old a value is, whether it counts as current, and what the current ones average to per zone.

## [0.5.0]

### Added

- `engines`, `sideEffects` and `publishConfig`, so a bundler can drop what a host does not use and `npm publish` reaches the right registry.

## [0.4.0]

### Fixed

- `BimCanvas` is no longer re-exported from the React entry point. The static re-export undid the dynamic import inside `BuildingModels`, which put three.js in the host's main chunk: 640 KB that should have been a separate file fetched only when a model is opened. It is reachable at `./react/canvas` for a consumer that genuinely wants the canvas alone.

## [0.3.0]

### Removed

- The CommonJS build. `tsc` turns a dynamic `import()` into `Promise.resolve().then(require(...))`, which a bundler cannot split, so shipping CommonJS defeated the lazy loading the package exists to support. The package is ES modules only.

## [0.2.0]

### Added

- The `./react` entry point: `BuildingModels`, a page that lists the models in a library and draws the one chosen, with markers resolved from a manifest. React, MUI and three.js are optional peer dependencies of this entry point and of nothing else.

## [0.1.0]

### Added

- The binding accessors, the selector resolver and the colour ramp, with no dependencies at all.
- `./schema`, a zod validator for a manifest, reporting which binding and which field failed.
