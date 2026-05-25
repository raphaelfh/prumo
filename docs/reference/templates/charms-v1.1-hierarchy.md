---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
template_version: '1.1.0'
---

# CHARMS v1.1 — visual hierarchy

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh
> **Template ID:** `438e0126-ce20-4786-80e4-1700706b045c`
> **Version:** 1.1.0 — applied in the database since 2026-05-17.

Reference: <https://bmcmedresmethodol.biomedcentral.com/articles/10.1186/s12874-023-01849-0>

## Why the v1.1 split

CHARMS distinguishes **study-level** information (one record per article)
from **per-model** information (one record per evaluated prediction model).
Migration `0015_charms_studylevel_split` reparents study-level entities to
the root of the template; per-model entities stay nested under
`prediction_models`.

## Hierarchy

```text
CHARMS v1.1 (root)
│
├── Source of Data            (one)   [study-level]
│   └── data_source (1.1)
│
├── Participants              (one)   [study-level]
│   ├── recruitment_method (2.1)
│   ├── recruitment_dates (2.2)
│   ├── study_setting (2.3)
│   ├── study_sites_regions (2.4)
│   ├── study_sites_number (2.5)
│   ├── inclusion_criteria (2.6)
│   ├── exclusion_criteria (2.7)
│   ├── age_of_participants (2.8.1)
│   ├── native_valve_endocarditis (2.8.2)
│   ├── valve_affected (2.8.3)
│   ├── characteristic_4 (2.8.4)
│   └── characteristic_5 (2.8.5)
│
├── Outcome                   (one)   [study-level]
│   └── …
│
├── Candidate Predictors      (one)   [study-level]
│   └── …
│
├── Sample Size               (one)   [study-level]
│   └── …
│
├── Missing Data              (one)   [study-level]
│   └── …
│
├── Observations              (one)   [study-level]
│   └── …
│
└── 🎯 Prediction Models      (many)  [model-container]   ⭐ ASSESSMENT TARGET
    ├── model_name (0.5)
    ├── modelling_method (7.1)
    │
    ├── Model Development     (one)   [per model]
    ├── Final Predictors      (one)   [per model]
    ├── Performance           (one)   [per model]
    ├── Validation            (one)   [per model]
    ├── Results               (one)   [per model]
    └── Interpretation        (one)   [per model]
```

## Field-by-field reference

See [`charms-v1.1-complete.md`](./charms-v1.1-complete.md) for the full
field inventory with types, allowed values, and CHARMS-numbered IDs.

## Related

- [Extraction + HITL architecture §4.1](../extraction-hitl-architecture.md)
- Migration `0015_charms_studylevel_split` (under `backend/alembic/versions/`)
