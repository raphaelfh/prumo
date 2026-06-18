/**
 * E2E helper: drive a run to FINALIZED under the completeness gate (ADR-0009).
 *
 * The backend now blocks `consensus -> finalized` for extraction runs unless
 * every required field of every existing instance carries a resolved value.
 * Flows that previously published a single field and finalized must now fill
 * the rest. This helper publishes a placeholder `manual_override` consensus for
 * every required (instance, field) that is NOT already published — so a value
 * the test published deliberately (e.g. an AI-proposed one) is preserved — then
 * advances to FINALIZED.
 */

import type { APIRequestContext } from "@playwright/test";

import { authHeaders } from "./api";
import { adminSelect } from "./supabase-admin";

interface FinalizeOpts {
  apiUrl: string;
  token: string;
  traceId: string;
  runId: string;
  /** project_extraction_templates.id the run was created against. */
  templateId: string;
  /** articles.id the run targets (instances are keyed by article + template). */
  articleId: string;
}

/**
 * Publishes every unpublished required (instance, field) coordinate, then
 * advances the run to FINALIZED. Throws (with the response body) if any
 * consensus publish or the final advance is rejected, so the calling test
 * fails with an actionable message instead of a downstream stage assertion.
 */
export async function fillRequiredFieldsAndFinalize(
  request: APIRequestContext,
  { apiUrl, token, traceId, runId, templateId, articleId }: FinalizeOpts,
): Promise<void> {
  // Coords already published — don't overwrite a value the test set on purpose.
  const detailRes = await request.get(`${apiUrl}/api/v1/runs/${runId}`, {
    headers: authHeaders(token, traceId),
    timeout: 15000,
  });
  const detailBody = (await detailRes.json()) as {
    data?: { published_states?: Array<{ instance_id: string; field_id: string }> };
  };
  const published = new Set<string>(
    (detailBody.data?.published_states ?? []).map(
      (p) => `${p.instance_id}::${p.field_id}`,
    ),
  );

  const instances = await adminSelect<{ id: string; entity_type_id: string }>(
    "extraction_instances",
    `select=id,entity_type_id&template_id=eq.${templateId}&article_id=eq.${articleId}&limit=500`,
  );

  // Required field ids per entity type (cached — many instances share a type).
  const requiredByEntity = new Map<string, string[]>();

  for (const inst of instances) {
    let requiredFieldIds = requiredByEntity.get(inst.entity_type_id);
    if (!requiredFieldIds) {
      const fields = await adminSelect<{ id: string }>(
        "extraction_fields",
        `select=id&entity_type_id=eq.${inst.entity_type_id}&is_required=eq.true`,
      );
      requiredFieldIds = fields.map((f) => f.id);
      requiredByEntity.set(inst.entity_type_id, requiredFieldIds);
    }

    for (const fieldId of requiredFieldIds) {
      const coord = `${inst.id}::${fieldId}`;
      if (published.has(coord)) continue;
      const res = await request.post(
        `${apiUrl}/api/v1/runs/${runId}/consensus`,
        {
          headers: authHeaders(token, traceId),
          data: {
            instance_id: inst.id,
            field_id: fieldId,
            mode: "manual_override",
            value: { value: "e2e-required" },
            rationale: "E2E: fill required field for the finalize completeness gate",
          },
          timeout: 15000,
        },
      );
      if (!res.ok()) {
        throw new Error(
          `consensus publish failed for ${coord}: ${res.status()} ${await res.text()}`,
        );
      }
      published.add(coord);
    }
  }

  const advRes = await request.post(
    `${apiUrl}/api/v1/runs/${runId}/advance`,
    {
      headers: authHeaders(token, traceId),
      data: { target_stage: "finalized" },
      timeout: 30000,
    },
  );
  if (!advRes.ok()) {
    throw new Error(
      `finalize advance failed: ${advRes.status()} ${await advRes.text()}`,
    );
  }
}
