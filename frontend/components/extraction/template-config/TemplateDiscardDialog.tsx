/**
 * The Discard-draft dialog (slice B-9c2, D4/D5/D9/D10/D11).
 *
 * Four phases behind one AlertDialog:
 *   confirm  → what will be undone, and that it cannot be undone back
 *   ack      → ORPHAN_ACK_REQUIRED: the fields whose recorded answers the
 *              discard would strand, re-posted with the acknowledgement
 *   refused  → a hard refusal, rendered from LOCAL copy keyed on the code
 *   result   → the discard ran but kept some nodes; the template is STILL
 *              a draft, which the pane has to say out loud
 *
 * The host mounts this per open (`{discardOpen && <TemplateDiscardDialog/>}`),
 * so every piece of state below — the phase and every server payload — dies
 * with the dialog. Without that, the next open would land on the stale
 * result pane.
 *
 * @component
 */
import {useState} from 'react';
import {AlertTriangle, Loader2} from 'lucide-react';
import {toast} from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {Badge} from '@/components/ui/badge';
import {useTemplateConfigCaches} from '@/hooks/extraction/useTemplateRepublish';
import {t} from '@/lib/copy';
import type {templateConfig} from '@/lib/copy';
import {
  discardTemplateDraft,
  TemplateDiscardRefusal,
  type DiscardDraftResponse,
  type TemplateDiscardOrphan,
} from '@/services/templateService';

type CopyKey = keyof typeof templateConfig;
type DiscardKeptNode = DiscardDraftResponse['kept'][number];
type Phase = 'confirm' | 'ack' | 'refused' | 'result';

/**
 * D9 — exhaustive at compile time, defensive at runtime.
 *
 * `satisfies` over the generated union means regenerating `schema.d.ts`
 * with a new reason breaks the BUILD instead of shipping a blank
 * explanation; the `??` below covers the other direction (a server ahead
 * of this bundle), because `t()` answers a missing key with ''.
 */
const KEPT_REASON = {
  has_recorded_data: 'discardKeptReasonHasRecordedData',
  name_taken_by_kept_node: 'discardKeptReasonNameTakenByKeptNode',
  related_to_kept_node: 'discardKeptReasonRelatedToKeptNode',
} satisfies Record<DiscardKeptNode['reason'], CopyKey>;

const KEPT_KIND = {
  entity_type: 'discardKeptKindSection',
  field: 'discardKeptKindField',
} satisfies Record<DiscardKeptNode['node_kind'], CopyKey>;

/**
 * D5 — every HARD refusal gets a local copy key. `ORPHAN_ACK_REQUIRED` is
 * absent on purpose: it is a question, not a refusal, and owns its own
 * pane. A code outside this map (older bundle, newer server) is NOT
 * rendered as a policy decision — it falls to the generic outcome.
 */
const REFUSAL_COPY = {
  CARDINALITY_DOWNGRADE_BLOCKED: 'discardRefusedCardinality',
  CONTAINER_SWAP_UNSUPPORTED: 'discardRefusedContainerSwap',
  DISCARD_RACED: 'discardRefusedRaced',
  NARROW_BASELINE: 'discardRefusedNarrowBaseline',
} satisfies Record<
  Exclude<TemplateDiscardRefusal['code'], 'ORPHAN_ACK_REQUIRED'>,
  CopyKey
>;

interface TemplateDiscardDialogProps {
  projectId: string;
  templateId: string;
  /** The version the draft rewinds to; null only in shapes the enabled
   * predicate already rules out (`discard_available` implies a version). */
  activeVersion: number | null;
  /** POSITIVE server-computed count, or null — the same gate the Draft
   * chip applies, so the two can never disagree. */
  draftChangeCount: number | null;
  /** D10: the confirm pane warns about the AI instruction only when there
   * IS one. Warning of a loss that will not happen is exactly what this
   * pane exists to avoid. */
  instructionPresent: boolean;
  onClose: () => void;
}

export function TemplateDiscardDialog({
  projectId,
  templateId,
  activeVersion,
  draftChangeCount,
  instructionPresent,
  onClose,
}: TemplateDiscardDialogProps) {
  const {invalidateAfterDiscard} = useTemplateConfigCaches(projectId, templateId);
  const [phase, setPhase] = useState<Phase>('confirm');
  const [submitting, setSubmitting] = useState(false);
  const [orphans, setOrphans] = useState<readonly TemplateDiscardOrphan[]>([]);
  const [refusalKey, setRefusalKey] = useState<CopyKey | null>(null);
  const [kept, setKept] = useState<readonly DiscardKeptNode[]>([]);
  /** The D5 fifth outcome. Never a phase: it leaves the current pane in
   * place so the user keeps the context they were acting on. */
  const [genericFailure, setGenericFailure] = useState(false);

  const runDiscard = async (acknowledgeOrphans: boolean): Promise<void> => {
    setGenericFailure(false);
    const result = await discardTemplateDraft(projectId, templateId, {
      acknowledgeOrphans,
    });

    if (!result.ok) {
      // The server prose is diagnostics, never the contract (D5).
      console.error('[TemplateDiscardDialog] discard failed:', result.error);
      if (result.error instanceof TemplateDiscardRefusal) {
        if (result.error.code === 'ORPHAN_ACK_REQUIRED') {
          setOrphans(result.error.orphans);
          setPhase('ack');
          return;
        }
        const known = REFUSAL_COPY[result.error.code];
        if (known) {
          setRefusalKey(known);
          setPhase('refused');
          return;
        }
      }
      setGenericFailure(true);
      return;
    }

    await invalidateAfterDiscard();
    if (result.data.kept.length === 0) {
      toast.success(t('templateConfig', 'discardSuccessToast'));
      onClose();
      return;
    }
    setKept(result.data.kept);
    setPhase('result');
  };

  const submit = (acknowledgeOrphans: boolean) => {
    setSubmitting(true);
    // Promise .finally, not try/finally — the latter is banned in component
    // bodies by the React Compiler gate.
    void runDiscard(acknowledgeOrphans).finally(() => setSubmitting(false));
  };

  const confirmBody =
    draftChangeCount == null || activeVersion == null
      ? t('templateConfig', 'discardConfirmBodyPlain')
      : (draftChangeCount === 1
          ? t('templateConfig', 'discardConfirmBodyOne')
          : t('templateConfig', 'discardConfirmBodyOther')
        )
          .replace('{{n}}', String(draftChangeCount))
          .replace('{{v}}', String(activeVersion));

  const title =
    phase === 'ack'
      ? t('templateConfig', 'discardAckTitle')
      : phase === 'refused'
        ? t('templateConfig', 'discardRefusedTitle')
        : phase === 'result'
          ? t('templateConfig', 'discardResultTitle')
          : t('templateConfig', 'discardConfirmTitle');

  const genericNotice = genericFailure ? (
    <p role="alert" className="text-sm text-destructive">
      {t('templateConfig', 'discardFailedGeneric')}
    </p>
  ) : null;

  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" aria-hidden />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 pt-2 text-sm">
              {phase === 'confirm' && (
                <>
                  <p className="text-foreground">{confirmBody}</p>
                  <p>{t('templateConfig', 'discardConfirmScope')}</p>
                  {instructionPresent && (
                    <p>{t('templateConfig', 'discardConfirmInstruction')}</p>
                  )}
                  {genericNotice}
                </>
              )}

              {phase === 'ack' && (
                <>
                  <p className="text-foreground">
                    {t('templateConfig', 'discardAckBody')}
                  </p>
                  <ul className="list-inside list-disc space-y-1 rounded-md bg-muted p-3">
                    {orphans.map((orphan) => (
                      <li key={orphan.nodeId ?? orphan.label}>{orphan.label}</li>
                    ))}
                  </ul>
                  {genericNotice}
                </>
              )}

              {phase === 'refused' && refusalKey != null && (
                <p className="text-foreground">{t('templateConfig', refusalKey)}</p>
              )}

              {phase === 'result' && (
                <>
                  <p className="text-foreground">
                    {t('templateConfig', 'discardResultStillDraft')}
                  </p>
                  <ul className="space-y-2 rounded-md bg-muted p-3">
                    {kept.map((node) => (
                      <li key={node.node_id} className="flex items-start gap-2">
                        <Badge variant="outline" className="shrink-0 text-xs">
                          {t('templateConfig', KEPT_KIND[node.node_kind])}
                        </Badge>
                        <span>
                          <span className="font-medium text-foreground">
                            {node.label}
                          </span>
                          {' — '}
                          {t(
                            'templateConfig',
                            KEPT_REASON[node.reason] ?? 'discardKeptReasonOther',
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>
            {/* A terminal pane has nothing left to cancel. */}
            {phase === 'refused' || phase === 'result'
              ? t('common', 'close')
              : t('common', 'cancel')}
          </AlertDialogCancel>
          {(phase === 'confirm' || phase === 'ack') && (
            <AlertDialogAction
              // preventDefault stops Radix's auto-close: a refusal or a
              // kept-node result switches PANE, it does not remount.
              onClick={(event) => {
                event.preventDefault();
                submit(phase === 'ack');
              }}
              disabled={submitting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {phase === 'ack'
                ? t('templateConfig', 'discardAckAction')
                : t('templateConfig', 'discardConfirmAction')}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
