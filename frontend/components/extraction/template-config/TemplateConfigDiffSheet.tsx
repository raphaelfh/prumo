/**
 * The read-only "unpublished changes" sheet (slice B-9b2a, D7/D8).
 *
 * Hosted in a `Sheet` rather than an `AlertDialog`: `AlertDialogContent`
 * has no scroll container, and its rows would land inside the dialog's
 * accessible description, which `aria-describedby` flattens into one
 * unreadable string.
 *
 * Read-only by design — no acknowledgements, no note, no Publish. The
 * slice exists to ratify the wire model on screen while it is still cheap
 * to change.
 *
 * @component
 */
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {Badge} from '@/components/ui/badge';
import {ScrollArea} from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {useTemplateConfigDiff} from '@/hooks/extraction/useTemplateConfigDiff';
import {t} from '@/lib/copy';
import type {templateConfig} from '@/lib/copy';
import type {
  ChangeTier,
  ChangeVariant,
  TemplateChangeRow,
  TemplateConfigDiff,
  TemplateDiffUnavailableReason,
} from '@/services/templateService';

type CopyKey = keyof typeof templateConfig;

/**
 * One sentence per variant — exhaustive at compile time, defensive at
 * runtime. `satisfies` over the GENERATED union means regenerating
 * `schema.d.ts` with a new variant breaks the build instead of shipping a
 * blank row; the `??` below covers a server ahead of this bundle.
 */
const VARIANT_COPY = {
  entity_type_added: 'changeEntityTypeAdded',
  entity_type_fields_reordered: 'changeEntityTypeFieldsReordered',
  entity_type_modified: 'changeEntityTypeModified',
  entity_type_removed: 'changeEntityTypeRemoved',
  field_added: 'changeFieldAdded',
  field_modified: 'changeFieldModified',
  field_moved: 'changeFieldMoved',
  field_option_added: 'changeFieldOptionAdded',
  field_option_removed: 'changeFieldOptionRemoved',
  field_options_reordered: 'changeFieldOptionsReordered',
  field_removed: 'changeFieldRemoved',
  template_instruction_added: 'changeTemplateInstructionAdded',
  template_instruction_modified: 'changeTemplateInstructionModified',
  template_instruction_removed: 'changeTemplateInstructionRemoved',
} satisfies Record<ChangeVariant, CopyKey>;

/**
 * Attribute names in human words. NOT keyed off a union — `attribute` is
 * an open string on the wire — so an unmapped key falls back to the raw
 * server value rather than to nothing.
 */
const ATTRIBUTE_COPY: Record<string, CopyKey> = {
  allow_other: 'diffAttrAllowOther',
  allowed_units: 'diffAttrAllowedUnits',
  allowed_values: 'diffAttrAllowedValues',
  allows_not_applicable: 'diffAttrAllowsNotApplicable',
  allows_not_evaluated: 'diffAttrAllowsNotEvaluated',
  cardinality: 'diffAttrCardinality',
  description: 'diffAttrDescription',
  entry_label: 'diffAttrEntryLabel',
  field_type: 'diffAttrFieldType',
  is_required: 'diffAttrIsRequired',
  label: 'diffAttrLabel',
  llm_description: 'diffAttrLlmDescription',
  llm_template_instruction: 'diffAttrLlmTemplateInstruction',
  name: 'diffAttrName',
  other_label: 'diffAttrOtherLabel',
  other_placeholder: 'diffAttrOtherPlaceholder',
  parent_entity_type_id: 'diffAttrParentEntityTypeId',
  role: 'diffAttrRole',
  unit: 'diffAttrUnit',
  validation_schema: 'diffAttrValidationSchema',
};

/** Render order: the most consequential tier first. */
const TIER_ORDER = [
  'destructive',
  'semantic',
  'cosmetic',
  'additive',
] as const satisfies readonly ChangeTier[];

const TIER_COPY = {
  additive: 'diffTierAdditive',
  cosmetic: 'diffTierCosmetic',
  destructive: 'diffTierDestructive',
  semantic: 'diffTierSemantic',
} satisfies Record<ChangeTier, CopyKey>;

/**
 * Destructive is listed on open; every other tier is expand-to-view. All
 * four expand to the SAME row list — a tier is never a count-only group.
 */
const DEFAULT_OPEN: ChangeTier[] = ['destructive'];

/**
 * Why the diff could not be computed. Exhaustive over the generated enum;
 * the `??` covers a server that learned a new reason before this bundle
 * did — still an explanation, never "no changes".
 */
const UNAVAILABLE_COPY = {
  baseline_too_old: 'diffBaselineTooOld',
} satisfies Record<TemplateDiffUnavailableReason, CopyKey>;

interface TemplateConfigDiffSheetProps {
  projectId: string;
  templateId: string;
  onClose: () => void;
}

function rowsOf(diff: TemplateConfigDiff, tier: ChangeTier): TemplateChangeRow[] {
  return diff.changes?.[tier] ?? [];
}

/**
 * The row's headline. The two reorder variants deliberately do NOT share
 * a sentence: they count different populations (see the copy keys). A
 * reorder row without a count falls back to the arithmetic-free phrasing
 * rather than printing a placeholder.
 */
function sentenceOf(row: TemplateChangeRow): string {
  const raw = t('templateConfig', VARIANT_COPY[row.variant] ?? 'changeUnknown');
  if (!raw.includes('{{n}}')) return raw;
  return typeof row.reorder_count === 'number'
    ? raw.replace('{{n}}', String(row.reorder_count))
    : t('templateConfig', 'changeReorderPlain');
}

/** Opaque values arrive pre-rendered; only booleans need words. */
function valueText(value: string | boolean): string {
  return typeof value === 'boolean'
    ? t('extraction', value ? 'yes' : 'no')
    : value;
}

function DiffRow({row, tier}: {row: TemplateChangeRow; tier: ChangeTier}) {
  const before = row.before ?? null;
  const after = row.after ?? null;
  // D6: the server computes `affects_recorded_data` for every node kind,
  // but only a destructive row is allowed to wear it.
  const flagged = tier === 'destructive' && row.affects_recorded_data;
  const attributeKey =
    row.attribute == null ? undefined : ATTRIBUTE_COPY[row.attribute];
  const attributeLabel =
    attributeKey != null ? t('templateConfig', attributeKey) : row.attribute;

  return (
    <li
      data-testid={`template-diff-row-${row.id}`}
      className="border-t border-border/40 px-5 py-2.5 first:border-t-0"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm leading-5">{sentenceOf(row)}</span>
        {flagged && (
          <Badge
            variant="outline"
            className="shrink-0 border-destructive/40 bg-destructive/10 text-[0.6875rem] font-normal text-destructive"
          >
            {t('templateConfig', 'diffRecordedWork')}
          </Badge>
        )}
      </div>
      {/* Wraps rather than truncates: the field name is the LAST segment,
          so an ellipsis would eat the part that identifies the row. */}
      {row.label_path.length > 0 && (
        <p className="break-words text-xs text-muted-foreground">
          {row.label_path.join(' › ')}
        </p>
      )}
      {attributeLabel != null && (
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">{attributeLabel}</span>
          {before != null && (
            <span className="rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem] line-through decoration-muted-foreground/60">
              {valueText(before)}
            </span>
          )}
          {before != null && after != null && (
            <span aria-hidden className="text-muted-foreground">
              →
            </span>
          )}
          {after != null && (
            <span className="rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem]">
              {valueText(after)}
            </span>
          )}
        </p>
      )}
    </li>
  );
}

/** A one-line explanation instead of a row list. */
function DiffNotice({copyKey}: {copyKey: CopyKey}) {
  return (
    <p className="px-5 py-6 text-xs leading-5 text-muted-foreground">
      {t('templateConfig', copyKey)}
    </p>
  );
}

/**
 * The five bodies, in the order the checks have to run. A failed read is
 * answered BEFORE the empty case: a dropped connection must never render
 * as "this draft matches the published version".
 */
function DiffBody({
  diff,
  isPending,
}: {
  diff: TemplateConfigDiff | undefined;
  isPending: boolean;
}) {
  if (isPending) return <DiffNotice copyKey="diffLoading" />;
  if (diff == null) return <DiffNotice copyKey="diffLoadFailed" />;
  if (!diff.diff_available) {
    // The contract: `diff_available === false` implies exactly one of
    // these. `initial_version` first, because it is the shape with its
    // own story ("everything is new"), not a failure to compare.
    if (diff.initial_version) return <DiffNotice copyKey="diffInitialVersion" />;
    const reason = diff.unavailable_reason;
    // A `diff_available: false` payload with neither `initial_version` nor
    // `unavailable_reason` set violates its own contract — that is an
    // unreadable payload, not a specific cause, so it falls back to
    // diffLoadFailed rather than asserting a baseline-too-old story that
    // was never reported.
    return (
      <DiffNotice
        copyKey={
          (reason == null ? undefined : UNAVAILABLE_COPY[reason]) ??
          'diffLoadFailed'
        }
      />
    );
  }
  const populated = TIER_ORDER.filter((tier) => rowsOf(diff, tier).length > 0);
  if (populated.length === 0) return <DiffNotice copyKey="diffEmpty" />;

  return (
    <Accordion type="multiple" defaultValue={DEFAULT_OPEN}>
      {populated.map((tier) => {
        const rows = rowsOf(diff, tier);
        return (
          <AccordionItem
            key={tier}
            value={tier}
            data-testid={`template-diff-group-${tier}`}
          >
            <AccordionTrigger className="px-5 py-3 text-sm hover:no-underline">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">
                  {t('templateConfig', TIER_COPY[tier])}
                </span>
                <Badge variant="secondary" className="text-[0.6875rem]">
                  {rows.length}
                </Badge>
              </span>
            </AccordionTrigger>
            <AccordionContent className="p-0">
              <ul>
                {rows.map((row) => (
                  <DiffRow key={row.id} row={row} tier={tier} />
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

export function TemplateConfigDiffSheet({
  projectId,
  templateId,
  onClose,
}: TemplateConfigDiffSheetProps) {
  const {data: diff, isPending} = useTemplateConfigDiff(projectId, templateId);

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[26rem]"
      >
        <SheetHeader className="border-b px-5 py-4 text-left">
          <SheetTitle>{t('templateConfig', 'diffSheetTitle')}</SheetTitle>
          <SheetDescription>
            {t('templateConfig', 'diffSheetDescription')}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <DiffBody diff={diff} isPending={isPending} />
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
