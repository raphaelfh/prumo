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
 * JUDGMENT fields are highlighted as a summary card below the questions.
 *
 * A judgment is detected by its answer set (`isJudgmentField`: a select whose
 * allowed values are all risk labels), not by field name. PROBAST+AI's
 * development part judges "Quality" rather than risk of bias, so the previous
 * name allowlist would have rendered its four domain judgments as ordinary
 * signaling rows.
 */

import { ShieldAlert } from "lucide-react";
import { useState } from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DerivedDefaultChip } from "@/components/assessment/DerivedDefaultChip";
import { toneFor } from "@/components/assessment/OverallJudgmentBanner";
import { FieldInput } from "@/components/extraction/FieldInput";
import { useRunEditability } from "@/components/runs/RunEditabilityContext";
import { isJudgmentField } from "@/lib/extraction/judgmentFields";
import { unwrapValueEnvelope } from "@/lib/extraction/valueSemantics";
import { cn } from "@/lib/utils";
import { qa } from "@/lib/copy/qa";
import { SectionAIExtractButton } from "@/components/extraction/ai/shared/SectionAIExtractButton";
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
import type { components } from "@/types/api/schema";

type RunViewDerivedJudgment = components["schemas"]["RunViewDerivedJudgment"];

// The instrument's signaling answer vocabularies (PROBAST Y/PY/PN/N;
// QUADAS-2 adds a substantive Unclear). A select counts as a signaling
// QUESTION only when every option comes from this set — which excludes the
// Low/High/Unclear judgments and classification selects like study_type.
const SIGNALING_VOCAB = new Set(["y", "py", "pn", "n", "unclear"]);

function isSignalingSelect(field: {
  field_type: string;
  allowed_values?: unknown;
}): boolean {
  if (field.field_type !== "select") return false;
  const raw = Array.isArray(field.allowed_values) ? field.allowed_values : [];
  const codes = raw.map((o) =>
    typeof o === "string" ? o : String((o as { value?: unknown })?.value ?? ""),
  );
  return (
    codes.length > 0 &&
    codes.every((c) => SIGNALING_VOCAB.has(c.toLowerCase()))
  );
}

interface QASectionAccordionProps {
  domain: QADomain;
  values: Record<string, unknown>;
  onValueChange: (fieldId: string, value: unknown) => void;
  projectId: string;
  /** Article + active project template + run id — for the per-domain AI extract. */
  articleId: string;
  templateId: string;
  runId?: string | null;
  onExtractionComplete?: (runId?: string) => void | Promise<void>;
  defaultOpen?: boolean;
  /**
   * Real instance id for this domain — REQUIRED: the suggestion key and
   * every value write use the run's instance id, and the QA page (the
   * sole caller) always resolves it from ``session.instancesByEntityType``
   * and skips domains without one. The old synthetic ``entityType.id``
   * fallback was a doomed-write footgun and is deleted (spec 2026-08-22,
   * simplicity pass).
   */
  instanceId: string;
  /**
   * The run view's computed judgments. Entries with a ``target_field_id``
   * matching a judgment field of THIS domain render the derived-default
   * recommendation card (chip + Apply + divergence-rationale gate); entries
   * with a ``summary_field_id`` matching a field here render the computed
   * overall beside that Step-4 summary box. The union of
   * target/rationale/summary ids is the assessor-owned (LLM-excluded) set —
   * a section made entirely of those fields hides its AI extract button.
   * Absent/empty (v1 clones, classic templates): everything renders as
   * before.
   */
  derivedJudgments?: RunViewDerivedJudgment[];
  /**
   * Display hint from ``assessment_scope.study_type``: this part of the
   * form does not apply to the classified study type. Never gates input.
   */
  outOfScope?: boolean;
  /**
   * AI suggestions keyed by ``${instanceId}_${fieldId}``. When a key
   * matches a rendered field, ``FieldInput`` shows the suggestion badge
   * + popover. The accordion does not own the suggestions state — the
   * page passes it down already shaped.
   */
  aiSuggestions?: Record<string, AISuggestion>;
  onAcceptAI?: (instanceId: string, fieldId: string) => Promise<void> | void;
  onRejectAI?: (instanceId: string, fieldId: string) => Promise<void> | void;
  selectSuggestion?: (
    instanceId: string,
    fieldId: string,
    proposalRecordId: string,
    value: unknown,
    confidence: number,
  ) => Promise<void> | void;
  getSuggestionsHistory?: (
    instanceId: string,
    fieldId: string,
  ) => Promise<AISuggestionHistoryItem[]>;
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

export function QASectionAccordion({
  domain,
  values,
  onValueChange,
  projectId,
  articleId,
  templateId,
  runId,
  onExtractionComplete,
  defaultOpen = false,
  reviewerActivity,
  instanceId,
  aiSuggestions,
  onAcceptAI,
  onRejectAI,
  selectSuggestion,
  getSuggestionsHistory,
  derivedJudgments,
  outOfScope = false,
}: QASectionAccordionProps) {
  const { entityType, fields } = domain;

  // Spec-declared pairings (empty maps for v1 clones / classic templates,
  // which keeps every partition below byte-identical to the old behavior).
  const entries = derivedJudgments ?? [];
  const entryByTargetId = new Map(
    entries.filter((d) => d.target_field_id != null).map((d) => [d.target_field_id, d]),
  );
  const entryBySummaryId = new Map(
    entries.filter((d) => d.summary_field_id != null).map((d) => [d.summary_field_id, d]),
  );
  const rationaleFieldIds = new Set(
    entries.map((d) => d.rationale_field_id).filter((id): id is string => id != null),
  );
  const excludedFieldIds = new Set(
    entries
      .flatMap((d) => [d.target_field_id, d.rationale_field_id, d.summary_field_id])
      .filter((id): id is string => id != null),
  );

  const summary = fields.filter((f) => isJudgmentField(f));
  // Judgment-vocabulary judgments WITHOUT a recommendation entry
  // (applicability; every v1/classic judgment) pull their name-paired
  // ``<name>_rationale`` sibling into the judgment card too, so the pair
  // never reads disconnected. Display-only convention: templates without
  // such siblings (v1, classics) are unaffected.
  const pairedRationaleByJudgmentId = new Map(
    summary
      .filter((f) => !entryByTargetId.has(f.id))
      .map((f) => [f.id, fields.find((s) => s.name === `${f.name}_rationale`)] as const)
      .filter((pair): pair is [string, QADomain["fields"][number]] => pair[1] != null),
  );
  const pairedRationaleIds = new Set(
    [...pairedRationaleByJudgmentId.values()].map((r) => r.id),
  );

  // Judgment-linked rationales render INSIDE their judgment card, never in
  // the signaling list; everything else keeps the judgment/signaling split.
  const signaling = fields.filter(
    (f) =>
      !isJudgmentField(f) &&
      !rationaleFieldIds.has(f.id) &&
      !pairedRationaleIds.has(f.id),
  );
  // The header badge counts actual signaling QUESTIONS — selects in the
  // instrument's answer vocabulary — never free-text boxes and never a
  // classification select like ``study_type``.
  const signalingQuestionCount = signaling.filter(isSignalingSelect).length;
  // Scope-like sections (no signaling questions, no judgments) drop the
  // warning icon too: nothing in them is a risk assessment.
  const sectionAssesses = signalingQuestionCount > 0 || summary.length > 0;
  const allFieldsExcluded =
    fields.length > 0 && fields.every((f) => excludedFieldIds.has(f.id));

  // Divergence gate (spec §6): a judgment pick that differs from a non-null
  // derived default is HELD here — never written — until the paired
  // rationale has text and the reviewer confirms. Deliberately volatile
  // local state: navigating away drops the held pick (the requirement copy
  // is visible the whole time), so no phantom value ever reaches autosave.
  const [heldJudgments, setHeldJudgments] = useState<Record<string, string>>({});

  // Field ids are TEMPLATE-level, shared by every article's run — but the
  // accordion is keyed by entity type and survives in-place article
  // navigation. Without this reset a pick held on article A would display
  // (and be confirmable) on article B. Same render-phase adjustment
  // pattern as the page's hydration.
  const [prevInstanceId, setPrevInstanceId] = useState(instanceId);
  if (instanceId !== prevInstanceId) {
    setPrevInstanceId(instanceId);
    if (Object.keys(heldJudgments).length > 0) setHeldJudgments({});
  }

  // Read-only surfaces (finalized runs, viewer role): every input is
  // disabled, so Apply must be too — otherwise it silently mutates the
  // displayed values of a published record with nothing persisting.
  const { readOnly } = useRunEditability();

  function rationaleIsEmpty(entry: RunViewDerivedJudgment): boolean {
    if (entry.rationale_field_id == null) return false;
    const raw = unwrapValueEnvelope(values[entry.rationale_field_id]);
    return raw == null || (typeof raw === "string" && raw.trim() === "");
  }

  function clearHeld(fieldId: string) {
    setHeldJudgments((prev) => {
      if (!(fieldId in prev)) return prev;
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  }

  function handleJudgmentChange(
    fieldId: string,
    entry: RunViewDerivedJudgment,
    next: unknown,
  ) {
    const derived = entry.value ?? null;
    // The gate holds only an EXPLICIT judgment pick (a non-empty string from
    // the Low/High/Unclear select) that differs from a non-null derived
    // default. Everything else writes through immediately: a disposition
    // marker is an object envelope ("No information" IS an answer — the
    // backend maps it to Unclear), and a clear arrives as ''/null — holding
    // either turned it into garbage ("[object Object]") or silently lost it.
    const isExplicitPick = typeof next === "string" && next.trim() !== "";
    if (
      derived !== null &&
      isExplicitPick &&
      next !== derived &&
      rationaleIsEmpty(entry)
    ) {
      setHeldJudgments((prev) => ({ ...prev, [fieldId]: next }));
      return;
    }
    clearHeld(fieldId);
    onValueChange(fieldId, next);
  }

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
      data-section-id={entityType.id}
    >
      <AccordionItem
        value={itemValue}
        className="rounded-md border bg-card mb-3"
      >
        <div className="flex items-center gap-1 pr-2">
          <AccordionTrigger className="flex-1 px-4 py-3 hover:no-underline">
            <div className="flex flex-1 items-center justify-between gap-3 text-left">
              <div className="flex items-center gap-2">
                {sectionAssesses ? (
                  <ShieldAlert
                    className="h-4 w-4 text-warning"
                    data-testid={`qa-section-risk-icon-${entityType.name}`}
                  />
                ) : null}
                <span className="text-sm font-semibold">{sectionLabel}</span>
                {signalingQuestionCount > 0 ? (
                  <Badge variant="secondary" className="text-[10px]">
                    {signalingQuestionCount} signaling{" "}
                    {signalingQuestionCount === 1 ? "question" : "questions"}
                  </Badge>
                ) : null}
                {outOfScope ? (
                  <Badge
                    variant="outline"
                    className="text-[10px] text-muted-foreground"
                    data-testid={`qa-out-of-scope-${entityType.name}`}
                  >
                    {qa.outOfScopeBadge}
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
          {/* Per-domain AI extract — shared with the data-extraction screen.
              Hidden when every field is assessor-owned (LLM-excluded): the
              backend would skip the call, so the button would be a dead
              affordance (the ``overall_judgement`` section). */}
          {!allFieldsExcluded ? (
            <SectionAIExtractButton
              projectId={projectId}
              articleId={articleId}
              templateId={templateId}
              entityTypeId={entityType.id}
              entityLabel={sectionLabel}
              runId={runId}
              onExtractionComplete={onExtractionComplete}
            />
          ) : null}
        </div>
        <AccordionContent className="px-4 pb-4 pt-0">
          {entityType.description ? (
            <p className="mb-3 text-xs text-muted-foreground">
              {entityType.description}
            </p>
          ) : null}

          {signaling.length > 0 ? (
            <div className="divide-y">
              {signaling.map((field) => {
                const stack = fieldStack(field.id);
                const aiKey = getSuggestionKey(instanceId, field.id);
                const aiSuggestion = aiSuggestions?.[aiKey];
                const summaryEntry = entryBySummaryId.get(field.id);
                return (
                  <div
                    key={field.id}
                    className="py-1"
                    data-testid={`qa-field-row-${field.name}`}
                  >
                    {summaryEntry ? (
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          {summaryEntry.label}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "gap-1 font-normal",
                            toneFor(summaryEntry.value ?? null),
                          )}
                          data-testid={`qa-summary-overall-${summaryEntry.id}`}
                        >
                          {summaryEntry.value ?? qa.overallIncomplete}
                        </Badge>
                      </div>
                    ) : null}
                    <FieldInput
                      field={field}
                      instanceId={instanceId}
                      value={values[field.id]}
                      onChange={(v) => onValueChange(field.id, v)}
                      projectId={projectId}
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
                      selectSuggestion={selectSuggestion}
                      getSuggestionsHistory={getSuggestionsHistory}
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
              className="mt-4 rounded-md border border-warning/30 bg-warning/10 p-3"
              data-testid={`qa-domain-summary-${entityType.name}`}
            >
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-warning">
                {qa.domainJudgmentCardTitle}
              </p>
              <div className="divide-y">
                {summary.map((field) => {
                  const stack = fieldStack(field.id);
                  const aiKey = getSuggestionKey(instanceId, field.id);
                  const aiSuggestion = aiSuggestions?.[aiKey];
                  const entry = entryByTargetId.get(field.id);

                  if (!entry) {
                    // No recommendation (applicability, v1 clones, classic
                    // templates): the plain editable judgment row, with its
                    // name-paired rationale (when one exists) rendered right
                    // below it — both keep the full AI suggestion flow.
                    const pairedRationale = pairedRationaleByJudgmentId.get(
                      field.id,
                    );
                    const rationaleKey = pairedRationale
                      ? getSuggestionKey(instanceId, pairedRationale.id)
                      : null;
                    return (
                      <div key={field.id} className="py-1">
                        <FieldInput
                          field={field}
                          instanceId={instanceId}
                          value={values[field.id]}
                          onChange={(v) => onValueChange(field.id, v)}
                          projectId={projectId}
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
                          selectSuggestion={selectSuggestion}
                          getSuggestionsHistory={getSuggestionsHistory}
                          articleId={articleId}
                        />
                        {pairedRationale ? (
                          <div
                            className="mt-1"
                            data-testid={`qa-paired-rationale-${field.name}`}
                          >
                            <FieldInput
                              field={pairedRationale}
                              instanceId={instanceId}
                              value={values[pairedRationale.id]}
                              onChange={(v) =>
                                onValueChange(pairedRationale.id, v)
                              }
                              projectId={projectId}
                              aiSuggestion={
                                rationaleKey
                                  ? aiSuggestions?.[rationaleKey]
                                  : undefined
                              }
                              onAcceptAI={
                                onAcceptAI
                                  ? () => onAcceptAI(instanceId, pairedRationale.id)
                                  : undefined
                              }
                              onRejectAI={
                                onRejectAI
                                  ? () => onRejectAI(instanceId, pairedRationale.id)
                                  : undefined
                              }
                              selectSuggestion={selectSuggestion}
                              getSuggestionsHistory={getSuggestionsHistory}
                              articleId={articleId}
                            />
                          </div>
                        ) : null}
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
                  }

                  // Recommendation card (spec §6): derived-default chip +
                  // Apply, the assessor's judgment input (gated on
                  // divergence), and the paired rationale — one block, no AI
                  // affordances (these fields never receive suggestions).
                  const rationaleField = fields.find(
                    (f) => f.id === entry.rationale_field_id,
                  );
                  const heldValue = heldJudgments[field.id];
                  const currentRaw = unwrapValueEnvelope(values[field.id]);
                  const hydratedDivergent =
                    heldValue === undefined &&
                    entry.value != null &&
                    currentRaw != null &&
                    String(currentRaw) !== entry.value;
                  return (
                    <div
                      key={field.id}
                      className="py-2"
                      data-testid={`qa-judgment-card-${field.id}`}
                    >
                      <DerivedDefaultChip
                        judgment={entry}
                        disabled={readOnly}
                        onApply={(v) => {
                          clearHeld(field.id);
                          onValueChange(field.id, v);
                        }}
                      />
                      <FieldInput
                        field={field}
                        instanceId={instanceId}
                        value={heldValue ?? values[field.id]}
                        onChange={(v) => handleJudgmentChange(field.id, entry, v)}
                        projectId={projectId}
                        articleId={articleId}
                      />
                      {heldValue !== undefined && !readOnly ? (
                        <div
                          className="mt-1 flex items-center justify-between gap-3 rounded-sm border border-warning/40 bg-warning/10 px-2 py-1"
                          data-testid={`qa-divergence-${field.id}`}
                        >
                          <p className="text-[11px] text-warning">
                            {qa.divergenceNeedsRationale}
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-6 shrink-0 px-2 text-[11px]"
                            disabled={rationaleIsEmpty(entry)}
                            onClick={() => {
                              clearHeld(field.id);
                              onValueChange(field.id, heldValue);
                            }}
                            data-testid={`qa-divergence-confirm-${field.id}`}
                          >
                            {qa.divergenceConfirm}
                          </Button>
                        </div>
                      ) : null}
                      {hydratedDivergent ? (
                        <p
                          className="mt-1 text-[11px] text-muted-foreground"
                          data-testid={`qa-divergence-note-${field.id}`}
                        >
                          {qa.divergenceNote}
                        </p>
                      ) : null}
                      {rationaleField ? (
                        <div className="mt-1">
                          <FieldInput
                            field={rationaleField}
                            instanceId={instanceId}
                            value={values[rationaleField.id]}
                            onChange={(v) => onValueChange(rationaleField.id, v)}
                            projectId={projectId}
                            articleId={articleId}
                          />
                        </div>
                      ) : null}
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
