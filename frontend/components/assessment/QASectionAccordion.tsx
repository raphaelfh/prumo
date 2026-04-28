/**
 * Quality-assessment domain accordion.
 *
 * Inspired by `extraction/SectionAccordion`, but stripped of multi-instance,
 * AI-suggestion, and section-extraction concerns that don't apply to QA
 * (PROBAST/QUADAS-2 are 1:1 per article × domain, with closed-set answers
 * and no LLM proposal pipeline at this stage).
 *
 * Renders one entity_type (domain) as a shadcn Accordion item. Signaling
 * questions render via the existing `FieldInput` component; the domain-level
 * `risk_of_bias` and `applicability_concerns` fields are highlighted as a
 * summary card below the questions.
 */

import { ShieldAlert } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { FieldInput } from "@/components/extraction/FieldInput";
import {
  ReviewerAvatarStack,
  type ReviewerAvatarEntry,
} from "@/components/runs/ReviewerAvatarStack";
import type { QADomain } from "@/hooks/qa/useQATemplate";

interface QASectionAccordionProps {
  domain: QADomain;
  values: Record<string, unknown>;
  onValueChange: (fieldId: string, value: unknown) => void;
  projectId: string;
  articleId: string;
  defaultOpen?: boolean;
  /**
   * Display profiles + activity per (instance, field) within this
   * domain. When provided, the accordion header surfaces a stacked
   * avatar of reviewers who have written at least one decision in any
   * field of the domain, and each FieldInput row shows a small stack
   * of the reviewers active on that specific field.
   */
  reviewerActivity?: {
    decisionsByCoord: Map<string, { reviewer_id: string }[]>;
    labelById: Record<string, string>;
    avatarById: Record<string, string | null>;
    instanceId: string;
  };
}

const SUMMARY_FIELD_NAMES = new Set([
  "risk_of_bias",
  "applicability_concerns",
  "overall_risk_of_bias",
  "overall_applicability",
]);

export function QASectionAccordion({
  domain,
  values,
  onValueChange,
  projectId,
  articleId,
  defaultOpen = false,
  reviewerActivity,
}: QASectionAccordionProps) {
  const { entityType, fields } = domain;
  const signaling = fields.filter((f) => !SUMMARY_FIELD_NAMES.has(f.name));
  const summary = fields.filter((f) => SUMMARY_FIELD_NAMES.has(f.name));

  // The synthetic id when running QA standalone is just the entity_type
  // id; when the QA page is wired to a real run the parent passes the
  // run instance id via reviewerActivity. The visual stack uses that
  // — but FieldInput's cache key still keys off entityType.id.
  const instanceId = entityType.id;
  const sectionLabel = entityType.label || entityType.name;
  const itemValue = `qa-domain-${entityType.id}`;

  // Build a per-field avatar map so each FieldInput row shows just the
  // reviewers that touched THAT field. Fall back to the empty stack
  // (renders nothing) when no activity data was provided.
  function fieldStack(fieldId: string): ReviewerAvatarEntry[] {
    if (!reviewerActivity) return [];
    const coordKey = `${reviewerActivity.instanceId}::${fieldId}`;
    const decisions = reviewerActivity.decisionsByCoord.get(coordKey) ?? [];
    const seen = new Set<string>();
    const stack: ReviewerAvatarEntry[] = [];
    for (const d of decisions) {
      if (seen.has(d.reviewer_id)) continue;
      seen.add(d.reviewer_id);
      stack.push({
        id: d.reviewer_id,
        name:
          reviewerActivity.labelById[d.reviewer_id] ??
          `Reviewer ${d.reviewer_id.slice(0, 8)}…`,
        avatarUrl: reviewerActivity.avatarById[d.reviewer_id] ?? null,
      });
    }
    return stack;
  }

  // Domain-level: union of everyone who touched any field of this
  // domain. Render in the accordion trigger so users can scan
  // participation without expanding.
  const domainStack: ReviewerAvatarEntry[] = (() => {
    if (!reviewerActivity) return [];
    const seen = new Set<string>();
    const stack: ReviewerAvatarEntry[] = [];
    for (const f of fields) {
      for (const d of fieldStack(f.id)) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        stack.push(d);
      }
    }
    return stack;
  })();

  return (
    <Accordion
      type="single"
      collapsible
      defaultValue={defaultOpen ? itemValue : undefined}
      data-testid={`qa-domain-${entityType.name}`}
    >
      <AccordionItem
        value={itemValue}
        className="rounded-md border bg-card mb-3"
      >
        <AccordionTrigger className="px-4 py-3 hover:no-underline">
          <div className="flex flex-1 items-center justify-between gap-3 text-left">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              <span className="text-sm font-semibold">{sectionLabel}</span>
              {signaling.length > 0 ? (
                <Badge variant="secondary" className="text-[10px]">
                  {signaling.length} signaling{" "}
                  {signaling.length === 1 ? "question" : "questions"}
                </Badge>
              ) : null}
            </div>
            {domainStack.length > 0 ? (
              <ReviewerAvatarStack
                reviewers={domainStack}
                sizeClass="size-5"
                testId={`qa-domain-avatars-${entityType.name}`}
              />
            ) : null}
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-4 pb-4 pt-0">
          {entityType.description ? (
            <p className="mb-3 text-xs text-muted-foreground">
              {entityType.description}
            </p>
          ) : null}

          {signaling.length > 0 ? (
            <div className="space-y-1 divide-y">
              {signaling.map((field) => {
                const stack = fieldStack(field.id);
                return (
                  <div
                    key={field.id}
                    className="pt-1"
                    data-testid={`qa-field-row-${field.name}`}
                  >
                    <FieldInput
                      field={field}
                      instanceId={instanceId}
                      value={values[field.id]}
                      onChange={(v) => onValueChange(field.id, v)}
                      projectId={projectId}
                      articleId={articleId}
                    />
                    {stack.length > 0 ? (
                      <div className="mt-1 flex justify-end">
                        <ReviewerAvatarStack
                          reviewers={stack}
                          sizeClass="size-5"
                          testId={`qa-field-avatars-${field.name}`}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {summary.length > 0 ? (
            <div
              className="mt-4 rounded-md border border-amber-300 bg-amber-50/40 p-3 dark:border-amber-900 dark:bg-amber-950/30"
              data-testid={`qa-domain-summary-${entityType.name}`}
            >
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-200">
                Domain judgment
              </p>
              <div className="space-y-1 divide-y">
                {summary.map((field) => {
                  const stack = fieldStack(field.id);
                  return (
                    <div key={field.id} className="pt-1">
                      <FieldInput
                        field={field}
                        instanceId={instanceId}
                        value={values[field.id]}
                        onChange={(v) => onValueChange(field.id, v)}
                        projectId={projectId}
                        articleId={articleId}
                      />
                      {stack.length > 0 ? (
                        <div className="mt-1 flex justify-end">
                          <ReviewerAvatarStack
                            reviewers={stack}
                            sizeClass="size-5"
                            testId={`qa-field-avatars-${field.name}`}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
