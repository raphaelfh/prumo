/**
 * The QA form's scope gating is only as good as the read behind it: every
 * out-of-scope affordance on that screen — the section badge, the muted title,
 * the hidden AI button — resolves from `scope_rules` on the template's
 * `schema`. That column is NOT in a `select('*')` here; it is named
 * explicitly, so dropping it silently turns the whole feature off with no type
 * error and no other failing test. This pins it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const selects: string[] = [];
const TEMPLATE = {
  id: "tpl-1",
  name: "PROBAST+AI",
  description: null,
  framework: "PROBAST_AI",
  version: "2.1.0",
  kind: "quality_assessment",
  schema: {
    scope_rules: {
      classifier: { section: "assessment_scope", field: "study_type" },
      excludes: { development_only: ["eval_d1_participants"] },
    },
  },
};

vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const self: Record<string, unknown> = {
      select: (columns: string) => {
        selects.push(`${table}:${columns}`);
        return self;
      },
      eq: () => self,
      order: () => Promise.resolve({ data: [], error: null }),
      maybeSingle: () => Promise.resolve({ data: TEMPLATE, error: null }),
    };
    return self;
  };
  return { supabase: { from: (table: string) => chain(table) } };
});

import { loadProjectQATemplate } from "@/services/qaTemplateService";

describe("loadProjectQATemplate", () => {
  beforeEach(() => {
    selects.length = 0;
  });

  it("selects the schema column that carries scope_rules", () => {
    void loadProjectQATemplate("tpl-1");
    const templateSelect = selects.find((s) =>
      s.startsWith("project_extraction_templates:"),
    );
    expect(templateSelect).toContain("schema");
  });

  it("hands the rules through to the caller", async () => {
    const result = await loadProjectQATemplate("tpl-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.template.schema).toEqual(TEMPLATE.schema);
  });
});
