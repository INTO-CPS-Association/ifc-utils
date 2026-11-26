# Contributing

Thank you for looking. This repository holds small, single-purpose packages, so most changes are small too.

## Before You Start

Open an issue describing what is wrong or missing. A short description of the problem is more useful than a patch that solves the wrong one, and it avoids two people writing the same fix.

## Working On A Package

Each package under `python/` is installed from its folder and tested with pytest:

```bash
pip install -e "python/ifc-explorer[test]" -e "python/ifc-converter[test]"
python -m pytest python/ifc-explorer python/ifc-converter
```

The browser package bim-kit moved to [`kits/bim-kit`](https://github.com/INTO-CPS-Association/dtaas-extensions/tree/main/kits/bim-kit) of the dtaas-extensions repository. Changes to it go there.

## What A Change Should Carry

**A test.** A bug fix without a regression test is incomplete, because nothing stops the bug coming back.

**A reason.** Comments say why, not what. A reader can see what the code does; what they cannot see is the case that made it necessary.

**No new dependency without a reason that survives being said out loud.** Every dependency is one more thing to keep current and one more place a supply chain attack can enter.

**Nothing newer than ten days.** A dependency or a version published less than ten days ago is not accepted. Freshly published releases are the main vector for supply chain attacks, and most malicious versions are found and pulled within days. Pin exact versions.

## Style

Write for the person who joins in six months with no context. Prefer the direct solution to the clever one. Keep to the patterns already in the file you are editing.

## Releasing

A release is a GitHub release with a tag. Nothing is published to a package registry from this repository.

Each release is also archived on Zenodo with a DOI, so a paper can cite the exact version it used. Zenodo takes the authors and the description from [CITATION.cff](CITATION.cff), and nothing else has to be kept in step with it. Archiving starts once an owner of the organisation turns the repository on in Zenodo's GitHub settings. Until then a release publishes to the registries and receives no DOI.
