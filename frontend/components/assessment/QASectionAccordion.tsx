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
import type { QADomain } from "@/hooks/qa/useQATemplate";

interface QASectionAccordionProps {
  domain: QADomain;
  values: Record<string, unknown>;
  onValueChange: (fieldId: string, value: unknown) => void;
  projectId: string;
  articleId: string;
  defaultOpen?: boolean;
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
}: QASectionAccordionProps) {
  const { entityType, fields } = domain;
  const signaling = fields.filter((f) => !SUMMARY_FIELD_NAMES.has(f.name));
  const summary = fields.filter((f) => SUMMARY_FIELD_NAMES.has(f.name));

  // Synthetic instanceId per domain — QA is 1:1 per (article × domain),
  // so we use the entityType.id as a stable handle for FieldInput's
  // `${instanceId}_${fieldId}` cache keys.
  const instanceId = entityType.id;
  const sectionLabel = entityType.label || entityType.name;
  const itemValue = `qa-domain-${entityType.id}`;

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
              {signaling.map((field) => (
                <div key={field.id} className="pt-1">
                  <FieldInput
                    field={field}
                    instanceId={instanceId}
                    value={values[field.id]}
                    onChange={(v) => onValueChange(field.id, v)}
                    projectId={projectId}
                    articleId={articleId}
                  />
                </div>
              ))}
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
                {summary.map((field) => (
                  <div key={field.id} className="pt-1">
                    <FieldInput
                      field={field}
                      instanceId={instanceId}
                      value={values[field.id]}
                      onChange={(v) => onValueChange(field.id, v)}
                      projectId={projectId}
                      articleId={articleId}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
