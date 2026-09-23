# Contributing

Thank you for looking. This repository holds small, single-purpose packages, so most changes are small too.

## Before You Start

Open an issue describing what is wrong or missing. A short description of the problem is more useful than a patch that solves the wrong one, and it avoids two people writing the same fix.

## Working On A Package

Each package under `packages/` is self-contained and uses the same three commands:

```bash
cd packages/<name>
npm install
npm run build     # ES modules and type declarations into dist/
npm test          # typecheck, then the suite against dist/
```

The tests import from `dist/`, not from `src/`. A test that passes on the source and fails on the artifact is a test that did not do its job.

## What A Change Should Carry

**A test.** A bug fix without a regression test is incomplete, because nothing stops the bug coming back.

**A reason.** Comments say why, not what. A reader can see what the code does; what they cannot see is the case that made it necessary.

**No new dependency without a reason that survives being said out loud.** The core of `bim-kit` imports nothing at all, and that is not an accident: it is what lets it be tested where WebGL, workers and WebAssembly do not exist. Heavy things are peer dependencies, so a host that already has React, MUI or three.js never receives a second copy.

**Nothing newer than ten days.** A dependency or a version published less than ten days ago is not accepted. Freshly published releases are the main vector for supply chain attacks, and most malicious versions are found and pulled within days. Pin exact versions.

## Style

Write for the person who joins in six months with no context. Prefer the direct solution to the clever one. Keep to the patterns already in the file you are editing.

## Releasing

A release publishes. [The workflow](.github/workflows/npm.yml) builds, tests and publishes `bim-kit` when a GitHub release is published whose tag starts with `bim-kit-v`, and does not publish on a push or a pull request. It publishes to the organisation's GitHub Packages registry with the workflow's own token, and to npmjs with trusted publishing, so no npm token is stored in the repository and npm records where the package was built.

Bump the version in the package's `package.json`, move the `Unreleased` entries of its `CHANGELOG.md` under the new version, merge, then publish a release tagged `bim-kit-v<version>`.

Each release is also archived on Zenodo with a DOI, so a paper can cite the exact version it used. Zenodo takes the authors and the description from [CITATION.cff](CITATION.cff), and nothing else has to be kept in step with it. Archiving starts once an owner of the organisation turns the repository on in Zenodo's GitHub settings. Until then a release publishes to the registries and receives no DOI.
