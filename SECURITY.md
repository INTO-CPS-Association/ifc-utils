# Security

## Reporting A Vulnerability

Please do not open a public issue for a security problem.

Report it through [GitHub's private vulnerability reporting][report] on this repository, or by email to the INTO-CPS Association maintainers. Include what you did, what happened, and what you expected, so the problem can be reproduced.

[report]: https://github.com/INTO-CPS-Association/ifc-utils/security/advisories/new

You will get an acknowledgement, and an assessment of whether the report is accepted, with a fix or an explanation to follow.

## What These Packages Handle

They read files a person uploaded and messages a broker delivered. Both are untrusted input, and the packages treat them that way:

- **A manifest is validated before use.** It is written by a person and will frequently be wrong. Validation reports which binding and which field failed, and a manifest that fails is refused instead of half applied, so none of its topics is subscribed. A topic holding the MQTT wildcards `+` or `#` fails validation, because it would subscribe to every sensor that matched.
- **An IFC file above 200 MB is not converted in the browser.** Conversion holds the file and its geometry in the tab's memory, so the page names the file and its size instead of downloading it.
- **A selector that names nothing, or names two objects, is refused.** Guessing which object was meant would present a guess as a fact.
- **A value read from a model, a manifest or a payload is never treated as markup.** React escapes by default and nothing here uses `dangerouslySetInnerHTML`.
- **Nothing is fetched from a third party at runtime.** Every asset a package needs is part of the package, which is also what makes an air-gapped install possible.

## Supply Chain

Dependencies are pinned to exact versions. No dependency or version published less than ten days ago is accepted, because most malicious releases are found and pulled within days of publication. The one exception is a package of the INTO-CPS Association that this project depends on, such as `@into-cps-association/dtaas-sdk`. It may be taken the day it is published, after the integrity hash in the lock file is checked against the one the registry serves for that version.

Publishing happens only from a GitHub release, through [the workflow](.github/workflows/npm.yml), using the short-lived token that GitHub Actions issues for that run. There is no long-lived publish token to leak.
