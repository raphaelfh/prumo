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
import {useState} from 'react';
import {toast} from 'sonner';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {Label} from '@/components/ui/label';
import {ScrollArea} from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {Textarea} from '@/components/ui/textarea';
import {useTemplateConfigDiff} from '@/hooks/extraction/useTemplateConfigDiff';
import {useTemplateRepublish} from '@/hooks/extraction/useTemplateRepublish';
import {t} from '@/lib/copy';
import type {templateConfig} from '@/lib/copy';
import type {
  ChangeTier,
  ChangeVariant,
  DiffStatus,
  OpaqueValueState,
  TemplateChangeRow,
  TemplateConfigDiff,
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
  allows_no_information: 'diffAttrAllowsNoInformation',
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
 * Why there are no rows to list. Keyed off the generated union MINUS the
 * one status that carries rows, so a status added to the wire fails the
 * typecheck here instead of rendering a blank sheet. Neither line may read
 * as "no changes" — the draft has them, they just cannot be listed.
 */
const STATUS_NOTICE = {
  baseline_too_old: 'diffBaselineTooOld',
  initial_version: 'diffInitialVersion',
} satisfies Record<Exclude<DiffStatus, 'available'>, CopyKey>;

/**
 * An opaque value has nothing listable to print, so the wire ships a state
 * and the word is chosen here rather than by the server (D3).
 */
const OPAQUE_STATE_COPY = {
  empty: 'diffValueEmpty',
  present: 'diffValueSet',
} satisfies Record<OpaqueValueState, CopyKey>;

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

/**
 * One side of the before/after pair, or `null` when the attribute was
 * absent. A state and a value never arrive together: a joined list or dict
 * comes through as data, anything else the snapshot could not print comes
 * through as a state whose word this layer owns.
 */
function slotText(
  value: string | boolean | null | undefined,
  state: OpaqueValueState | null | undefined,
): string | null {
  if (state != null) return t('templateConfig', OPAQUE_STATE_COPY[state]);
  if (value == null) return null;
  return typeof value === 'boolean'
    ? t('extraction', value ? 'yes' : 'no')
    : value;
}

function DiffRow({
  row,
  tier,
  ack,
}: {
  row: TemplateChangeRow;
  tier: ChangeTier;
  /** Present only for DESTRUCTIVE rows — the only tier the spec gates. */
  ack?: {checked: boolean; onToggle: () => void};
}) {
  const before = slotText(row.before, row.before_opaque_state);
  const after = slotText(row.after, row.after_opaque_state);
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
        {ack != null && (
          <Checkbox
            id={`ack-${row.id}`}
            checked={ack.checked}
            onCheckedChange={ack.onToggle}
            className="mt-0.5 shrink-0"
            aria-label={t('templateConfig', 'diffAckRowAria').replace(
              '{{change}}',
              sentenceOf(row),
            )}
          />
        )}
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
      {(attributeLabel != null || before != null || after != null) && (
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          {attributeLabel != null && (
            <span className="text-muted-foreground">{attributeLabel}</span>
          )}
          {before != null && (
            <span className="rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem] line-through decoration-muted-foreground/60">
              {before}
            </span>
          )}
          {before != null && after != null && (
            <span aria-hidden className="text-muted-foreground">
              →
            </span>
          )}
          {after != null && (
            <span className="rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem]">
              {after}
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
  isError,
  acked,
  onToggleAck,
}: {
  diff: TemplateConfigDiff | undefined;
  isPending: boolean;
  isError: boolean;
  acked: ReadonlySet<string>;
  onToggleAck: (rowId: string) => void;
}) {
  if (isPending) return <DiffNotice copyKey="diffLoading" />;
  // `isError` is checked ahead of `diff == null`: with `gcTime: 0` a failed
  // refetch already clears `data`, but this is belt and braces against a
  // future cache-lifetime change reintroducing a stale-but-populated `diff`
  // during an in-flight or failed read.
  if (isError || diff == null) return <DiffNotice copyKey="diffLoadFailed" />;
  // One closed discriminator: only `available` carries rows, and the other
  // two each own an explanation.
  if (diff.status !== 'available') {
    return <DiffNotice copyKey={STATUS_NOTICE[diff.status]} />;
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
                  <DiffRow
                    key={row.id}
                    row={row}
                    tier={tier}
                    // Spec §1: additive/cosmetic are pre-approved and
                    // semantic is expand-to-view. Only destructive is
                    // gated, so only destructive gets a checkbox.
                    ack={
                      tier === 'destructive'
                        ? {
                            checked: acked.has(row.id),
                            onToggle: () => onToggleAck(row.id),
                          }
                        : undefined
                    }
                  />
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

const NO_ACKS: ReadonlySet<string> = new Set();

export function TemplateConfigDiffSheet({
  projectId,
  templateId,
  onClose,
}: TemplateConfigDiffSheetProps) {
  const {
    data: diff,
    isPending,
    isError,
    refetch,
  } = useTemplateConfigDiff(projectId, templateId);
  const {republish} = useTemplateRepublish(projectId, templateId);
  const [publishing, setPublishing] = useState(false);
  const [note, setNote] = useState('');
  // The drift phase (B-9b2b). Acknowledgements are stored WITH the
  // fingerprint they were given for, and read back only when it still
  // matches. A recompute — a refetch, a drift refusal, a reviewer
  // recording an answer — therefore clears every tick without an effect
  // and without a stale-state window. Carrying ticks across a recompute is
  // the precise bug this slice exists to prevent: the manager would be
  // confirming a list they never saw.
  const [ackState, setAckState] = useState<{
    fingerprint: string | null;
    ids: ReadonlySet<string>;
  }>({fingerprint: null, ids: NO_ACKS});

  const fingerprint = diff?.fingerprint ?? null;
  const acked = ackState.fingerprint === fingerprint ? ackState.ids : NO_ACKS;

  // Only an `available` diff HAS rows to acknowledge. The other two
  // statuses carry none — and they must still be publishable, or a
  // template with a pre-0026 baseline becomes a dead end: its draft can
  // neither be published (nothing to ack, but nothing to show either) nor
  // discarded (`discard_available` is false for exactly the same reason).
  // The server accepts a null fingerprint there and heals the baseline by
  // republishing from live rows, which is what unsticks the template.
  const gated = diff?.status === 'available';
  const destructive = gated ? (diff.changes?.destructive ?? []) : [];
  const unacknowledged = destructive.filter((row) => !acked.has(row.id)).length;
  const canPublish =
    !publishing &&
    !isPending &&
    !isError &&
    diff != null &&
    (!gated || unacknowledged === 0);

  const toggleAck = (rowId: string) => {
    const next = new Set(acked);
    if (!next.delete(rowId)) next.add(rowId);
    setAckState({fingerprint, ids: next});
  };

  const handlePublish = () => {
    setPublishing(true);
    // Promise .finally, not try/finally — the React Compiler bans the
    // latter in component bodies.
    void republish({
      expected_fingerprint: fingerprint,
      acknowledged: destructive
        .filter((row) => acked.has(row.id))
        .map((row) => ({id: row.id, tier: row.tier})),
      note: note.trim() === '' ? null : note.trim(),
    })
      .then((result) => {
        if (result) {
          toast.success(
            t('extraction', 'configPublishSuccess').replace(
              '{{n}}',
              String(result.version),
            ),
          );
          if (!result.changed && note.trim() !== '') {
            // The no-op branch has no version row for the note to land on.
            // Say so rather than swallowing what they typed.
            toast.info(t('templateConfig', 'publishNoteNotRecorded'));
          }
          onClose();
          return;
        }
        // A refusal already toasted. The projection the server saw differs
        // from the one on screen, so re-read instead of letting the manager
        // re-submit the same stale acknowledgements.
        void refetch();
      })
      .finally(() => setPublishing(false));
  };

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
          <DiffBody
            diff={diff}
            isPending={isPending}
            isError={isError}
            acked={acked}
            onToggleAck={toggleAck}
          />
        </ScrollArea>
        <div className="space-y-3 border-t px-5 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="publish-note" className="text-xs">
              {t('templateConfig', 'publishNoteLabel')}
            </Label>
            <Textarea
              id="publish-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('templateConfig', 'publishNotePlaceholder')}
              className="min-h-[3.5rem] text-sm"
            />
          </div>
          {unacknowledged > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('templateConfig', 'publishAckPending').replace(
                '{{n}}',
                String(unacknowledged),
              )}
            </p>
          )}
          <Button
            className="w-full"
            onClick={handlePublish}
            disabled={!canPublish}
          >
            {t('extraction', 'configPublishButton')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
