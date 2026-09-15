import type {APIRequestContext} from '@playwright/test';
import {authHeaders, parseEnvelope} from './api';
import {loadE2EEnv} from './env';
import {adminDelete, adminInsert, adminSelect, resolveActiveExtractionTemplateId} from './supabase-admin';

export const REVIEW_VALUE = 'Recruitment took place between January 2018 and December 2022 across three regional hospitals. Eligibility was assessed prospectively with independent adjudication of every outcome.';
export const SECONDARY_VALUE = 'Participants with missing predictor values were excluded before model development; the exact count is not reported.';
export const REVIEW_QUOTES = ['Participants were recruited in three regional hospitals.', 'Outcomes were assessed by independent adjudicators.', 'The recruitment period ran from January 2018 through December 2022.'];
/** Stored with no page or anchor and absent from the document: the reader cannot locate it. */
export const UNAVAILABLE_QUOTE = 'Figure 2 lists withdrawals by site.';

/** Small real PDF: text streams and byte-accurate xref, no renderer mock. */
function documentPdf(): Uint8Array<ArrayBuffer> {
  const stream = `BT /F1 14 Tf 45 740 Td (${REVIEW_QUOTES[0]}) Tj 0 -30 Td (${REVIEW_QUOTES[1]}) Tj 0 -30 Td (${REVIEW_QUOTES[2]}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {const offset = Buffer.byteLength(pdf); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; return offset;});
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

/** Per coordinate, oldest first: two deliberate generations, each with its own sources and call facts. */
const GENERATIONS: Array<Array<{value: Record<string, unknown>; quotes: Array<number | null>}>> = [
  [{value: {value: REVIEW_VALUE}, quotes: [0, 1, 2]}, {value: {value: REVIEW_VALUE}, quotes: [0, 1, 2]}],
  [{value: {value: null, absent_reason: 'no_information'}, quotes: [1]}, {value: {value: SECONDARY_VALUE}, quotes: [0, null]}],
];

/**
 * An own article (never the shared fixture article) with a usable one-page PDF,
 * its text blocks, an extraction run and persisted per-call proposals/evidence
 * for two text questions — the state a completed deterministic extraction
 * leaves. No AI call and no shared run reset; cleanup deletes exactly this
 * article's graph and its storage object.
 */
export async function createReviewWorkspace(request: APIRequestContext, token: string) {
  const env = loadE2EEnv();
  if (!env.projectId || !env.supabaseUrl || !env.supabaseServiceRoleKey) throw new Error('Review workspace requires the local project and Supabase admin fixtures; run the configured global setup.');
  const articleId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const storageKey = `${env.projectId}/${articleId}/review-workspace.pdf`;
  const storageUrl = `${env.supabaseUrl}/storage/v1/object/articles/${storageKey}`;
  const storageHeaders = {apikey: env.supabaseServiceRoleKey, Authorization: `Bearer ${env.supabaseServiceRoleKey}`};
  const cleanup = async () => {
    await adminDelete('articles', `id=eq.${articleId}`);
    const response = await fetch(storageUrl, {method: 'DELETE', headers: storageHeaders});
    if (!response.ok && response.status !== 404) throw new Error(`Review PDF cleanup failed: ${response.status}`);
  };
  try {
    await adminInsert('articles', [{id: articleId, project_id: env.projectId, title: 'Review workspace: prospective recruitment and independently adjudicated outcomes'}]);
    const upload = await fetch(storageUrl, {method: 'POST', headers: {...storageHeaders, 'Content-Type': 'application/pdf'}, body: documentPdf()});
    if (!upload.ok) throw new Error(`Review PDF upload failed: ${upload.status} ${await upload.text()}`);
    await adminInsert('article_files', [{id: fileId, project_id: env.projectId, article_id: articleId, file_type: 'pdf', storage_key: storageKey, original_filename: 'review-workspace.pdf', extraction_status: 'completed'}]);
    await adminInsert('article_text_blocks', REVIEW_QUOTES.map((text, index) => ({article_file_id: fileId, page_number: 1, block_index: index, text, char_start: index * 100, char_end: index * 100 + text.length, bbox: {}, block_type: 'paragraph'})));
    const templateId = await resolveActiveExtractionTemplateId(env.projectId);
    const sessionResponse = await request.post(`${env.apiUrl}/api/v1/hitl/sessions`, {headers: authHeaders(token, articleId), data: {kind: 'extraction', project_id: env.projectId, article_id: articleId, project_template_id: templateId}});
    if (!sessionResponse.ok()) throw new Error(`Review run setup failed: ${sessionResponse.status()} ${await sessionResponse.text()}`);
    const {data: session} = await parseEnvelope<{run_id: string; instances_by_entity_type: Record<string, string>}>(sessionResponse);
    const fields = await adminSelect<{id: string; label: string; entity_type_id: string}>('extraction_fields', `select=id,label,entity_type_id&field_type=eq.text&entity_type_id=in.(${Object.keys(session.instances_by_entity_type).join(',')})&order=sort_order,id`);
    if (fields.length < 2) throw new Error('Review workspace requires at least two seeded text fields in instantiated sections. Import the CHARMS template.');
    const coordinates = fields.slice(0, 2).map(field => ({...field, instanceId: session.instances_by_entity_type[field.entity_type_id]}));
    const owners = await adminSelect<{created_by_id: string}>('projects', `id=eq.${env.projectId}&select=created_by_id`);
    const owner = owners[0]?.created_by_id;
    if (!owner) throw new Error('Review fixture project has no owner.');
    for (const [index, coordinate] of coordinates.entries()) {
      for (const [generation, {value, quotes}] of GENERATIONS[index].entries()) {
        const attemptId = crypto.randomUUID();
        const proposalId = crypto.randomUUID();
        await adminInsert('extraction_attempts', [{id: attemptId, request_id: crypto.randomUUID(), owner_id: owner, project_id: env.projectId, article_id: articleId, template_id: templateId, run_id: session.run_id, request_payload: {}, status: 'completed'}]);
        await adminInsert('extraction_proposal_records', [{id: proposalId, run_id: session.run_id, instance_id: coordinate.instanceId, field_id: coordinate.id, source: 'ai', proposed_value: value, rationale: `Generation ${generation + 1} independently reviews recruitment dates and adjudication from its cited passages.`, extraction_attempt_id: attemptId, generation_snapshot: {model: `fixture-model-${generation + 1}`, provider: 'deterministic-local-fixture', tokens: {prompt: 100 + generation, completion: 40, total: 140 + generation}, params: {temperature: 0}, prompt_text: `Extract recruitment facts for generation ${generation + 1}.`}, created_at: `2026-09-14T1${generation}:00:00Z`}]);
        await adminInsert('extraction_evidence', quotes.map((quote, rank) => {
          const text = quote === null ? null : REVIEW_QUOTES[quote];
          return {project_id: env.projectId, article_id: articleId, article_file_id: fileId, run_id: session.run_id, proposal_record_id: proposalId, rank, created_by: owner,
            page_number: text === null ? null : 1,
            position: text === null || quote === null ? null : {version: 1, anchor: {kind: 'text', range: {page: 1, charStart: quote * 100, charEnd: quote * 100 + text.length}, quote: text, blockIds: [quote]}},
            text_content: text ?? UNAVAILABLE_QUOTE,
            attribution_label: text === null ? 'ungroundable' : 'entailed'};
        }));
      }
    }
    return {articleId, templateId, runId: session.run_id, coordinates, cleanup, url: `${env.frontendUrl}/projects/${env.projectId}/extraction/${articleId}`};
  } catch (error) {
    await cleanup();
    throw error;
  }
}
