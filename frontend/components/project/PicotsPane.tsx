/**
 * The single editor for the project's AI review question (PICOTS).
 *
 * One write path. The six slots used to be edited inside `ProjectSettings`'
 * batched PostgREST draft, which had two problems this replaces: the draft
 * PATCHed every settings column on save (so a stale client snapshot could
 * overwrite a migrated row), and an RLS-filtered write returns no error, so a
 * non-manager saw a success toast and silently lost the edit. Here the write
 * is a manager-gated typed PUT whose response is the server's own re-read.
 *
 * Slot LABELS come from that response, not from `lib/copy`: they vary by review
 * type and use the instrument's own wording ("Index model(s)" for a
 * predictive-model review), and they are the exact strings the prompt emits. A
 * second copy in the frontend could drift from what the model is told.
 *
 * It is mounted inline by ReviewQuestionSection (Project → Configuration →
 * Review question). The form owns its draft; the host only hears whether it
 * is dirty.
 */

import {useState} from 'react';
import {ChevronRight} from 'lucide-react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {Switch} from '@/components/ui/switch';
import {Skeleton} from '@/components/ui/skeleton';
import {SettingsGroup, SettingsRow} from '@/components/settings';
import {t} from '@/lib/copy';
import {useAiContext, useSetAiContext} from '@/hooks/project/useAiContext';
import type {
  PicotsSlot,
  PicotsSlots,
  ProjectAiContextRead,
} from '@/services/aiContextService';
import {PICOTSItemEditor} from './settings/PICOTSItemEditor';

/** Storage order = the instrument's P-I-C-O-T-S order = the prompt's order. */
const SLOT_KEYS = [
  'population',
  'index_models',
  'comparator_models',
  'outcomes',
  'timing',
  'setting_and_intended_use',
] as const;

const EMPTY_SLOT: PicotsSlot = {description: '', inclusion: [], exclusion: []};

interface PicotsFormProps {
  initial: ProjectAiContextRead;
  pending: boolean;
  onSave: (body: {picots: PicotsSlots; picots_enabled: boolean}) => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

/**
 * The form, mounted only once the read has arrived.
 *
 * State is initialized FROM PROPS on mount rather than synced in an effect:
 * seeding via `useEffect` triggers a cascading render and is the pattern
 * `react-hooks/set-state-in-effect` rejects. The host re-seeds the form by
 * bumping a `key` (see `PicotsPane`), never by an effect here.
 */
function PicotsForm({initial, pending, onSave, onCancel, onDirtyChange}: PicotsFormProps) {
  const [draft, setDraft] = useState<PicotsSlots>(() => initial.picots);
  const [enabled, setEnabled] = useState(() => initial.picots_enabled ?? true);
  const baseline = JSON.stringify([initial.picots, initial.picots_enabled ?? true]);
  const dirty = JSON.stringify([draft, enabled]) !== baseline;

  const commit = (nextDraft: PicotsSlots, nextEnabled: boolean) => {
    setDraft(nextDraft);
    setEnabled(nextEnabled);
    onDirtyChange(JSON.stringify([nextDraft, nextEnabled]) !== baseline);
  };

  const slots = draft as unknown as Record<string, PicotsSlot>;

  const writeSlot = (key: string, next: PicotsSlot) =>
    commit(
      {...(slots as Record<string, PicotsSlot>), [key]: next} as unknown as PicotsSlots,
      enabled,
    );

  const updateField = (key: string, subField: string, value: unknown) =>
    writeSlot(key, {...(slots[key] ?? EMPTY_SLOT), [subField]: value} as PicotsSlot);

  // Reads the CURRENT slot by its own key. The predecessor looked up a dotted
  // path that never existed on the object, so every add replaced the list with
  // one entry and every remove cleared it.
  const addItem = (
    key: string,
    arrayField: 'inclusion' | 'exclusion',
    value: string,
  ) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const slot = slots[key] ?? EMPTY_SLOT;
    writeSlot(key, {
      ...slot,
      [arrayField]: [...(slot[arrayField] ?? []), trimmed],
    });
  };

  const removeItem = (
    key: string,
    arrayField: 'inclusion' | 'exclusion',
    index: number,
  ) => {
    const slot = slots[key] ?? EMPTY_SLOT;
    writeSlot(key, {
      ...slot,
      [arrayField]: (slot[arrayField] ?? []).filter((_, i) => i !== index),
    });
  };

  return (
    <>
      <SettingsGroup>
        <SettingsRow
          label={t('aiContext', 'enabledLabel')}
          htmlFor="picots-enabled"
          hint={t('aiContext', 'enabledHint')}
        >
          {({describedBy}) => (
            <Switch
              id="picots-enabled"
              checked={enabled}
              onCheckedChange={(value) => commit(draft, value)}
              aria-describedby={describedBy}
            />
          )}
        </SettingsRow>

        {/* The prompt preview is the ground truth of this whole section — what
            the model actually receives — so it sits at the TOP, where it is
            discoverable, and collapsed, so it costs nothing until asked for. */}
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="group w-full justify-start gap-1.5 px-2 font-normal text-muted-foreground hover:text-foreground"
            >
              {/* Radix puts data-state on the TRIGGER, which is this button —
                  so the group is the button, not a wrapper. */}
              <ChevronRight
                className="shrink-0 transition-transform group-data-[state=open]:rotate-90"
                strokeWidth={1.5}
                aria-hidden
              />
              {t('aiContext', 'previewTitle')}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="mt-1 px-2 text-xs text-muted-foreground">{t('aiContext', 'previewHint')}</p>
            <pre className="mt-1.5 max-h-40 overflow-auto rounded-md bg-muted/40 p-2.5 text-xs whitespace-pre-wrap">
              {initial.preview ?? t('aiContext', 'previewEmpty')}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </SettingsGroup>

      <SettingsGroup>
        {SLOT_KEYS.map((key) => (
          <PICOTSItemEditor
            key={key}
            label={initial.labels?.[key] ?? key}
            fieldKey={key}
            data={slots[key] ?? EMPTY_SLOT}
            hint={key === 'timing' ? t('aiContext', 'timingHint') : undefined}
            descriptionPlaceholder=""
            showCriteria={key === 'population'}
            onUpdate={updateField}
            onAddItem={addItem}
            onRemoveItem={removeItem}
          />
        ))}

        {dirty && (
          <div className="sticky bottom-0 flex justify-end gap-1.5 border-t border-border/40 bg-background py-2">
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
              {t('aiContext', 'cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => onSave({picots: draft, picots_enabled: enabled})}
              disabled={pending}
            >
              {pending ? t('aiContext', 'saving') : t('aiContext', 'save')}
            </Button>
          </div>
        )}
      </SettingsGroup>
    </>
  );
}

interface PicotsPaneProps {
  projectId: string;
  onDirtyChange?: (dirty: boolean) => void;
}

export function PicotsPane({projectId, onDirtyChange}: PicotsPaneProps) {
  const {data, isError} = useAiContext(projectId);
  const mutation = useSetAiContext(projectId);
  // Bumped on Cancel and after a save: the form is keyed by it, so it
  // re-seeds from the latest read without an effect.
  const [formSeq, setFormSeq] = useState(0);
  const reportDirty = (dirty: boolean) => onDirtyChange?.(dirty);

  const reset = () => {
    setFormSeq((n) => n + 1);
    reportDirty(false);
  };

  const save = (body: {picots: PicotsSlots; picots_enabled: boolean}) => {
    mutation.mutate(body, {
      onSuccess: () => {
        toast.success(t('aiContext', 'saveSuccess'));
        reset();
      },
      onError: () => toast.error(t('aiContext', 'saveError')),
    });
  };

  if (isError) {
    // Save stays unreachable: with no read there is no draft, and an empty
    // one would overwrite the stored review question with blanks.
    return (
      <SettingsGroup>
        <p className="text-[13px] text-destructive">{t('aiContext', 'loadError')}</p>
      </SettingsGroup>
    );
  }
  if (!data) {
    return (
      <SettingsGroup>
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </SettingsGroup>
    );
  }
  return (
    <PicotsForm
      key={formSeq}
      initial={data}
      pending={mutation.isPending}
      onSave={save}
      onCancel={reset}
      onDirtyChange={reportDirty}
    />
  );
}

/** What a non-manager sees: the server-rendered prompt text, verbatim. */
export function PicotsPreview({projectId}: {projectId: string}) {
  const {data, isError} = useAiContext(projectId);
  if (isError) {
    return <p className="text-[13px] text-destructive">{t('aiContext', 'loadError')}</p>;
  }
  if (!data) {
    return <Skeleton className="h-8 w-full" />;
  }
  return (
    <pre className="max-h-80 overflow-auto rounded-md bg-muted/40 p-2.5 text-xs whitespace-pre-wrap">
      {data.preview ?? t('aiContext', 'previewEmpty')}
    </pre>
  );
}
