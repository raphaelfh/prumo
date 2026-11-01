/**
 * Reset for the screening flow's dedicated project, so the flow reruns on a
 * persisted database. Deleting the project's articles cascades their
 * screening assignments, decisions and rulings (the service role writes as
 * the table owner; no grant on the screening tables is needed); clearing
 * `settings` drops the reviewer-count choices. The articles come back with an
 * abstract, unenrolled; the protocol lists exclusion reasons (full text needs
 * them) and Alpha carries a MAIN PDF while Gamma has none.
 */
import { ensureArticlePdfBytes, fixtureArticlePdfKey } from "./article-pdf";
import { SCREENING_ARTICLES, SCREENING_PROJECT_ID } from "./fixture-ids";
import { adminDelete, adminInsert, adminUpdate } from "./supabase-admin";

const ABSTRACTS: Record<(typeof SCREENING_ARTICLES)[number]["id"], string> = {
  "f00dc63a-6b47-42c3-8a93-af69eb28a1c6":
    "We trained a gradient-boosted model on ICU records to predict sepsis six hours before onset.",
  "f00dc63a-6b47-42c3-8a93-af69eb28a1c7":
    "A narrative review of nursing handover practices in surgical wards, without a predictive model.",
  "f00dc63a-6b47-42c3-8a93-af69eb28a1c8":
    "A prospective cohort evaluating an early-warning score for sepsis in emergency departments.",
};

const [ALPHA] = SCREENING_ARTICLES;

export async function resetScreeningProject(): Promise<void> {
  await adminDelete("articles", `project_id=eq.${SCREENING_PROJECT_ID}`);
  await adminUpdate("projects", `id=eq.${SCREENING_PROJECT_ID}`, {
    settings: {},
    eligibility_criteria: { inclusion: ["Adults"], exclusion: ["Wrong population", "Wrong outcome"] },
  });
  await adminInsert(
    "articles",
    SCREENING_ARTICLES.map(({ id, title }) => ({
      id,
      project_id: SCREENING_PROJECT_ID,
      title,
      abstract: ABSTRACTS[id],
    })),
  );
  await adminInsert("article_files", [
    {
      project_id: SCREENING_PROJECT_ID,
      article_id: ALPHA.id,
      file_type: "pdf",
      file_role: "MAIN",
      storage_key: fixtureArticlePdfKey(ALPHA.id),
      original_filename: "e2e-screening-alpha.pdf",
    },
  ]);
  await ensureArticlePdfBytes(ALPHA.id);
}
