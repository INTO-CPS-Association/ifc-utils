# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package follows [semantic versioning](https://semver.org/).

## [Unreleased]

## [0.14.0]

### Added

- A thin line along the edges of every object. Without it a building is a field of grey boxes that touch, and where one wall ends and the next begins is invisible. It does more for legibility than any change of colour, because the colours come from the model and most models paint a whole discipline the same.

### Changed

- The background and the field of view match the viewer this package was taken from, `#e9edef` and 45 degrees. A lighter background washes into the pale surfaces of a model and the silhouette disappears, and a wider lens bends the walls of a room outwards.
- The properties button reads Properties rather than counting them.

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

- The two lamps were at 2 each, which clipped every pale surface to white: a window frame, a plastered wall and a ceiling all came out the same flat white and the model read as untextured rather than as lit. They now match the viewer this was taken from, 0.75 and 0.9, and the sun sits above and to one side so the faces of a box differ.

### Removed

- The paragraph explaining that a model binds no sensors. Most architectural models declare none, so it appeared almost always, and a person reads it once and then scrolls past it forever.

## [0.11.2]

### Changed

- When the library address answers with a web page, the message now states the likely cause rather than only the fact. Both times this happened the cause was the user name: once not known yet, once a deployment serving a workspace under a different name than the one signed in. Naming that turns a long search into a line of configuration.

## [0.11.1]

### Fixed

- A response that is not JSON now says so and names the address, instead of surfacing "Unexpected token '<'". A library URL is built by the host from parts, and asking before every part is known lands the request on the host application itself, which answers with its own page and HTTP 200. Blaming JSON for that sends the reader to the wrong place.

## [0.11.0]

### Added

- An axes indicator in the bottom left of the view. A building on a plain background gives a person nothing to tell which way is up until they recognise a roof, and a model that arrives rotated then looks like an odd camera angle instead of a bug. This repository had exactly that: a converter laid every model on its side and it went unnoticed for weeks.

## [0.10.2]

### Fixed

- A manifest whose placements are proposed rather than surveyed now says so. A tool that guesses where a sensor sits marks its output, and drawing that guess as a fact is how it ends up in a report as a measurement.
- "1 sensors" now reads "1 sensor".
- Switching to a model with no manifest kept the previous model's sensors on screen.

## [0.10.1]

### Fixed

- The floor picker drew its label on top of its value, so All Floors read as "AlbFloors". Showing the empty choice at all stops the label floating on its own, so the label has to be pinned.

## [0.10.0]

### Added

- The three views the demo this came from had and this did not: a card per sensor, the heatmap legend, and the legend of what the model's own colours mean. The class legend reads the colours the model arrived with rather than a table written here, because an architect assigned them and a legend that invented its own would describe a different building.
- `BuildingModels` takes the readings and the feed state as properties. Pushed in rather than fetched, so a broker, a database and a test all reach the viewer the same way, and a burst of messages is one repaint instead of one per message.
- `SceneView.classColours`, which the class legend reads.

### Fixed

- The floor picker rendered nothing while All Floors was chosen, because its value is the empty string. An empty control reads as broken rather than as a choice.

## [0.9.0]

### Added

- The interface: a toolbar generated from the shortcut table, a floor picker, a panel saying what the selected object is, and the shortcut list. The table binds the keys, builds the toolbar and writes the help, so a button and a key cannot disagree.
- `BimCanvas` hands the page a `SceneView` and the camera commands, and reports what the cursor is over and what was clicked. Picking only considers visible objects, so a floor filter that hides a wall also stops that wall being clicked through the floor above it.
- The property tree is loaded beside the model, which is what gives the floor filter and the heatmap something to group by. A model without one still draws.
- `@mui/icons-material` as an optional peer, so the toolbar uses the host's own icon set rather than introducing a second design language.

## [0.8.0]

### Added

- The `./viewer` entry point: the three.js layer with no React, so a consumer that draws its own interface never pulls React and MUI in behind it.
- `SceneView`, which holds the state of one loaded model. One place decides what an object is painted with and one place writes `visible`, which is what stops the floor filter bringing back a slab the lid toggle just removed.
- `bandsFrom`, which measures where the floors are from the objects rather than reading the elevations a header declares. Two models declare millimetres and carry metres, one lists its storeys out of order, and one names four floors that sit within twenty centimetres of each other.
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
