# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package follows [semantic versioning](https://semver.org/).

## [Unreleased]

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
