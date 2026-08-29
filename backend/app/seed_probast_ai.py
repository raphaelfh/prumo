"""PROBAST+AI 2.1.0 — instrument-exact quality-assessment template.

Moons et al., BMJ 2025 (Suppl. Table 3 fillable tool + E&E Light), mapped
item-by-item in ``docs/reference/templates/probast-ai-instrument.md``; design
in ``docs/superpowers/specs/2026-08-22-probast-ai-derived-domain-judgments-design.md``
and ``docs/superpowers/specs/2026-08-26-probast-ai-scope-coherence-design.md``.

Kept in its own module because ``app.seed`` is at its file-size ratchet cap and
this definition is large. Shares every helper with ``app.seed`` so the field
shape cannot drift.

Structure — 13 sections, 95 fields, mirroring the form's page order inside
each domain (describes → signaling questions → judgment → rationale →
applicability describe → applicability → rationale):

* ``assessment_scope`` — Step 2 study-type classification + the Step-3
  models/outcome of interest.
* 4 development domains judged on Quality, 3 evaluation domains judged on
  Risk of Bias, each with the official describe boxes and per-judgment
  rationale fields.
* Evaluation D4 splits its signaling questions across the three performance
  types (apparent / internal / external) but records ONE domain judgment, in
  ``eval_d4_judgment`` beside the D4 describe boxes — exactly as the form.
* ``overall_judgement`` — the four Step-4 summary boxes. The overall VALUES
  are computed (``worst_domain``), never entered.

Domain judgments get a derived DEFAULT (``signaling_worst`` recommendation
entries in the ``derived_judgments`` spec); the assessor records the final
value, with the UI requiring the paired rationale on divergence. Judgments,
their rationales and the Step-4 summaries are assessor-owned: they carry no
``llm_description`` and their spec pointers exclude them from every LLM call.

NA is restricted to the instrument's four conditional (asterisked) items —
six field rows after triplication. Step 1 (the review's PICOTS) lives in the
project template's ✨ instruction, which reaches every AI call as general
instructions and is the reference for the applicability judgments.

2.1.0 (spec 2026-08-26) makes the Step-2 classification load-bearing and puts
the instrument's own scale back on one control:

* ``scope_rules`` on ``schema_`` declares which sections each study type takes
  out of scope — read by progress, derivation, the AI calls and the export,
  which is what retires the ``dev_``/``eval_`` name-prefix convention.
* Signaling questions answer Y/PY/PN/N/**NI**; the separate "no information"
  marker is turned off per field (``allows_no_information``), so one concept
  has one control.
* Required = what the assessment OWES — the classifier, the 8 domain judgments
  and the 6 applicability judgments. Signaling questions and text boxes are
  optional: which part applies is unknown until Step 2, so "all 95 owed" was
  unknowable and pinned a development-only study at ~52% forever.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid5

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEntityRole,
    ExtractionEntityType,
    ExtractionField,
    ExtractionTemplateGlobal,
)
from app.models.extraction_versioning import TemplateKind
from app.seed import (
    _PROBAST_JUDGMENT,
    _entity_type_from_spec,
    _EntitySpec,
    _field,
    _signaling,
)
from app.seed_probast_ai_data import (
    _APP_ASPECT_D1,
    _APP_ASPECT_D2,
    _APP_ASPECT_D3,
    _APP_OFFICIAL_D1,
    _APP_OFFICIAL_D2,
    _APP_OFFICIAL_D3,
    _D1_QUESTIONS,
    _D2_QUESTIONS,
    _D3_QUESTIONS,
    _DESC_DATA_SOURCES,
    _DESC_OUTCOME,
    _DESC_OUTCOME_TIMING,
    _DESC_PREDICTORS,
    _DESC_SETTING_DATES,
    _DEV_D4_QUESTIONS,
    _EVAL_D4_CORE,
    _EVAL_D4_GATE,
    _EVAL_D4_INTERNAL_ONLY,
    _EVAL_D4_PERFORMANCE,
    _F_APPLICABILITY,
    _F_QUALITY,
    _F_ROB,
    _PAI_DERIVED_JUDGMENTS,
    _PAI_SCOPE_RULES,
    _PAI_SIGNALING,
    _RATIONALE_QUALITY,
    _RATIONALE_ROB,
    _S_DEV_D1,
    _S_DEV_D2,
    _S_DEV_D3,
    _S_DEV_D4,
    _S_EVAL_D1,
    _S_EVAL_D2,
    _S_EVAL_D3,
    _S_EVAL_D4_A,
    _S_EVAL_D4_E,
    _S_EVAL_D4_I,
    _S_EVAL_D4_J,
    _S_OVERALL,
    _S_SCOPE,
    _Question,
)
from app.services.advisory_locks import take_advisory_xact_lock

# ---------------------------------------------------------------------------
# Fixed UUIDs — never change (prefix convention: 000c CHARMS, 00b0 PROBAST,
# 00d0 QUADAS-2, 00ba PROBAST+AI). v2 reserves the FINAL group for the
# version: the v1 ids (…0001 template, …-000000000000 entity types) are
# unreachable for existing clones (clone dedupe is by (project,
# global_template)), so the new form ships under new primary keys.
# ---------------------------------------------------------------------------

_PROBAST_AI_TEMPLATE_ID = UUID("00ba0000-0000-0000-0000-000000000002")


def _et_id(n: int) -> UUID:
    return UUID(f"00ba{n:04x}-0000-0000-0000-000000000002")


# The instrument's answer scale. NI is the fifth ANSWER (2.1.0), so the prompt
# names it in the scale instead of steering the model to a separate marker.
# NA exists on exactly four conditional items (dev 4.4, eval 4.4, 4.5, 4.6 —
# six rows after triplication), so the instruction comes in two variants and
# the flag is passed per row.
_ANSWER_INSTRUCTION = " Answer Y, PY, PN, N or NI (no information)."
_ANSWER_INSTRUCTION_NA = (
    " Answer Y, PY, PN, N or NI (no information), and mark not applicable "
    "when the criterion does not apply."
)

_NA_QUESTIONS = frozenset(
    {
        "q4_imbalance_recalibration",
        "q4_uncorrected_imbalance_evaluation",
        "q5_data_leakage_avoided",
        "q6_resampling_replicates_all_steps",
    }
)

# --- Row builders -----------------------------------------------------------


def _describe(eid: UUID, name: str, prompt: str, sort: int) -> ExtractionField:
    """One official describe box: optional free text the AI pre-fills."""
    return _field(
        eid,
        name,
        prompt,
        prompt,
        "text",
        sort,
        is_required=False,
        llm=(
            "Descriptive extraction — summarise from the article, quoting the "
            f"supporting passages: {prompt}"
        ),
    )


def _sq(eid: UUID, question: _Question, sort: int) -> ExtractionField:
    """One signaling question on the instrument's five-answer scale.

    Optional since 2.1.0: which part of the instrument applies is unknown until
    the Step-2 classification, and an assessor may legitimately judge a domain
    without answering every question, so requiredness cannot state what the
    assessment owes — the domain judgment does. ``is_required`` is set here
    rather than through ``_signaling`` because ``app.seed`` sits at its
    file-size ratchet cap.
    """
    name, text, criterion = question
    conditional = name in _NA_QUESTIONS
    field = _signaling(
        eid,
        name,
        text,
        sort,
        _PAI_SIGNALING,
        allows_not_applicable=conditional,
        llm=criterion + (_ANSWER_INSTRUCTION_NA if conditional else _ANSWER_INSTRUCTION),
    )
    field.is_required = False
    return field


def _judgment(eid: UUID, name: str, label: str, official_text: str, sort: int) -> ExtractionField:
    """A domain judgment: assessor-owned, so NO llm_description — the derived
    default (``signaling_worst``) recommends, the assessor records."""
    return _field(
        eid,
        name,
        label,
        official_text,
        "select",
        sort,
        allowed=_PROBAST_JUDGMENT,
        llm=None,
    )


def _rationale(
    eid: UUID, name: str, label: str, sort: int, *, llm: str | None = None
) -> ExtractionField:
    return _field(eid, name, label, label, "text", sort, is_required=False, llm=llm)


def _applicability(eid: UUID, official_text: str, aspect: str, sort: int) -> ExtractionField:
    """Applicability: a direct Low/High/Unclear judgment against the Step-1
    PICOTS (the project template's ✨ instruction) — AI-proposable."""
    return _field(
        eid,
        _F_APPLICABILITY,
        "Applicability concerns",
        official_text,
        "select",
        sort,
        allowed=_PROBAST_JUDGMENT,
        llm=(
            "Applicability judgment (not aggregated from signaling questions): "
            f"judge whether {aspect} match the review question and the "
            "assessor's intended use of the prediction model, as stated in the "
            "review's general instructions (the Step-1 PICOTS). Answer Low or "
            "High, and Unclear when the article gives too little to judge."
        ),
    )


def _applicability_rationale(eid: UUID, aspect: str, sort: int) -> ExtractionField:
    return _rationale(
        eid,
        "applicability_concerns_rationale",
        "Rationale of applicability rating",
        sort,
        llm=(
            "Rationale for the applicability judgment: summarise, citing the "
            f"article, how {aspect} match or diverge from the review question "
            "in the general instructions."
        ),
    )


def _d123_fields(
    eid: UUID,
    *,
    lead_describes: tuple[tuple[str, str], ...],
    questions: tuple[_Question, ...],
    judgment_name: str,
    judgment_label: str,
    judgment_official: str,
    rationale_label: str,
    app_describe: tuple[str, str] | None,
    app_official: str,
    app_aspect: str,
) -> list[ExtractionField]:
    """One D1–D3 domain in the form's order: describes → SQs → judgment →
    rationale → (applicability describe →) applicability → rationale."""
    rows: list[ExtractionField] = []
    sort = 0
    for name, prompt in lead_describes:
        rows.append(_describe(eid, name, prompt, sort))
        sort += 1
    for question in questions:
        rows.append(_sq(eid, question, sort))
        sort += 1
    rows.append(_judgment(eid, judgment_name, judgment_label, judgment_official, sort))
    sort += 1
    rows.append(_rationale(eid, f"{judgment_name}_rationale", rationale_label, sort))
    sort += 1
    if app_describe is not None:
        rows.append(_describe(eid, app_describe[0], app_describe[1], sort))
        sort += 1
    rows.append(_applicability(eid, app_official, app_aspect, sort))
    sort += 1
    rows.append(_applicability_rationale(eid, app_aspect, sort))
    return rows


def _scope_fields(eid: UUID) -> list[ExtractionField]:
    return [
        _field(
            eid,
            "study_type",
            "Study type",
            "Step 2: classification of the study — model development only, "
            "model evaluation only, or a combination.",
            "select",
            0,
            # {value,label} option envelopes: the stored codes stay the
            # spec-pinned machine values; the UI renders the labels
            # (FieldValueEditor + optionLabelMap support this natively).
            allowed=[
                {"value": "development_only", "label": "Development only"},
                {"value": "evaluation_only", "label": "Evaluation only"},
                {"value": "combination", "label": "Combination"},
            ],
            llm=(
                "Step 2 classification: does the publication develop a "
                "prediction model without evaluation (development_only), "
                "evaluate one or more existing models (evaluation_only), or "
                "both (combination)? Base the answer on what the article "
                "actually reports."
            ),
        ),
        _field(
            eid,
            "models_of_interest",
            "Model(s) of interest",
            "Step 3: the prediction model(s) of interest this assessment covers.",
            "text",
            1,
            is_required=False,
            llm=(
                "Name the prediction model(s) of interest this assessment "
                "covers, as reported by the article (Step 3 header)."
            ),
        ),
        _field(
            eid,
            "outcome_of_interest",
            "Outcome of interest",
            "Step 3: the outcome of interest this assessment covers.",
            "text",
            2,
            is_required=False,
            llm=(
                "Name the outcome of interest this assessment covers, as "
                "reported by the article (Step 3 header)."
            ),
        ),
    ]


def _dev_d4_fields(eid: UUID) -> list[ExtractionField]:
    rows: list[ExtractionField] = []
    sort = 0
    for name, prompt in (
        (
            "desc_sample_numbers",
            "Describe the number of participants and the number of outcome "
            "events available for the model development",
        ),
        (
            "desc_model_development",
            "Describe how the model was developed, including the modelling "
            "technique, predictor selection, and hyperparameter tuning",
        ),
        (
            "desc_performance_measures",
            "Describe the performance measures of the model as reported for the development data",
        ),
        (
            "desc_missing_data",
            "Describe how missing data were handled in the model development",
        ),
    ):
        rows.append(_describe(eid, name, prompt, sort))
        sort += 1
    for question in _DEV_D4_QUESTIONS:
        rows.append(_sq(eid, question, sort))
        sort += 1
    rows.append(
        _judgment(
            eid,
            _F_QUALITY,
            "Quality",
            "Concern regarding quality of the analysis",
            sort,
        )
    )
    sort += 1
    rows.append(_rationale(eid, f"{_F_QUALITY}_rationale", _RATIONALE_QUALITY, sort))
    return rows


def _eval_d4_type_fields(eid: UUID, questions: tuple[_Question, ...]) -> list[ExtractionField]:
    return [_sq(eid, question, sort) for sort, question in enumerate(questions)]


def _eval_d4_judgment_fields(eid: UUID) -> list[ExtractionField]:
    rows: list[ExtractionField] = []
    sort = 0
    for name, prompt in (
        (
            "desc_sample_numbers",
            "Describe the number of participants and outcome events available "
            "for the model evaluation",
        ),
        (
            "desc_performance_measures",
            "Describe the performance measures of the model as reported for the evaluation",
        ),
        (
            "desc_excluded_participants",
            "Describe any participants who were excluded from the evaluation analysis",
        ),
        (
            "desc_missing_data",
            "Describe how missing data were handled in the evaluation analysis",
        ),
    ):
        rows.append(_describe(eid, name, prompt, sort))
        sort += 1
    rows.append(
        _judgment(
            eid,
            _F_ROB,
            "Risk of bias",
            "Risk of bias introduced by the analysis",
            sort,
        )
    )
    sort += 1
    rows.append(_rationale(eid, f"{_F_ROB}_rationale", _RATIONALE_ROB, sort))
    return rows


def _summary_fields(eid: UUID) -> list[ExtractionField]:
    rows: list[ExtractionField] = []
    for sort, (name, label) in enumerate(
        (
            ("summary_quality_development", "Summary of quality of the model development"),
            ("summary_rob_evaluation", "Summary of risk of bias of the model evaluation"),
            (
                "summary_applicability_development",
                "Summary of applicability of the model development",
            ),
            (
                "summary_applicability_evaluation",
                "Summary of applicability of the model evaluation",
            ),
        )
    ):
        rows.append(_rationale(eid, name, label, sort))
    return rows


# (entity id, machine name, label, description, field builder)
_SECTIONS: tuple[tuple[UUID, str, str, str, Any], ...] = (
    (
        _et_id(1),
        _S_SCOPE,
        "Assessment scope",
        "Steps 2–3 of the PROBAST+AI assessment: classify the study "
        "(development / evaluation / combination) and name the model(s) and "
        "outcome of interest. Informational — blank sections of the unused "
        "part simply stay blank.",
        _scope_fields,
    ),
    (
        _et_id(2),
        _S_DEV_D1,
        "Development D1: Participants and data sources",
        "PROBAST+AI model-development domain 1 — quality of participant "
        "selection and data sources.",
        lambda eid: _d123_fields(
            eid,
            lead_describes=(_DESC_DATA_SOURCES,),
            questions=_D1_QUESTIONS,
            judgment_name=_F_QUALITY,
            judgment_label="Quality",
            judgment_official=(
                "Concern regarding quality of selection of participants and data sources"
            ),
            rationale_label=_RATIONALE_QUALITY,
            app_describe=_DESC_SETTING_DATES,
            app_official=_APP_OFFICIAL_D1,
            app_aspect=_APP_ASPECT_D1,
        ),
    ),
    (
        _et_id(3),
        _S_DEV_D2,
        "Development D2: Predictors",
        "PROBAST+AI model-development domain 2 — quality of the predictors and their assessment.",
        lambda eid: _d123_fields(
            eid,
            lead_describes=(_DESC_PREDICTORS,),
            questions=_D2_QUESTIONS,
            judgment_name=_F_QUALITY,
            judgment_label="Quality",
            judgment_official=(
                "Concern regarding the quality of the predictors or their assessment"
            ),
            rationale_label=_RATIONALE_QUALITY,
            app_describe=None,
            app_official=_APP_OFFICIAL_D2,
            app_aspect=_APP_ASPECT_D2,
        ),
    ),
    (
        _et_id(4),
        _S_DEV_D3,
        "Development D3: Outcome",
        "PROBAST+AI model-development domain 3 — quality of the outcome and its determination.",
        lambda eid: _d123_fields(
            eid,
            lead_describes=(_DESC_OUTCOME,),
            questions=_D3_QUESTIONS,
            judgment_name=_F_QUALITY,
            judgment_label="Quality",
            judgment_official="Concern regarding quality of the outcome or its determination",
            rationale_label=_RATIONALE_QUALITY,
            app_describe=_DESC_OUTCOME_TIMING,
            app_official=_APP_OFFICIAL_D3,
            app_aspect=_APP_ASPECT_D3,
        ),
    ),
    (
        _et_id(5),
        _S_DEV_D4,
        "Development D4: Analysis",
        "PROBAST+AI model-development domain 4 — quality of the analysis. "
        "Applicability is not judged for domain 4.",
        _dev_d4_fields,
    ),
    (
        _et_id(6),
        _S_EVAL_D1,
        "Evaluation D1: Participants and data sources",
        "PROBAST+AI model-evaluation domain 1 — risk of bias from participant "
        "selection and data sources.",
        lambda eid: _d123_fields(
            eid,
            lead_describes=(_DESC_DATA_SOURCES,),
            questions=_D1_QUESTIONS,
            judgment_name=_F_ROB,
            judgment_label="Risk of bias",
            judgment_official=(
                "Risk of bias introduced by the selection of participants and data sources"
            ),
            rationale_label=_RATIONALE_ROB,
            app_describe=_DESC_SETTING_DATES,
            app_official=_APP_OFFICIAL_D1,
            app_aspect=_APP_ASPECT_D1,
        ),
    ),
    (
        _et_id(7),
        _S_EVAL_D2,
        "Evaluation D2: Predictors",
        "PROBAST+AI model-evaluation domain 2 — risk of bias from the "
        "predictors or their assessment.",
        lambda eid: _d123_fields(
            eid,
            lead_describes=(_DESC_PREDICTORS,),
            questions=_D2_QUESTIONS,
            judgment_name=_F_ROB,
            judgment_label="Risk of bias",
            judgment_official="Risk of bias introduced by the predictors or their assessment",
            rationale_label=_RATIONALE_ROB,
            app_describe=None,
            app_official=_APP_OFFICIAL_D2,
            app_aspect=_APP_ASPECT_D2,
        ),
    ),
    (
        _et_id(8),
        _S_EVAL_D3,
        "Evaluation D3: Outcome",
        "PROBAST+AI model-evaluation domain 3 — risk of bias from the outcome "
        "or its determination.",
        lambda eid: _d123_fields(
            eid,
            lead_describes=(_DESC_OUTCOME,),
            questions=_D3_QUESTIONS,
            judgment_name=_F_ROB,
            judgment_label="Risk of bias",
            judgment_official="Risk of bias introduced by the outcome or its determination",
            rationale_label=_RATIONALE_ROB,
            app_describe=_DESC_OUTCOME_TIMING,
            app_official=_APP_OFFICIAL_D3,
            app_aspect=_APP_ASPECT_D3,
        ),
    ),
    (
        _et_id(9),
        _S_EVAL_D4_A,
        "Evaluation D4: Analysis (apparent performance)",
        "PROBAST+AI model-evaluation domain 4, signaling questions for "
        "APPARENT performance (estimated on the same data used for "
        "development). Item 4.1 — whether the evaluation went beyond apparent "
        "performance — is answered here ONCE for the whole domain, whatever "
        "the study reports; only the remaining questions are left blank when "
        "no apparent performance is reported. The domain judgment is recorded "
        "once, in the Evaluation D4 judgment section.",
        lambda eid: _eval_d4_type_fields(eid, _EVAL_D4_GATE + _EVAL_D4_CORE + _EVAL_D4_PERFORMANCE),
    ),
    (
        _et_id(10),
        _S_EVAL_D4_I,
        "Evaluation D4: Analysis (internal validation)",
        "PROBAST+AI model-evaluation domain 4, signaling questions for "
        "INTERNAL validation (resampling — cross-validation or bootstrap — "
        "within the development data). Leave blank when the study reports "
        "none. The domain judgment is recorded once, in the Evaluation D4 "
        "judgment section.",
        lambda eid: _eval_d4_type_fields(
            eid, _EVAL_D4_CORE + _EVAL_D4_INTERNAL_ONLY + _EVAL_D4_PERFORMANCE
        ),
    ),
    (
        _et_id(11),
        _S_EVAL_D4_E,
        "Evaluation D4: Analysis (external validation)",
        "PROBAST+AI model-evaluation domain 4, signaling questions for "
        "EXTERNAL validation (participants not used for development). Leave "
        "blank when the study reports none. The domain judgment is recorded "
        "once, in the Evaluation D4 judgment section.",
        lambda eid: _eval_d4_type_fields(eid, _EVAL_D4_CORE + _EVAL_D4_PERFORMANCE),
    ),
    (
        _et_id(12),
        _S_EVAL_D4_J,
        "Evaluation D4: Analysis — judgment",
        "The single risk-of-bias judgment for evaluation domain 4, informed by "
        "the signaling questions of every reported performance type, beside "
        "the domain's describe boxes — one judgment per domain, exactly as "
        "the official form.",
        _eval_d4_judgment_fields,
    ),
    (
        _et_id(13),
        _S_OVERALL,
        "Overall judgement",
        "The four Step-4 summary boxes. The overall VALUES are computed from "
        "the recorded domain judgments (worst domain) and never entered; each "
        "pairs with an assessor summary box here.",
        _summary_fields,
    ),
)


_DESCRIPTION = (
    "PROBAST+AI — Prediction model Risk Of Bias ASsessment Tool "
    "for regression- and AI/ML-based prediction models (Moons et "
    "al., BMJ 2025), digitizing the official form's flow: describe "
    "the facts, answer the signaling questions, then record each "
    "domain judgment — a derived default is computed from the "
    "signaling answers, and diverging from it asks for the paired "
    "rationale. Model development is judged on Quality; model "
    "evaluation on Risk of Bias; applicability on domains 1-3 of "
    "each part. The four overall judgments are computed from the "
    "recorded domain judgments (worst domain), never entered, each "
    "beside its Step-4 summary box."
)


async def seed_probast_ai(session: AsyncSession) -> None:
    """Seeds the PROBAST+AI 2.1.0 quality-assessment template (13 sections,
    95 fields).

    Converges UNCONDITIONALLY. An existing row is UPDATEd in place and its
    entity types replaced (fields CASCADE) on every boot — no version compare.
    Gating the replace on a ``version`` bump would reintroduce the
    forgotten-bump silent no-op, which is the exact bug this replaces: every
    seeder used to early-return, so a corrected ``derived_judgments`` spec
    could never reach a database that already had the row, and ``version`` was
    decorative. It stays decorative — display metadata, never a gate.

    The template ROW is never deleted: dropping it would SET NULL every clone's
    ``global_template_id`` and break clone dedupe/heal. Only its children are
    replaced, and nothing outside their own fields references a GLOBAL entity
    type (clones copy by value; runs pin clone snapshots), so the replace is
    safe. If that invariant ever breaks, the RESTRICT FKs abort the boot loudly
    and the previous build stays live — the correct failure mode.

    Rows are keyed deterministically (entity types by ``_et_id``, fields by
    uuid5 of their entity type + name), so converging is genuinely idempotent
    rather than merely content-equal: identity is stable across deploys.

    Serialized on a transaction-scoped advisory lock: the boot runs this before
    gunicorn starts, and two containers starting at once would otherwise race
    the delete against each other's re-insert.
    """
    print("Seeding PROBAST+AI template...")

    await take_advisory_xact_lock(session, _PROBAST_AI_TEMPLATE_ID, _PROBAST_AI_TEMPLATE_ID)

    template = await session.get(ExtractionTemplateGlobal, _PROBAST_AI_TEMPLATE_ID)
    if template is None:
        template = ExtractionTemplateGlobal(id=_PROBAST_AI_TEMPLATE_ID)
        session.add(template)
    else:
        await session.execute(
            delete(ExtractionEntityType).where(
                ExtractionEntityType.template_id == _PROBAST_AI_TEMPLATE_ID
            )
        )

    # ``llm_template_instruction`` is deliberately NOT written here: it is the
    # manager-customized ✨ text, seeded fill-if-null by
    # ``backfill_llm_template_instructions``. Converging must not clobber it.
    template.name = "PROBAST+AI"
    template.description = _DESCRIPTION
    template.framework = "CUSTOM"
    template.version = "2.1.0"
    template.kind = TemplateKind.QUALITY_ASSESSMENT.value
    template.schema_ = {
        "derived_judgments": _PAI_DERIVED_JUDGMENTS,
        "scope_rules": _PAI_SCOPE_RULES,
    }

    n_fields = 0
    for order, (eid, name, label, description, build) in enumerate(_SECTIONS, start=1):
        session.add(
            _entity_type_from_spec(
                _EntitySpec(
                    eid,
                    name,
                    label,
                    description,
                    None,
                    "one",
                    ExtractionEntityRole.STUDY_SECTION,
                    order,
                ),
                template_id=_PROBAST_AI_TEMPLATE_ID,
            )
        )
        for field in build(eid):
            field.id = uuid5(eid, field.name)
            # NI is the fifth signaling ANSWER here, and the judgment scale
            # already encodes it (NI → Unclear), so the separate marker button
            # would duplicate the control on every row of this instrument.
            field.allows_no_information = False
            session.add(field)
            n_fields += 1

    print(f"  Created PROBAST+AI with {len(_SECTIONS)} entity types and {n_fields} fields.")
