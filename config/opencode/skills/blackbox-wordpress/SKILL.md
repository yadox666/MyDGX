---
name: blackbox-wordpress
description: Reconstructs plausible initial-access paths for an explicitly authorized WordPress incident using external discovery, source review, isolated lab validation, and forensic correlation.
compatibility: opencode
---

# WordPress black-box initial-access reconstruction

Use this specialized workflow only for an organization-owned WordPress site
with explicit authorization. Potentially invasive reproduction belongs in an
isolated, production-equivalent lab with synthetic data.

## Objective

Investigate technically plausible paths from unauthenticated external access to
unauthorized server-side file modification or code execution:

`EXTERNAL ACCESS → SECURITY BOUNDARY FAILURE → FILE WRITE OR CODE EXECUTION`

Do not assume a known vulnerability caused the incident. Technical feasibility
does not prove historical attribution.

## Separation of evidence

Maintain two independent records until initial hypotheses exist:

- `attacker-view.md`: facts discoverable by an unauthenticated visitor;
- `forensic-correlation.md`: defender artifacts, timestamps, versions, file
  locations, ownership, permissions, and known vulnerabilities.

Do not let forensic conclusions bias initial external discovery.

## Discovery priorities

Map externally observable:

- WordPress core behavior, plugins, themes, and versions;
- REST routes and public AJAX actions;
- uploads, media processing, forms, imports, exports, backups, and restores;
- authentication, registration, recovery, and exposed administration;
- client-side JavaScript, generated URLs, errors, and third-party components.

Prioritize inputs that cross authorization boundaries or reach filesystem
operations. The presence of a dangerous function alone is not a vulnerability.

## Hypothesis workflow

For each candidate:

1. Identify attacker-controlled input and entry point.
2. Identify the expected authentication or authorization boundary.
3. Trace input to sensitive server-side behavior using source when available.
4. State required capabilities, preconditions, expected impact, and
   contradictory evidence.
5. Design the smallest safe validation.
6. Reproduce only in the isolated lab using harmless proof markers.
7. Record outcome and decide whether an independent path is justified.

For chains, document every required capability, boundary, hypothesis, evidence,
validation status, and resulting capability. Confirm a chain only when every
necessary boundary failure is independently supported.

## Prohibited actions

- No real webshells, persistence, production file modification, customer-data
  access, uncontrolled fuzzing, resource exhaustion, or credential attacks.
- Do not expand beyond assets recorded in `scope.md` or `pentest/scope.md`.
- Ask before any invasive test, bypass attempt, or state-changing action.

## Investigation files

Maintain:

```text
scope.md
attacker-view.md
attack-surface.json
entry-point-inventory.csv
hypotheses.md
attack-paths.md
lab-validation.md
forensic-correlation.md
MEMORY.md
reports/external-attack-surface.md
reports/initial-access-candidates.md
reports/controlled-reproduction.md
```

Rank candidates by evidence and plausibility. Reports must separate external
observations, lab-confirmed reproduction, and uncertain historical attribution.
