# Security

## Reporting A Vulnerability

Please do not open a public issue for a security problem.

Report it through [GitHub's private vulnerability reporting][report] on this repository, or by email to the INTO-CPS Association maintainers. Include what you did, what happened, and what you expected, so the problem can be reproduced.

[report]: https://github.com/INTO-CPS-Association/ifc-utils/security/advisories/new

You will get an acknowledgement, and an assessment of whether the report is accepted, with a fix or an explanation to follow.

## What These Packages Handle

They read IFC files that a person supplied, which are untrusted input. The rules for manifests, conversion in the browser and values drawn on a page belong to bim-kit and moved with it to [`kits/bim-kit`](https://github.com/INTO-CPS-Association/dtaas-extensions/tree/main/kits/bim-kit) of the dtaas-extensions repository.

## Supply Chain

Dependencies are pinned to exact versions. No dependency or version published less than ten days ago is accepted, because most malicious releases are found and pulled within days of publication. The Python workflow enforces the rule with `pip install --uploaded-prior-to P10D`, so it covers the dependencies of dependencies too.

Nothing is published to a package registry from this repository.
