/**
 * Reset for the screening flow's dedicated project, so the flow reruns on a
 * persisted database. Deleting the project's articles cascades their
 * screening assignments, decisions and rulings (the service role writes as
 * the table owner; no grant on the screening tables is needed); clearing
 * `settings` drops the reviewers-per-record choice. The articles come back
 * with an abstract, unenrolled, created one second apart in array order (Alpha
 * oldest, so the suggested keeper of its duplicate pair).
 */
import { SCREENING_ARTICLES, SCREENING_PROJECT_ID } from "./fixture-ids";
import { adminDelete, adminInsert, adminUpdate } from "./supabase-admin";

const ABSTRACTS: Record<(typeof SCREENING_ARTICLES)[number]["id"], string> = {
  "f00dc63a-6b47-42c3-8a93-af69eb28a1c6":
    "We trained a gradient-boosted model on ICU records to predict sepsis six hours before onset.",
  "f00dc63a-6b47-42c3-8a93-af69eb28a1c7":
    "A narrative review of nursing handover practices in surgical wards, without a predictive model.",
  "f00dc63a-6b47-42c3-8a93-af69eb28a1c8":
    "We trained a gradient-boosted model on ICU records to predict sepsis six hours before onset.",
};

const BASE_TIME_MS = Date.UTC(2026, 0, 1);

export async function resetScreeningProject(): Promise<void> {
  await adminDelete("articles", `project_id=eq.${SCREENING_PROJECT_ID}`);
  await adminUpdate("projects", `id=eq.${SCREENING_PROJECT_ID}`, { settings: {} });
  await adminInsert(
    "articles",
    SCREENING_ARTICLES.map((article, index) => ({
      id: article.id,
      project_id: SCREENING_PROJECT_ID,
      title: article.title,
      abstract: ABSTRACTS[article.id],
      pmid: "pmid" in article ? article.pmid : null,
      created_at: new Date(BASE_TIME_MS + index * 1000).toISOString(),
    })),
  );
}
