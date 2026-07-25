"""PROBAST+AI canonical quality-assessment template (Moons et al., BMJ 2025).

Kept in its own module because ``app.seed`` is at its file-size ratchet cap and
this definition is large. Shares every helper with ``app.seed`` so the field
shape (and the ADR-0016 identity check on the answer set) cannot drift.

Structure: a model-development part judged on Quality (16 signaling questions)
and a model-evaluation part judged on Risk of Bias (18), four domains each,
with evaluation domain 4 assessed separately per reported performance type
(apparent / internal / external). 34 instrument questions become 42 field rows
because the four type-agnostic evaluation-D4 questions are triplicated; the 14
domain judgments become 16 rows for the same reason.

Two structural notes:

* The two parts are SIBLING sections, not a tree. A grouping parent would have
  to be ``role='model_container'`` (0016 role CHECK) and at most one such node
  may exist per template (partial unique index).
* Per-type "not applicable by default" answers (data leakage and resampling in
  the apparent and external types) are expressed by OMITTING the field from
  those sections — ``extraction_fields`` has no default-value column.

The four overall judgments are NOT seeded as fields: they are computed from the
domain judgments by ``derived_judgment_service``, configured by the
``derived_judgments`` spec on this template's ``schema`` JSONB.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEntityRole,
    ExtractionField,
    ExtractionTemplateGlobal,
)
from app.models.extraction_versioning import TemplateKind
from app.seed import (
    _PROBAST_JUDGMENT,
    _PROBAST_SIGNALING,
    _entity_type_from_spec,
    _EntitySpec,
    _qa_field,
    _signaling,
)

# ---------------------------------------------------------------------------
# Fixed UUIDs — never change (prefix convention: 000c CHARMS, 00b0 PROBAST,
# 00d0 QUADAS-2, 00ba PROBAST+AI).
# ---------------------------------------------------------------------------

_PROBAST_AI_TEMPLATE_ID = UUID("00ba0000-0000-0000-0000-000000000001")
_ET_DEV_D1 = UUID("00ba0001-0000-0000-0000-000000000000")
_ET_DEV_D2 = UUID("00ba0002-0000-0000-0000-000000000000")
_ET_DEV_D3 = UUID("00ba0003-0000-0000-0000-000000000000")
_ET_DEV_D4 = UUID("00ba0004-0000-0000-0000-000000000000")
_ET_EVAL_D1 = UUID("00ba0005-0000-0000-0000-000000000000")
_ET_EVAL_D2 = UUID("00ba0006-0000-0000-0000-000000000000")
_ET_EVAL_D3 = UUID("00ba0007-0000-0000-0000-000000000000")
_ET_EVAL_D4_A = UUID("00ba0008-0000-0000-0000-000000000000")
_ET_EVAL_D4_I = UUID("00ba0009-0000-0000-0000-000000000000")
_ET_EVAL_D4_E = UUID("00ba000a-0000-0000-0000-000000000000")

# Section machine names — referenced by the derivation spec below, so they are
# declared once and reused on both sides.
_S_DEV_D1 = "dev_d1_participants"
_S_DEV_D2 = "dev_d2_predictors"
_S_DEV_D3 = "dev_d3_outcome"
_S_DEV_D4 = "dev_d4_analysis"
_S_EVAL_D1 = "eval_d1_participants"
_S_EVAL_D2 = "eval_d2_predictors"
_S_EVAL_D3 = "eval_d3_outcome"
_S_EVAL_D4_A = "eval_d4_analysis_apparent"
_S_EVAL_D4_I = "eval_d4_analysis_internal"
_S_EVAL_D4_E = "eval_d4_analysis_external"

_F_QUALITY = "quality_concern"
_F_ROB = "risk_of_bias"
_F_APPLICABILITY = "applicability_concerns"

_ANSWER_INSTRUCTION = (
    " Answer Y, PY, PN or N; mark no information when the article is silent, "
    "and not applicable when the criterion does not apply."
)

# (machine name, verbatim official text, criterion for the AI prompt)
_Question = tuple[str, str, str]

# --- Question sets shared by both parts -------------------------------------

_D1_QUESTIONS: tuple[_Question, ...] = (
    (
        "q1_appropriate_data_sources",
        "Were appropriate data sources used?",
        "Assess whether the data source is appropriate and its provenance is "
        "traceable — enough detail on how the data were collected and measured. "
        "Open-repository sources with insufficient collection detail are a "
        "concern and can hide fairness problems.",
    ),
    (
        "q2_appropriate_study_design",
        "Was an appropriate study design used?",
        "Assess whether the study design suits the task: a prospective "
        "longitudinal cohort is preferred for prognosis; selective sampling "
        "(case-cohort, nested case-control) must be adjusted for the sampling "
        "fraction; registry and routine-care data carry more quality problems.",
    ),
    (
        "q3_representative_dataset",
        "Did the inclusions and exclusions of study participants result in a "
        "representative dataset?",
        "Assess whether inclusions and exclusions align with the intended use "
        "and leave a dataset representative of the target population, with no "
        "marginalised subgroup improperly excluded.",
    ),
)

_D2_QUESTIONS: tuple[_Question, ...] = (
    (
        "q1_similar_definition_assessment",
        "Were predictors defined and assessed in a similar way for all participants?",
        "Assess whether definitions, thresholds and measurement methods were the "
        "same across participants. Risk is higher for subjective predictors "
        "(imaging, electrophysiology, pathology).",
    ),
    (
        "q2_similar_preprocessing",
        "Was any preprocessing of predictors similar for all participants?",
        "Assess whether preprocessing — value standardisation, feature "
        "extraction from unstructured data such as images or signals — was the "
        "same across participants, centres and subgroups.",
    ),
    (
        "q3_blind_to_outcome",
        "Were predictor assessments made without knowledge of outcome data?",
        "Assess whether predictors were measured blind to the outcome. This "
        "matters most for subjective predictors and is frequently unreported; "
        "when unreported, mark no information.",
    ),
    (
        "q4_available_at_intended_use",
        "Were the predictors included in the model available at the time the "
        "model was intended to be used?",
        "Assess whether every predictor in the final model is obtainable at the "
        "moment of intended use (for example, a preoperative model must not use "
        "an intraoperative or postoperative predictor).",
    ),
)

_D3_QUESTIONS: tuple[_Question, ...] = (
    (
        "q1_appropriate_definition",
        "Were outcomes defined and assessed appropriately?",
        "Assess whether the outcome definition is standard and prespecified and "
        "the measurement method accurate. Error is larger with non-standard "
        "definitions, subjective or composite outcomes, and data-driven "
        "thresholds.",
    ),
    (
        "q2_similar_definition_assessment",
        "Were outcomes defined and assessed in a similar way for all participants?",
        "Assess whether the same definition, threshold and method (including "
        "number of visits) applied to all participants; watch for partial or "
        "differential verification in diagnostic studies.",
    ),
    (
        "q3_blind_to_predictors",
        "Were outcome assessments made without use or knowledge of predictor data?",
        "Assess whether the outcome was determined blind to the predictors. If a "
        "predictor forms part of the outcome definition, the association is "
        "spurious and performance is inflated.",
    ),
    (
        "q4_appropriate_time_interval",
        "Was the time interval between predictor assessment and outcome assessment appropriate?",
        "Assess whether the predictor-to-outcome interval is neither too short "
        "nor too long: ideally simultaneous for diagnosis, and consistent with "
        "the stated horizon for prognosis.",
    ),
)

# --- Development domain 4 ---------------------------------------------------

_DEV_D4_QUESTIONS: tuple[_Question, ...] = (
    (
        "q1_reasonable_sample_size",
        "Was there evidence that the sample size was reasonable?",
        "Assess whether the development sample is large relative to model "
        "complexity, considering the number of parameters and the event "
        "fraction. Regularisation does not substitute for an adequate sample; "
        "when no information is given, lean to no information.",
    ),
    (
        "q2_continuous_categorical_handling",
        "Were continuous and categorical predictors handled appropriately?",
        "Assess whether categorisation or dichotomisation discarded information "
        "or used data-driven thresholds; regression should ideally model "
        "non-linearity (splines, fractional polynomials).",
    ),
    (
        "q3_missing_censored_handling",
        "Were participants with missing or censored data handled appropriately in the analysis?",
        "Assess whether selective exclusion was avoided, whether multiple "
        "imputation (generally preferred) was used, and whether censoring was "
        "handled — competing risks where relevant. Silence often means an "
        "implicit complete-case analysis.",
    ),
    (
        "q4_imbalance_recalibration",
        "If methods to address class imbalance were used, was the model or the "
        "model predictions recalibrated?",
        "Conditional criterion: if class-imbalance corrections (under- or "
        "oversampling, SMOTE) were used in development, assess whether the model "
        "or its predictions were recalibrated — those corrections distort "
        "estimated probabilities. If no imbalance method was used, mark not "
        "applicable.",
    ),
    (
        "q5_overfitting_methods",
        "Were methods used to address potential model overfitting?",
        "Assess whether overfitting was addressed: sufficient data, avoiding "
        "data-driven univariable selection (the winner's curse), regularisation "
        "or shrinkage, and careful hyperparameter tuning for AI models.",
    ),
)

# --- Evaluation domain 4, split by performance type -------------------------

_EVAL_D4_GATE: tuple[_Question, ...] = (
    (
        "q1_apparent_only_avoided",
        "Was model evaluation based on only apparent performance avoided?",
        "Domain gate, answered ONCE for the whole evaluation domain and stored "
        "in the apparent-performance section. Apparent performance is estimated "
        "on the same data used for development and is optimistic; the study is "
        "expected to go beyond it, with internal validation (resampling or "
        "cross-validation on the development set) and/or external validation "
        "(participants not used for development). Answer N when only apparent "
        "performance was reported, in which case the internal and external "
        "sections are left blank.",
    ),
)

# Asked for every reported performance type.
_EVAL_D4_CORE: tuple[_Question, ...] = (
    (
        "q2_reasonable_sample_size",
        "Was there evidence that the sample size was reasonable?",
        "For THIS performance type, assess whether the evaluation sample is "
        "large enough to estimate performance precisely; subgroups may have too "
        "few participants.",
    ),
    (
        "q3_missing_censored_handling",
        "Were participants with missing or censored data handled appropriately in the analysis?",
        "For THIS performance type, assess whether missing or censored data were "
        "handled appropriately and selective exclusion avoided. In external "
        "data, beware a systematically absent predictor — its coefficient must "
        "not simply be zeroed.",
    ),
    (
        "q4_uncorrected_imbalance_evaluation",
        "If methods to address class imbalance were used, was the evaluation "
        "done in a dataset without correction for imbalance?",
        "Conditional criterion: if imbalance corrections were used in "
        "development, the evaluation must run on data WITHOUT that correction, "
        "which distorts the true prevalence. If no correction was used, mark not "
        "applicable.",
    ),
)

# Internal validation only — NA by definition for apparent and external, so
# these fields are omitted from those sections entirely.
_EVAL_D4_INTERNAL_ONLY: tuple[_Question, ...] = (
    (
        "q5_data_leakage_avoided",
        "If data splitting was done to create training and test datasets, was "
        "there evidence that data leakage was avoided?",
        "Assess whether leakage was avoided: overlap between evaluation and "
        "training data, or re-tuning parameters on the evaluation data, "
        "overestimates performance.",
    ),
    (
        "q6_resampling_replicates_all_steps",
        "If resampling methods were used to evaluate model performance, were all "
        "model development steps replicated in the resampling process?",
        "Assess whether EVERY development step — imputation, variable selection, "
        "hyperparameter tuning, fitting — was replicated inside each resampling "
        "iteration; otherwise optimism is underestimated.",
    ),
)

_EVAL_D4_PERFORMANCE: tuple[_Question, ...] = (
    (
        "q7_appropriate_performance_measures",
        "Was the predictive performance of the model evaluated appropriately, "
        "for example, calibration, discrimination, and net benefit?",
        "For THIS performance type, assess whether performance was evaluated "
        "appropriately: ideally calibration (a curve, not only a goodness-of-fit "
        "test), discrimination (for example the c-index) and clinical utility "
        "(net benefit). Omitting calibration or discrimination signals a problem; "
        "calibration reported only as apparent is weakly informative.",
    ),
)

# (machine name, short UI label, verbatim official judgment text)
_Judgment = tuple[str, str, str]

_APPLICABILITY_D1: _Judgment = (
    _F_APPLICABILITY,
    "Applicability concerns",
    "Concern that the data of the included participants do not match the review "
    "question or the intended use of the prediction model",
)
_APPLICABILITY_D2: _Judgment = (
    _F_APPLICABILITY,
    "Applicability concerns",
    "Concern that the definition, preprocessing, assessment, or timing of "
    "assessment of the predictors in the model do not match the review question "
    "or the intended use",
)
_APPLICABILITY_D3: _Judgment = (
    _F_APPLICABILITY,
    "Applicability concerns",
    "Concern that the outcome, its definition, assessment, or timing of "
    "assessment do not match the review question or the intended use",
)

_ROB_ANALYSIS: _Judgment = (
    _F_ROB,
    "Risk of bias",
    "Risk of bias introduced by the analysis",
)

# (entity id, machine name, label, description, questions, judgments)
_Section = tuple[UUID, str, str, str, tuple[_Question, ...], tuple[_Judgment, ...]]

_SECTIONS: tuple[_Section, ...] = (
    (
        _ET_DEV_D1,
        _S_DEV_D1,
        "Development D1: Participants and data sources",
        "PROBAST+AI model-development domain 1 — quality of participant "
        "selection and data sources.",
        _D1_QUESTIONS,
        (
            (
                _F_QUALITY,
                "Quality",
                "Concern regarding quality of selection of participants and data sources",
            ),
            _APPLICABILITY_D1,
        ),
    ),
    (
        _ET_DEV_D2,
        _S_DEV_D2,
        "Development D2: Predictors",
        "PROBAST+AI model-development domain 2 — quality of the predictors and their assessment.",
        _D2_QUESTIONS,
        (
            (
                _F_QUALITY,
                "Quality",
                "Concern regarding the quality of the predictors or their assessment",
            ),
            _APPLICABILITY_D2,
        ),
    ),
    (
        _ET_DEV_D3,
        _S_DEV_D3,
        "Development D3: Outcome",
        "PROBAST+AI model-development domain 3 — quality of the outcome and its determination.",
        _D3_QUESTIONS,
        (
            (
                _F_QUALITY,
                "Quality",
                "Concern regarding quality of the outcome or its determination",
            ),
            _APPLICABILITY_D3,
        ),
    ),
    (
        _ET_DEV_D4,
        _S_DEV_D4,
        "Development D4: Analysis",
        "PROBAST+AI model-development domain 4 — quality of the analysis. "
        "Applicability is not judged for domain 4.",
        _DEV_D4_QUESTIONS,
        ((_F_QUALITY, "Quality", "Concern regarding quality of the analysis"),),
    ),
    (
        _ET_EVAL_D1,
        _S_EVAL_D1,
        "Evaluation D1: Participants and data sources",
        "PROBAST+AI model-evaluation domain 1 — risk of bias from participant "
        "selection and data sources.",
        _D1_QUESTIONS,
        (
            (
                _F_ROB,
                "Risk of bias",
                "Risk of bias introduced by the selection of participants and data sources",
            ),
            _APPLICABILITY_D1,
        ),
    ),
    (
        _ET_EVAL_D2,
        _S_EVAL_D2,
        "Evaluation D2: Predictors",
        "PROBAST+AI model-evaluation domain 2 — risk of bias from the predictors "
        "or their assessment.",
        _D2_QUESTIONS,
        (
            (
                _F_ROB,
                "Risk of bias",
                "Risk of bias introduced by the predictors or their assessment",
            ),
            _APPLICABILITY_D2,
        ),
    ),
    (
        _ET_EVAL_D3,
        _S_EVAL_D3,
        "Evaluation D3: Outcome",
        "PROBAST+AI model-evaluation domain 3 — risk of bias from the outcome or "
        "its determination.",
        _D3_QUESTIONS,
        (
            (
                _F_ROB,
                "Risk of bias",
                "Risk of bias introduced by the outcome or its determination",
            ),
            _APPLICABILITY_D3,
        ),
    ),
    (
        _ET_EVAL_D4_A,
        _S_EVAL_D4_A,
        "Evaluation D4: Analysis (apparent performance)",
        "PROBAST+AI model-evaluation domain 4, judged for APPARENT performance "
        "(estimated on the same data used for development). Leave blank when the "
        "study reports no apparent performance.",
        _EVAL_D4_GATE + _EVAL_D4_CORE + _EVAL_D4_PERFORMANCE,
        (_ROB_ANALYSIS,),
    ),
    (
        _ET_EVAL_D4_I,
        _S_EVAL_D4_I,
        "Evaluation D4: Analysis (internal validation)",
        "PROBAST+AI model-evaluation domain 4, judged for INTERNAL validation "
        "(resampling — cross-validation or bootstrap — within the development "
        "data). Leave blank when the study reports none.",
        _EVAL_D4_CORE + _EVAL_D4_INTERNAL_ONLY + _EVAL_D4_PERFORMANCE,
        (_ROB_ANALYSIS,),
    ),
    (
        _ET_EVAL_D4_E,
        _S_EVAL_D4_E,
        "Evaluation D4: Analysis (external validation)",
        "PROBAST+AI model-evaluation domain 4, judged for EXTERNAL validation "
        "(participants not used for development). Leave blank when the study "
        "reports none.",
        _EVAL_D4_CORE + _EVAL_D4_PERFORMANCE,
        (_ROB_ANALYSIS,),
    ),
)


def _judgment_field(eid: UUID, judgment: _Judgment, sort: int) -> ExtractionField:
    """One PROBAST+AI domain judgment (Low / High / Unclear).

    Unlike ``_domain_judgment`` (PROBAST / QUADAS-2), the judgment NAME varies by
    part: the development part judges "Quality", the evaluation part judges
    "Risk of bias". The QA form detects a judgment by its Low/High/Unclear answer
    set rather than by name, so honest names cost nothing.
    """
    name, label, official_text = judgment
    return _qa_field(
        eid,
        name,
        label,
        official_text,
        "select",
        sort,
        allowed=_PROBAST_JUDGMENT,
        llm=(
            f"Domain judgment (not a signaling question): {official_text}. "
            "Aggregate the answers and evidence of this domain's signaling "
            "questions — N/PN signal a relevant concern; a no-information answer "
            "that prevents judging leads to Unclear; a legitimate not-applicable "
            "does not count against the domain; Low when nothing relevant is "
            "signalled. This is a judgment, not a count: a single serious flaw is "
            "enough for High. If the article reports more than one eligible "
            "model, judge the WORST case among them and name that model in your "
            "reasoning. Answer Low, High or Unclear."
        ),
    )


# ---------------------------------------------------------------------------
# Derivation spec — computed overalls (Moons 2025 step 4: worst domain).
#
# Seeded onto the template's `schema` JSONB and consumed by
# `derived_judgment_service`, the single implementation shared by the run-view
# payload and the xlsx export. `rule` is declared even though `worst_domain` is
# currently the only supported one, so a future second rule fails loudly rather
# than being silently treated as worst-domain.
# ---------------------------------------------------------------------------

_PAI_DERIVED_JUDGMENTS: list[dict[str, Any]] = [
    {
        "id": "dev_overall_quality",
        "label": "Overall quality (development)",
        "rule": "worst_domain",
        "inputs": [
            {"section": _S_DEV_D1, "field": _F_QUALITY},
            {"section": _S_DEV_D2, "field": _F_QUALITY},
            {"section": _S_DEV_D3, "field": _F_QUALITY},
            {"section": _S_DEV_D4, "field": _F_QUALITY},
        ],
    },
    {
        "id": "dev_overall_applicability",
        "label": "Overall applicability (development)",
        "rule": "worst_domain",
        "inputs": [
            {"section": _S_DEV_D1, "field": _F_APPLICABILITY},
            {"section": _S_DEV_D2, "field": _F_APPLICABILITY},
            {"section": _S_DEV_D3, "field": _F_APPLICABILITY},
        ],
    },
    {
        "id": "eval_overall_rob",
        "label": "Overall risk of bias (evaluation)",
        "rule": "worst_domain",
        "inputs": [
            {"section": _S_EVAL_D1, "field": _F_ROB},
            {"section": _S_EVAL_D2, "field": _F_ROB},
            {"section": _S_EVAL_D3, "field": _F_ROB},
            {
                # Domain 4 collapses across the reported performance types
                # before entering the overall: unreported types are ignored.
                "collapse": "worst_of",
                "inputs": [
                    {"section": _S_EVAL_D4_A, "field": _F_ROB},
                    {"section": _S_EVAL_D4_I, "field": _F_ROB},
                    {"section": _S_EVAL_D4_E, "field": _F_ROB},
                ],
            },
        ],
    },
    {
        "id": "eval_overall_applicability",
        "label": "Overall applicability (evaluation)",
        "rule": "worst_domain",
        "inputs": [
            {"section": _S_EVAL_D1, "field": _F_APPLICABILITY},
            {"section": _S_EVAL_D2, "field": _F_APPLICABILITY},
            {"section": _S_EVAL_D3, "field": _F_APPLICABILITY},
        ],
    },
]


async def seed_probast_ai(session: AsyncSession) -> None:
    """Seeds the PROBAST+AI quality-assessment template (10 sections, 58 fields).

    Idempotent by primary key. NOTE: an existing row is left untouched, so a
    corrected ``derived_judgments`` spec requires ``make db-fresh`` (or a manual
    UPDATE) — ``make db-seed`` alone will not install it.
    """
    print("Seeding PROBAST+AI template...")

    template = await session.get(ExtractionTemplateGlobal, _PROBAST_AI_TEMPLATE_ID)
    if template:
        print("  PROBAST+AI already exists — skipping.")
        return

    session.add(
        ExtractionTemplateGlobal(
            id=_PROBAST_AI_TEMPLATE_ID,
            name="PROBAST+AI",
            description=(
                "PROBAST+AI — Prediction model Risk Of Bias ASsessment Tool for "
                "regression- and AI/ML-based prediction models (Moons et al., "
                "BMJ 2025). Model development is judged on Quality; model "
                "evaluation is judged on Risk of Bias. Applicability is judged "
                "on domains 1-3 of each part. Overall judgments are computed "
                "from the domain judgments (worst domain), never entered."
            ),
            framework="CUSTOM",
            version="1.0.0",
            kind=TemplateKind.QUALITY_ASSESSMENT.value,
            schema_={"derived_judgments": _PAI_DERIVED_JUDGMENTS},
        )
    )

    fields: list[ExtractionField] = []
    for order, (eid, name, label, description, questions, judgments) in enumerate(
        _SECTIONS, start=1
    ):
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
        for sort, (q_name, q_text, criterion) in enumerate(questions):
            fields.append(
                _signaling(
                    eid,
                    q_name,
                    q_text,
                    sort,
                    _PROBAST_SIGNALING,
                    llm=criterion + _ANSWER_INSTRUCTION,
                )
            )
        for offset, judgment in enumerate(judgments):
            fields.append(_judgment_field(eid, judgment, len(questions) + offset))

    for field in fields:
        session.add(field)

    print(f"  Created PROBAST+AI with {len(_SECTIONS)} entity types and {len(fields)} fields.")
