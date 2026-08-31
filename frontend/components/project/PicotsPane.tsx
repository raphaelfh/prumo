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
 * This is a PANE, not a dialog: `AiConfigDialog` mounts it — alone from the
 * project settings summary, or as the "Review question" tab next to the
 * template's general AI instruction on the config surfaces.
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
import {Label} from '@/components/ui/label';
import {Separator} from '@/components/ui/separator';
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
}

/**
 * The form, mounted only once the read has arrived.
 *
 * State is initialized FROM PROPS on mount rather than synced in an effect:
 * seeding via `useEffect` triggers a cascading render and is the pattern
 * `react-hooks/set-state-in-effect` rejects. Radix unmounts dialog content when
 * closed, so this also resets on close — a cancelled edit cannot leak into the
 * next one without any explicit teardown.
 */
function PicotsForm({initial, pending, onSave, onCancel}: PicotsFormProps) {
  const [draft, setDraft] = useState<PicotsSlots>(() => initial.picots);
  const [enabled, setEnabled] = useState(() => initial.picots_enabled ?? true);

  const slots = draft as unknown as Record<string, PicotsSlot>;

  const writeSlot = (key: string, next: PicotsSlot) =>
    setDraft(
      (prev) =>
        ({...(prev as unknown as Record<string, PicotsSlot>), [key]: next}) as
          unknown as PicotsSlots,
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
    // Fills the host's fixed panel: the slots scroll in the middle region
    // while the Save/Cancel footer keeps a fixed row on the panel's bottom
    // edge — a six-slot form must never hide its only save button behind a
    // full scroll.
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="picots-enabled" className="text-[13px] font-medium">
            {t('aiContext', 'enabledLabel')}
          </Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('aiContext', 'enabledHint')}
          </p>
        </div>
        <Switch
          id="picots-enabled"
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </div>

      {/* The prompt preview is the ground truth of this whole tab — what the
          model actually receives — so it sits at the TOP, where it is
          discoverable, and collapsed, so it costs nothing until asked for.
          Below six slots it was findable only by scrolling past everything. */}
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
          <p className="mt-1 px-2 text-xs text-muted-foreground">
            {t('aiContext', 'previewHint')}
          </p>
          <pre className="mt-1.5 max-h-40 overflow-auto rounded-md border border-border/50 bg-muted/40 p-2.5 text-xs whitespace-pre-wrap">
            {initial.preview ?? t('aiContext', 'previewEmpty')}
          </pre>
        </CollapsibleContent>
      </Collapsible>

      <Separator />

      <div className="space-y-4">
        {SLOT_KEYS.map((key) => (
          <PICOTSItemEditor
            key={key}
            label={initial.labels?.[key] ?? key}
            fieldKey={key}
            data={slots[key] ?? EMPTY_SLOT}
            infoTooltip={key === 'timing' ? t('aiContext', 'timingHint') : ''}
            descriptionPlaceholder=""
            showCriteria={key === 'population'}
            onUpdate={updateField}
            onAddItem={addItem}
            onRemoveItem={removeItem}
          />
        ))}
      </div>

      </div>

      <div className="flex shrink-0 justify-end gap-1.5 border-t border-border/40 px-4 py-2">
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          {t('aiContext', 'cancel')}
        </Button>
        <Button
          onClick={() => onSave({picots: draft, picots_enabled: enabled})}
          disabled={pending}
        >
          {pending ? t('aiContext', 'saving') : t('aiContext', 'save')}
        </Button>
      </div>
    </div>
  );
}

interface PicotsPaneProps {
  projectId: string;
  /** Called after a successful save and on Cancel — the host closes itself. */
  onClose: () => void;
}

export function PicotsPane({projectId, onClose}: PicotsPaneProps) {
  const {data, isError} = useAiContext(projectId);
  const mutation = useSetAiContext(projectId);

  const save = (body: {picots: PicotsSlots; picots_enabled: boolean}) => {
    mutation.mutate(body, {
      onSuccess: () => {
        toast.success(t('aiContext', 'saveSuccess'));
        onClose();
      },
      onError: () => toast.error(t('aiContext', 'saveError')),
    });
  };

  if (isError) {
    // Save stays unreachable: with no read there is no draft, and an empty
    // one would overwrite the stored review question with blanks.
    return (
      <p className="px-5 text-[13px] text-destructive">
        {t('aiContext', 'loadError')}
      </p>
    );
  }
  if (!data) {
    return (
      <p className="px-5 text-[13px] text-muted-foreground">
        {t('aiContext', 'saving')}
      </p>
    );
  }
  return (
    <PicotsForm
      initial={data}
      pending={mutation.isPending}
      onSave={save}
      onCancel={onClose}
    />
  );
}
