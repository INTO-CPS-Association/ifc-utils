# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package follows [semantic versioning](https://semver.org/).

## [Unreleased]

## [0.1.0]

The first published version. What it does:

### Added

- Converting an IFC model to glTF binary in the browser, so a platform needs no converter service and a person putting an IFC file in their library is the whole workflow.
- The `web-ifc` geometry kernel compiled to WebAssembly and embedded in the package as base64, so a consumer installs one package and serves no extra file. There is no `postinstall` copy step to forget, no MIME type to configure and no `wasm-unsafe-eval` policy to add, which is what an air-gapped install needs.
- The IFC `GlobalId` written into glTF `extras` on every node, which is what lets a binding manifest name an object and have that name survive an export.
- Colour taken from the model's own materials and converted to linear space, so a building looks the way its architect coloured it.
- Provenance in the output: the hash of the source file and the name and version of the converter, so a stale artifact is detectable.

### Notes

Versions 0.1.0 through 0.2.1 exist in this repository's git history and were never published to any registry. They were the development of the above.

The embedded WebAssembly binary is `web-ifc`, under the Mozilla Public License 2.0 and redistributed unmodified. The notice that licence requires is in `THIRD-PARTY-NOTICES.md`, inside the published tarball.
