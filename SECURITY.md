# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| Working draft **0.11.x** (this repository) | Yes — current normative catalog |
| Older draft tags | Best-effort; prefer upgrading to the latest published SemVer |

## Reporting a vulnerability

Do **not** open a public GitHub issue for security-sensitive reports about this repository (credential leaks in examples, supply-chain risks in published packages, or integrity bugs in evaluation helpers).

1. Email the stewardship contact published on [https://stackrail.io/aprf/rfc/](https://stackrail.io/aprf/rfc/) with subject `APRF security`.
2. Or open a **private** vulnerability report on GitHub for [stackrail-io/APRF](https://github.com/stackrail-io/APRF) if private reporting is enabled.

Please include: affected package or Check ID, reproduction steps, impact, and whether a fix is already proposed.

We aim to acknowledge reports within **7 days** and to publish a fix or advisory as part of the next draft SemVer when warranted.

## Scope

In scope: normative catalog integrity, package publish artifacts, CI gates in this repo.

Out of scope: product detectors, Assess UI, and StackRail cloud services — report those through the product’s own security channel.
