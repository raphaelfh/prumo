---
status: approved
last_reviewed: 2026-08-27
owner: '@raphaelfh'
---

# Template import flow — design

> **Status:** Approved · Date: 2026-08-27 · Deciders: @raphaelfh
> **Scope:** make importing an extraction template discoverable and
> understandable — a generic entry point, a dialog organised by intent, and
> the JSON-format guidance that does not exist today.
> **Slice:** A of four (B shipped; see
> [`2026-08-26-button-density-scale-design.md`](./2026-08-26-button-density-scale-design.md)).
> **Depends on:** slice B's scale (`sm`, `xs`, `icon`, `icon-xs`).

## Problem

Four defects, reported from the running app.

**1. The entry point is wrong.** The only way into the import dialog is the
per-row **Import** button on a catalogue template. You must pick an arbitrary
template to reach a dialog that does much more than import that template.
There is no generic "import" affordance.

**2. The dialog contradicts the button that opened it.** It is titled
*"Switch template"*. You pressed *Import*.

**3. Two competing submit buttons.** The dialog stacks three unrelated
sections in one scroll — *This project's templates* (switch/delete), *Add from
the catalogue* (radio cards), *Add from a file* — and the file pane has its own
**Import file** button while the footer's **Import Template** applies only to
the catalogue radio. Both are visible simultaneously, and neither says which
one it belongs to.

**4. No JSON guidance whatsoever.** `prumo-template@1` is defined only in
`backend/app/schemas/template_portable.py`. The UI offers one line — *"A
.prumo-template.json file exported from prumo."* No schema, no example, no
field-type list. Users are expected to author these with AI assistants, and
have nothing to hand the assistant. An export button exists but lives in the
template editor, so it is unreachable before you have a template.

## Decisions

### 1. A generic entry card replaces the catalogue table

On the Configuration page with no active template, the *Import template*
section — heading plus the entire catalogue table — becomes a card sibling to
*Create Custom Template*:

```
⊕  Create Custom Template          [ Create Template ]
⬇  Import a template               [ Import template ]
   Start from a ready-made framework, or import a
   JSON file you or an AI assistant prepared.
ⓘ  Managers can configure templates
```

The page becomes two clear choices, and **the catalogue lives in exactly one
place** instead of two.

This removes the per-row Import buttons, which are `initialTemplateId`'s only
caller (verified: `ExtractionInterface.tsx:595` is the sole consumer). So the
prop goes, and with it the render-phase `prevSyncKey` sync block in
`ImportTemplateDialog` — an awkward piece of state that existed only to serve
those buttons. `globalTemplates` also leaves `ExtractionInterface`.

### 2. The dialog becomes three tabs

Retitled **"Add a template"**.

| Tab | Content | Primary action |
|---|---|---|
| **Catalogue** (default) | existing radio cards | *Import selected template* |
| **JSON file** | guidance + file picker | *Import file* |
| **This project** | existing switch/delete list | — (rows carry their own) |

**Each tab owns its primary button at the foot of its own pane; the dialog
footer holds only *Close*.** Since one tab renders at a time, the
two-competing-submits problem dissolves by construction — and no state has to
be lifted out of `ImportTemplateFilePane`, which currently owns its own
`file` / `importing` / `errorLines`.

### 3. The JSON tab carries real guidance

Three affordances above the file picker:

- **`Copy AI prompt`** — copies a ready prompt (format rules + the example +
  "output only JSON") for pasting into an assistant. This is the one that
  serves the stated use case.
- **`Download example`** — serves `exampleTemplate.json` through the existing
  `triggerDownload` helper.
- **`How to build this file`** — collapsible (`Accordion`, already in the
  codebase), default closed.

Content lives in one new module, `frontend/lib/templateImport/`
(`exampleTemplate.json` + `aiPrompt.ts`).

The inline docs must state the **real** constraints, read from
`template_portable.py`, not paraphrased:

- Field types: `text`, `number`, `date`, `select`, `multiselect`, `boolean`.
  (There is no `textarea` — an early draft of this spec guessed one and the
  schema rejected it.)
- `group: true` ⇒ a repeating container; only a **root** section may be a
  group, and at most **one** group per template.
- Nested `sections` are legal only inside a group; `entry_label` only on a
  group.
- Limits: 100 sections per level, 200 fields per section, 2000 fields total.
- `type` and `required` are the file spellings; `field_type` / `is_required`
  are rejected.

### 4. The example file

Committed at `frontend/lib/templateImport/exampleTemplate.json`. **Validated
against the real `PortableTemplate`** — 2 root sections: one study-level
section (text / number / select-with-`allow_other`) and one repeating group
containing a child section, which is the minimum that teaches both structural
concepts:

```json
{
  "prumo_template": 1,
  "kind": "extraction",
  "name": "Minimal example",
  "framework": "CUSTOM",
  "version": "1.0.0",
  "sections": [
    {
      "name": "study_details", "label": "Study details", "required": true,
      "fields": [
        {"name": "author", "label": "First author", "type": "text", "required": true},
        {"name": "year", "label": "Publication year", "type": "number"},
        {"name": "design", "label": "Study design", "type": "select",
         "allowed_values": ["Cohort", "Case-control", "RCT"], "allow_other": true}
      ]
    },
    {
      "name": "prediction_models", "label": "Prediction models",
      "group": true, "entry_label": "model", "repeats": true,
      "sections": [
        {"name": "model_performance", "label": "Model performance",
         "fields": [
           {"name": "c_statistic", "label": "C-statistic", "type": "number"},
           {"name": "notes", "label": "Notes", "type": "text", "allows_not_applicable": true}
         ]}
      ]
    }
  ]
}
```

### 5. Drift guard

A hand-written example rots the next time `template_portable.py` tightens —
and it would rot *silently*, because nothing imports it. So: **a backend
pytest reads `frontend/lib/templateImport/exampleTemplate.json` and validates
it against `PortableTemplate`.** If the schema tightens and the example stops
importing, CI goes red instead of a user discovering it.

Precedent for repo-root-relative backend tests exists
(`tests/unit/test_celery_routes_drift.py`,
`tests/unit/scripts/test_check_api_response_envelope.py`).

The same test also asserts the AI prompt embeds the example verbatim, so the
two cannot drift apart.

## Out of scope

- A docs page and a published machine-readable JSON Schema endpoint. Clean
  follow-up if assistants later need to *fetch* the schema rather than receive
  it in a pasted prompt.
- Any change to the import/export wire format or the backend endpoints. This
  slice is entry point, layout and guidance only.

## Verification

| Claim | How it is proven |
|---|---|
| The example is importable | Backend pytest validates it against `PortableTemplate` |
| Prompt and example agree | Same test asserts the prompt embeds the example |
| Tabs render and act | Vitest: tab switch, each pane's primary action, clipboard copy, download |
| File errors still surface | Existing `ImportTemplateFilePane` error tests keep passing |
| Nothing orphaned | `npm run deadcode` + `deadcode:production` at zero (the deleted `initialTemplateId` path must not leave dead exports) |
| It looks right | `design-review` loop on Configuration with and without an active template |

**E2E to repoint:** `frontend/e2e/flows/template-import.ui.e2e.ts:34` drives
`extraction-import-global-<id>` (the per-row button this slice deletes) and
`:48` uses `import-template-submit` (the footer button that moves into the
Catalogue tab). `template-portable.ui.e2e.ts:50` uses
`import-template-file-input`, which survives inside the JSON tab but must be
reached by activating that tab first.

## Sequencing

| | Slice | State |
|---|---|---|
| B | Button & density scale | PR1 in prod; PR2 open ([#723](https://github.com/raphaelfh/prumo/pull/723)) |
| **A** | **Template import flow** | **This spec** |
| C | Model picker (`LlmEngineChip`) | Not designed — one 22rem popover carries seven concerns |
| D | Sections/fields view (visual only) | Not designed — measured **six** button heights on one screen (14/16/18/22/23/28px) |

A must be built on B's vocabulary, so it starts once #723 merges.
