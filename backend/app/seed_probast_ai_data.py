"""PROBAST+AI 2.1.0 — the instrument’s question banks (data only).

Split from ``seed_probast_ai`` to keep both under the file-size ratchet: this
module is pure data — the official signaling-question texts (Moons et al.,
BMJ 2025, Suppl. Table 3) and the per-question AI criteria (E&E Light). The
builders, section table and derivation spec stay in ``seed_probast_ai``.
"""

from __future__ import annotations

from typing import Any

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
        "when unreported, answer NI.",
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

_DEV_D4_QUESTIONS: tuple[_Question, ...] = (
    (
        "q1_reasonable_sample_size",
        "Was there evidence that the sample size was reasonable?",
        "Assess whether the development sample is large relative to model "
        "complexity, considering the number of parameters and the event "
        "fraction. Regularisation does not substitute for an adequate sample; "
        "when the article gives no sample-size justification, answer NI.",
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
        "Conditional criterion: if the data were split into training and test "
        "sets, assess whether leakage was avoided — overlap between evaluation "
        "and training data, or re-tuning parameters on the evaluation data, "
        "overestimates performance. If no splitting was done, mark not "
        "applicable.",
    ),
    (
        "q6_resampling_replicates_all_steps",
        "If resampling methods were used to evaluate model performance, were all "
        "model development steps replicated in the resampling process?",
        "Conditional criterion: if resampling was used, assess whether EVERY "
        "development step — imputation, variable selection, hyperparameter "
        "tuning, fitting — was replicated inside each resampling iteration; "
        "otherwise optimism is underestimated. If no resampling was used, mark "
        "not applicable.",
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


# --- Official judgment texts and applicability aspects ----------------------

_APP_OFFICIAL_D1 = (
    "Concern that the data of the included participants do not match the "
    "review question or the assessor's intended use of the prediction model"
)
_APP_OFFICIAL_D2 = (
    "Concern that the definition, preprocessing, assessment, or timing of "
    "assessment of the predictors in the model do not match the review "
    "question or the assessor's intended use"
)
_APP_OFFICIAL_D3 = (
    "Concern that the outcome, its definition, assessment, or timing of "
    "assessment do not match the review question or the assessor's intended use"
)
_APP_ASPECT_D1 = "the data sources and the included participants"
_APP_ASPECT_D2 = (
    "the definition, preprocessing, assessment and timing of assessment of the predictors"
)
_APP_ASPECT_D3 = "the outcome, its definition, assessment and timing of assessment"

_RATIONALE_QUALITY = "Rationale of quality rating"
_RATIONALE_ROB = "Rationale of risk of bias rating"

_DESC_DATA_SOURCES = (
    "desc_data_sources",
    "Describe the sources of data and the inclusion and exclusion criteria "
    "used to select participants",
)
_DESC_SETTING_DATES = (
    "desc_setting_dates",
    "Describe the sources of data, the included participants, the setting, and the dates",
)
# The form words the two D2 boxes differently, and the difference is
# substantive: the evaluation box asks about the model AS EVALUATED, not the
# one that was developed. One shared constant used to flatten both.
_DESC_PREDICTORS_DEV = (
    "desc_predictors",
    "List and describe the predictors included in the final prediction model, "
    "how they were defined and assessed, and the timing of their assessment",
)
_DESC_PREDICTORS_EVAL = (
    "desc_predictors",
    "List and describe the predictors included in the evaluated model, including "
    "their definition and the timing of their assessment",
)
_DESC_OUTCOME = (
    "desc_outcome",
    "Describe the outcome, how it was defined and determined, and the time "
    "interval between predictor assessment and outcome determination",
)
# The form's two D3-applicability boxes, deliberately merged into one field
# (item map, docs/reference/templates/probast-ai-instrument.md). The composite
# half asks for the per-component NUMBERS, not for the method used to get them.
_DESC_OUTCOME_TIMING = (
    "desc_outcome_timing",
    "Describe at what time point the outcome was determined and, if a composite "
    "outcome was used, the relative frequency or distribution of each "
    "contributing outcome",
)


# Domain-4 describe boxes. The prompt IS the AI extraction instruction
# (``_describe`` interpolates it into ``llm_description``) and PROBAST+AI makes
# these boxes the evidence the domain's signaling questions are answered on, so
# each one carries every fact the form names — the predictor counts item 4.1 /
# 4.2 turn on, the optimism adjustment, and the extent of missing data, not only
# how it was handled. ``hyperparameter tuning`` is an addition the instrument
# supports (Box 1 glossary; E&E "all model development steps including …
# hyperparameter tuning"), kept ALONGSIDE the form's own
# "classification or risk group definition" rather than in place of it.
_DEV_D4_DESCRIBES: tuple[tuple[str, str], ...] = (
    (
        "desc_sample_numbers",
        "Describe the number of participants, the number of candidate predictors, "
        "and the number of outcome events available for the model development",
    ),
    (
        "desc_model_development",
        "Describe how the prediction model was developed, including the modelling "
        "technique, predictor selection, hyperparameter tuning, and classification "
        "or risk group definition",
    ),
    (
        "desc_performance_measures",
        "Describe the performance measures of the prediction model as reported for "
        "the development data, for example (re)calibration, discrimination, "
        "(re)classification and net benefit, and whether they were adjusted for "
        "optimism",
    ),
    (
        "desc_missing_data",
        "Describe the missing data on predictors and outcomes in the model "
        "development, as well as the methods used for handling these missing data",
    ),
)
_EVAL_D4_DESCRIBES: tuple[tuple[str, str], ...] = (
    (
        "desc_sample_numbers",
        "Describe the number of participants, the number of predictors, the number "
        "of outcome events, and the events per predictor available for the model "
        "evaluation",
    ),
    (
        "desc_performance_measures",
        "Describe the performance measures of the evaluated model as reported for "
        "the evaluation, for example (re)calibration, discrimination, "
        "(re)classification and net benefit, and whether they were adjusted for "
        "optimism",
    ),
    (
        "desc_excluded_participants",
        "Describe any participants who were excluded from the evaluation analysis",
    ),
    (
        "desc_missing_data",
        "Describe the missing data on predictors and outcomes in the evaluation "
        "analysis, as well as the methods used for handling these missing data",
    ),
)


# Section machine names — referenced by the derivation spec below, so they are
# declared once and reused on both sides.
_S_SCOPE = "assessment_scope"
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
_S_EVAL_D4_J = "eval_d4_judgment"
_S_OVERALL = "overall_judgement"

_F_QUALITY = "quality_concern"
_F_ROB = "risk_of_bias"
_F_APPLICABILITY = "applicability_concerns"
_F_STUDY_TYPE = "study_type"

# The instrument's signaling answer set, v2-local. PROBAST+AI answers each
# signaling question Y / PY / PN / N / NI, and 2.1.0 carries all five on the
# ONE select rather than splitting NI onto the separate marker button (the
# button is turned off per field via ``allows_no_information``). NI keeps its
# short code as the stored value and spells itself out as the label, which is
# what lets the export's label path resolve it to the same Unclear the raw
# path derives — screen and workbook cannot drift.
#
# The shared four-answer ``_PROBAST_SIGNALING`` stays untouched: the classic
# PROBAST seed still uses it, and ``_signaling``'s identity rule keys off it.
_PAI_SIGNALING: list[Any] = [
    "Y",
    "PY",
    "PN",
    "N",
    {"value": "NI", "label": "No information"},
]

# Step-2 study-type classification, and what each choice takes out of scope.
# Declared data, sibling of ``derived_judgments``: every layer (progress,
# derivation, AI calls, export) evaluates the SAME rule where it acts, by set
# membership — which is what retires the ``dev_``/``eval_`` name-prefix
# convention the frontend used to hardcode.
#
# ``combination`` is deliberately absent: it excludes nothing, and so does an
# unanswered, marked or unrecognized classifier. Excluding nothing is the
# conservative default — an unclassified assessment shows the whole form.
_PAI_SCOPE_RULES: dict[str, Any] = {
    "classifier": {"section": _S_SCOPE, "field": "study_type"},
    "excludes": {
        "development_only": [
            _S_EVAL_D1,
            _S_EVAL_D2,
            _S_EVAL_D3,
            _S_EVAL_D4_A,
            _S_EVAL_D4_I,
            _S_EVAL_D4_E,
            _S_EVAL_D4_J,
        ],
        "evaluation_only": [_S_DEV_D1, _S_DEV_D2, _S_DEV_D3, _S_DEV_D4],
    },
}


# ---------------------------------------------------------------------------
# Derivation spec — 8 signaling_worst RECOMMENDATIONS (the derived default for
# each assessor-owned domain judgment, with its paired rationale) + 4
# worst_domain OVERALLS over the STORED judgments (with their Step-4 summary
# boxes). Consumed by ``derived_judgment_service``, the single implementation
# shared by the run-view payload and the xlsx export.
# ---------------------------------------------------------------------------


def _coords(section: str, *fields: str) -> list[dict[str, str]]:
    return [{"section": section, "field": field} for field in fields]


def _recommendation(
    entry_id: str,
    label: str,
    section: str,
    judgment: str,
    inputs: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "id": entry_id,
        "label": label,
        "rule": "signaling_worst",
        "target": {"section": section, "field": judgment},
        "rationale": {"section": section, "field": f"{judgment}_rationale"},
        "inputs": inputs,
    }


def _overall(
    entry_id: str, label: str, summary_field: str, inputs: list[dict[str, Any]]
) -> dict[str, Any]:
    return {
        "id": entry_id,
        "label": label,
        "rule": "worst_domain",
        "summary": {"section": _S_OVERALL, "field": summary_field},
        "inputs": inputs,
    }


_PAI_DERIVED_JUDGMENTS: list[dict[str, Any]] = [
    _recommendation(
        "dev_d1_quality",
        "Development D1: quality",
        _S_DEV_D1,
        _F_QUALITY,
        _coords(_S_DEV_D1, *(q[0] for q in _D1_QUESTIONS)),
    ),
    _recommendation(
        "dev_d2_quality",
        "Development D2: quality",
        _S_DEV_D2,
        _F_QUALITY,
        _coords(_S_DEV_D2, *(q[0] for q in _D2_QUESTIONS)),
    ),
    _recommendation(
        "dev_d3_quality",
        "Development D3: quality",
        _S_DEV_D3,
        _F_QUALITY,
        _coords(_S_DEV_D3, *(q[0] for q in _D3_QUESTIONS)),
    ),
    _recommendation(
        "dev_d4_quality",
        "Development D4: quality",
        _S_DEV_D4,
        _F_QUALITY,
        _coords(_S_DEV_D4, *(q[0] for q in _DEV_D4_QUESTIONS)),
    ),
    _recommendation(
        "eval_d1_rob",
        "Evaluation D1: risk of bias",
        _S_EVAL_D1,
        _F_ROB,
        _coords(_S_EVAL_D1, *(q[0] for q in _D1_QUESTIONS)),
    ),
    _recommendation(
        "eval_d2_rob",
        "Evaluation D2: risk of bias",
        _S_EVAL_D2,
        _F_ROB,
        _coords(_S_EVAL_D2, *(q[0] for q in _D2_QUESTIONS)),
    ),
    _recommendation(
        "eval_d3_rob",
        "Evaluation D3: risk of bias",
        _S_EVAL_D3,
        _F_ROB,
        _coords(_S_EVAL_D3, *(q[0] for q in _D3_QUESTIONS)),
    ),
    _recommendation(
        "eval_d4_rob",
        "Evaluation D4: Analysis",
        _S_EVAL_D4_J,
        _F_ROB,
        [
            # The gate is a PLAIN input: gate=N fires a High default
            # immediately (the assessor may still override with rationale).
            {"section": _S_EVAL_D4_A, "field": "q1_apparent_only_avoided"},
            {
                "collapse": "worst_of",
                "label": "Apparent performance",
                "inputs": _coords(
                    _S_EVAL_D4_A,
                    *(q[0] for q in _EVAL_D4_CORE + _EVAL_D4_PERFORMANCE),
                ),
            },
            {
                "collapse": "worst_of",
                "label": "Internal validation",
                "inputs": _coords(
                    _S_EVAL_D4_I,
                    *(q[0] for q in _EVAL_D4_CORE + _EVAL_D4_INTERNAL_ONLY + _EVAL_D4_PERFORMANCE),
                ),
            },
            {
                "collapse": "worst_of",
                "label": "External validation",
                "inputs": _coords(
                    _S_EVAL_D4_E,
                    *(q[0] for q in _EVAL_D4_CORE + _EVAL_D4_PERFORMANCE),
                ),
            },
        ],
    ),
    _overall(
        "dev_overall_quality",
        "Overall quality (development)",
        "summary_quality_development",
        _coords(_S_DEV_D1, _F_QUALITY)
        + _coords(_S_DEV_D2, _F_QUALITY)
        + _coords(_S_DEV_D3, _F_QUALITY)
        + _coords(_S_DEV_D4, _F_QUALITY),
    ),
    _overall(
        "dev_overall_applicability",
        "Overall applicability (development)",
        "summary_applicability_development",
        _coords(_S_DEV_D1, _F_APPLICABILITY)
        + _coords(_S_DEV_D2, _F_APPLICABILITY)
        + _coords(_S_DEV_D3, _F_APPLICABILITY),
    ),
    _overall(
        "eval_overall_rob",
        "Overall risk of bias (evaluation)",
        "summary_rob_evaluation",
        _coords(_S_EVAL_D1, _F_ROB)
        + _coords(_S_EVAL_D2, _F_ROB)
        + _coords(_S_EVAL_D3, _F_ROB)
        + _coords(_S_EVAL_D4_J, _F_ROB),
    ),
    _overall(
        "eval_overall_applicability",
        "Overall applicability (evaluation)",
        "summary_applicability_evaluation",
        _coords(_S_EVAL_D1, _F_APPLICABILITY)
        + _coords(_S_EVAL_D2, _F_APPLICABILITY)
        + _coords(_S_EVAL_D3, _F_APPLICABILITY),
    ),
]
