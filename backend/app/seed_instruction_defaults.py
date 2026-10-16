"""Default general AI instructions for the seeded global templates.

The texts live here rather than in ``app.seed`` because that module sits at
its file-size cap. This module imports nothing from the seed modules, so
``app.seed`` imports it at module level without an import cycle.

The current defaults carry no ``[customize: ...]`` slot: the project's review
question already reaches every prompt from the project's settings, so a slot
asking the manager to retype it is noise. The retired defaults are kept
verbatim so the backfill can recognize an unedited old default and replace
it; any other text is a manager's customization and is never touched.
"""

_REVIEW_QUESTION_DEFINES_SCOPE = (
    "The review question set in the project's review question settings "
    "defines the target condition, population and outcome."
)
_JUDGE_AGAINST_REVIEW_QUESTION = (
    "Judge applicability against the review question set in the project's review question settings."
)

CHARMS_INSTRUCTION = (
    "This review extracts data from studies that develop or validate "
    "clinical prediction models, following the CHARMS checklist. "
    "Report values exactly as the article states them — do not convert "
    "units, pool cohorts, or infer unreported values. When a study "
    "reports several models or cohorts, extract each one separately "
    "rather than averaging. Prefer precise numbers from tables over "
    "rounded prose values, and quote the passage that supports each "
    f"value. {_REVIEW_QUESTION_DEFINES_SCOPE}"
)

CHARMS_MM_INSTRUCTION = (
    "This review extracts data from studies of multimodal "
    "machine-learning prediction models, following an extended CHARMS "
    "checklist. Keep each data modality (imaging, text, structured "
    "data, signals) distinct as the authors describe them, and record "
    "the fusion approach without collapsing modalities. Report "
    "performance exactly as stated, per model and per validation "
    "split, and quote the passage that supports each value. "
    f"{_REVIEW_QUESTION_DEFINES_SCOPE}"
)

PROBAST_INSTRUCTION = (
    "This appraisal judges the risk of bias of prediction-model "
    "studies using PROBAST. Judge strictly from what the article "
    "reports: absence of information is a reason for concern, never "
    "reassurance. Answer each signaling question conservatively and "
    f"quote the passage that grounds the judgment. {_JUDGE_AGAINST_REVIEW_QUESTION}"
)

QUADAS2_INSTRUCTION = (
    "This appraisal judges the risk of bias and applicability of "
    "diagnostic accuracy studies using QUADAS-2. Judge each domain "
    "strictly from the reported conduct of the study — do not assume "
    "unreported safeguards were in place. Quote the passage that "
    f"grounds each judgment. {_JUDGE_AGAINST_REVIEW_QUESTION}"
)

PROBAST_AI_INSTRUCTION = (
    "This appraisal judges the risk of bias of AI and "
    "machine-learning prediction-model studies using PROBAST+AI. "
    "Judge strictly from what the article reports, with particular "
    "attention to data leakage, train/test split hygiene, and "
    "evaluation practices specific to machine learning. Absence of "
    "information is a reason for concern, never reassurance. Quote "
    f"the passage that grounds each judgment. {_JUDGE_AGAINST_REVIEW_QUESTION}"
)

# --- Retired defaults, verbatim: an unedited copy is replaced by the backfill.

RETIRED_CHARMS_INSTRUCTION = (
    "This review extracts data from studies that develop or validate "
    "clinical prediction models, following the CHARMS checklist. "
    "Report values exactly as the article states them — do not convert "
    "units, pool cohorts, or infer unreported values. When a study "
    "reports several models or cohorts, extract each one separately "
    "rather than averaging. Prefer precise numbers from tables over "
    "rounded prose values, and quote the passage that supports each "
    "value. [customize: name the target condition, population, and "
    "outcome this review focuses on]"
)

RETIRED_CHARMS_MM_INSTRUCTION = (
    "This review extracts data from studies of multimodal "
    "machine-learning prediction models, following an extended CHARMS "
    "checklist. Keep each data modality (imaging, text, structured "
    "data, signals) distinct as the authors describe them, and record "
    "the fusion approach without collapsing modalities. Report "
    "performance exactly as stated, per model and per validation "
    "split, and quote the passage that supports each value. "
    "[customize: name the target condition, population, and outcome "
    "this review focuses on]"
)

RETIRED_PROBAST_INSTRUCTION = (
    "This appraisal judges the risk of bias of prediction-model "
    "studies using PROBAST. Judge strictly from what the article "
    "reports: absence of information is a reason for concern, never "
    "reassurance. Answer each signaling question conservatively and "
    "quote the passage that grounds the judgment. [customize: "
    "describe the review's intended setting and population so "
    "applicability judgments have a reference point]"
)

RETIRED_QUADAS2_INSTRUCTION = (
    "This appraisal judges the risk of bias and applicability of "
    "diagnostic accuracy studies using QUADAS-2. Judge each domain "
    "strictly from the reported conduct of the study — do not assume "
    "unreported safeguards were in place. Quote the passage that "
    "grounds each judgment. [customize: state the review question — "
    "index test, target condition, and intended-use setting — that "
    "applicability is judged against]"
)

RETIRED_PROBAST_AI_INSTRUCTION = (
    "This appraisal judges the risk of bias of AI and "
    "machine-learning prediction-model studies using PROBAST+AI. "
    "Judge strictly from what the article reports, with particular "
    "attention to data leakage, train/test split hygiene, and "
    "evaluation practices specific to machine learning. Absence of "
    "information is a reason for concern, never reassurance. Quote "
    "the passage that grounds each judgment. [customize: state the "
    "review's Step-1 PICOTS — Population, Index model(s), "
    "Comparator model(s), Outcome(s), Timing, Setting/intended use "
    "— which every applicability judgment is made against]"
)
