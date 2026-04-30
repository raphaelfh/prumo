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
import {
  getSuggestionKey,
  type AISuggestion,
  type AISuggestionHistoryItem,
} from "@/types/ai-extraction";

interface QASectionAccordionProps {
  domain: QADomain;
  values: Record<string, unknown>;
  onValueChange: (fieldId: string, value: unknown) => void;
  projectId: string;
  articleId: string;
  defaultOpen?: boolean;
  /**
   * Real instance id for this domain. Required for AI suggestions to
   * resolve correctly (the suggestion key uses the run's instance id,
   * not the synthetic ``entityType.id`` the accordion falls back to
   * when running standalone). The QA page resolves this from
   * ``session.instancesByEntityType``.
   */
  instanceId?: string;
  /**
   * AI suggestions keyed by ``${instanceId}_${fieldId}``. When a key
   * matches a rendered field, ``FieldInput`` shows the suggestion badge
   * + popover. The accordion does not own the suggestions state — the
   * page passes it down already shaped.
   */
  aiSuggestions?: Record<string, AISuggestion>;
  onAcceptAI?: (instanceId: string, fieldId: string) => Promise<void> | void;
  onRejectAI?: (instanceId: string, fieldId: string) => Promise<void> | void;
  getSuggestionsHistory?: (
    instanceId: string,
    fieldId: string,
  ) => Promise<AISuggestionHistoryItem[]>;
  isAIActionLoading?: (
    instanceId: string,
    fieldId: string,
  ) => "accept" | "reject" | null;
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
  instanceId: instanceIdProp,
  aiSuggestions,
  onAcceptAI,
  onRejectAI,
  getSuggestionsHistory,
  isAIActionLoading,
}: QASectionAccordionProps) {
  const { entityType, fields } = domain;
  const signaling = fields.filter((f) => !SUMMARY_FIELD_NAMES.has(f.name));
  const summary = fields.filter((f) => SUMMARY_FIELD_NAMES.has(f.name));

  // Prefer the real run instance id passed from the QA page so AI
  // suggestions resolve under the correct key. Standalone usage (no
  // session yet) falls back to the synthetic entity_type id.
  const instanceId = instanceIdProp ?? entityType.id;
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
                const aiKey = getSuggestionKey(instanceId, field.id);
                const aiSuggestion = aiSuggestions?.[aiKey];
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
                      aiSuggestion={aiSuggestion}
                      onAcceptAI={
                        onAcceptAI
                          ? () => onAcceptAI(instanceId, field.id)
                          : undefined
                      }
                      onRejectAI={
                        onRejectAI
                          ? () => onRejectAI(instanceId, field.id)
                          : undefined
                      }
                      getSuggestionsHistory={getSuggestionsHistory}
                      isActionLoading={
                        isAIActionLoading
                          ? () => isAIActionLoading(instanceId, field.id)
                          : undefined
                      }
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
                  const aiKey = getSuggestionKey(instanceId, field.id);
                  const aiSuggestion = aiSuggestions?.[aiKey];
                  return (
                    <div key={field.id} className="pt-1">
                      <FieldInput
                        field={field}
                        instanceId={instanceId}
                        value={values[field.id]}
                        onChange={(v) => onValueChange(field.id, v)}
                        projectId={projectId}
                        articleId={articleId}
                        aiSuggestion={aiSuggestion}
                        onAcceptAI={
                          onAcceptAI
                            ? () => onAcceptAI(instanceId, field.id)
                            : undefined
                        }
                        onRejectAI={
                          onRejectAI
                            ? () => onRejectAI(instanceId, field.id)
                            : undefined
                        }
                        getSuggestionsHistory={getSuggestionsHistory}
                        isActionLoading={
                          isAIActionLoading
                            ? () => isAIActionLoading(instanceId, field.id)
                            : undefined
                        }
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
