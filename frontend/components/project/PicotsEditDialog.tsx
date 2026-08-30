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
 */

import {useState} from 'react';
import {toast} from 'sonner';

import {AppDialog} from '@/components/patterns/AppDialog';
import {Button} from '@/components/ui/button';
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
    <div className="space-y-5">
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

      <Separator />

      <div className="space-y-6">
        {SLOT_KEYS.map((key) => (
          <PICOTSItemEditor
            key={key}
            label={initial.labels?.[key] ?? key}
            fieldKey={key}
            data={slots[key] ?? EMPTY_SLOT}
            infoTooltip={key === 'timing' ? t('aiContext', 'timingHint') : ''}
            descriptionPlaceholder=""
            onUpdate={updateField}
            onAddItem={addItem}
            onRemoveItem={removeItem}
          />
        ))}
      </div>

      <Separator />

      <div>
        <p className="text-[13px] font-medium">
          {t('aiContext', 'previewTitle')}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('aiContext', 'previewHint')}
        </p>
        <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-border/50 bg-muted/40 p-3 text-xs whitespace-pre-wrap">
          {initial.preview ?? t('aiContext', 'previewEmpty')}
        </pre>
      </div>

      <div className="flex justify-end gap-2 pt-2">
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

interface PicotsEditDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PicotsEditDialog({
  projectId,
  open,
  onOpenChange,
}: PicotsEditDialogProps) {
  const {data, isError} = useAiContext(open ? projectId : null);
  const mutation = useSetAiContext(projectId);

  const save = (body: {picots: PicotsSlots; picots_enabled: boolean}) => {
    mutation.mutate(body, {
      onSuccess: () => {
        toast.success(t('aiContext', 'saveSuccess'));
        onOpenChange(false);
      },
      onError: () => toast.error(t('aiContext', 'saveError')),
    });
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('aiContext', 'dialogTitle')}
      description={t('aiContext', 'dialogDesc')}
      size="2xl"
      showFooter={false}
    >
      {isError ? (
        // Save stays disabled above: with no read there is no draft, and an
        // empty one would overwrite the stored review question with blanks.
        <p className="text-[13px] text-destructive">
          {t('aiContext', 'loadError')}
        </p>
      ) : data ? (
        <PicotsForm
          initial={data}
          pending={mutation.isPending}
          onSave={save}
          onCancel={() => onOpenChange(false)}
        />
      ) : (
        <p className="text-[13px] text-muted-foreground">
          {t('aiContext', 'saving')}
        </p>
      )}
    </AppDialog>
  );
}
