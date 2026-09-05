/**
 * Adding one entry to a repeating section from the run form.
 *
 * Lifted out of `ExtractionFullScreen` (which sits at its file-size
 * ceiling) when the bare instance-create call became a dialog. Owns which
 * section the dialog is open for, resolves the parent entry for a nested
 * section (the active model), lists the sibling identities for the chips
 * and the duplicate block, and on confirm calls
 * `POST /api/v1/extraction/instances`, which materializes the identity and
 * the singleton children in one transaction. The key value is then written
 * as this reviewer's value of the key field through the form's own write
 * path. A keyless section gets a plain label — the human path never refuses
 * for want of a key; the server's typed 409 is the backstop for a duplicate
 * this tab's sibling list could not see, and it reaches the reviewer as the
 * dialog's own inline error — `onConfirm` REJECTS on failure, because
 * `AddEntryDialog` clears its loading state only in its catch.
 */
import {useState} from 'react';
import {toast} from 'sonner';

import type {AddEntryDialogProps} from '@/components/extraction/AddEntryDialog';
import {t} from '@/lib/copy';
import {DEFAULT_ENTRY_NOUN, entryKeyOf, keyFieldOf} from '@/lib/extraction/entryKey';
import {extractionLogger} from '@/lib/extraction/observability';
import {ApiError, createEntry} from '@/integrations/api/client';
import type {ExtractionEntityTypeWithFields, ExtractionInstance} from '@/types/extraction';

export interface UseAddEntryArgs {
  projectId: string | undefined;
  articleId: string | undefined;
  templateId: string | undefined;
  entityTypes: ExtractionEntityTypeWithFields[];
  instances: ExtractionInstance[];
  /** Re-derives the instances after a create (the run view refetch). */
  onCreated: () => Promise<unknown>;
  /**
   * Select the entry that was just created, in the slot it was created in.
   *
   * `useModelManagement.createModel` did this implicitly
   * (`setActiveModelId(newModel.instanceId)`), and dropping it was a real
   * regression: the form kept showing the previously-active entry, so the
   * reviewer's next action — rename, extract, fill — landed on the wrong
   * one. Caught by the Spec A e2e, not by any unit test.
   */
  onEntryCreated?: (
    target: {entityTypeId: string; parentInstanceId: string | null},
    instanceId: string,
  ) => void;
}

interface Target {
  entityTypeId: string;
  parentInstanceId: string | null;
}

export interface UseAddEntryReturn {
  /** Open the dialog for a section (the `onAddInstance` handler). */
  open: (entityTypeId: string, parentInstanceId: string | null) => void;
  dialogProps: AddEntryDialogProps;
}

export function useAddEntry(args: UseAddEntryArgs): UseAddEntryReturn {
  const {
    projectId,
    articleId,
    templateId,
    entityTypes,
    instances,
    onCreated,
    onEntryCreated,
  } = args;
  const [target, setTarget] = useState<Target | null>(null);

  const entityType = target ? entityTypes.find((et) => et.id === target.entityTypeId) : undefined;
  const keyField = entityType ? keyFieldOf(entityType.fields) : null;
  const siblings = target
    ? instances.filter(
        (i) =>
          i.entity_type_id === target.entityTypeId &&
          i.parent_instance_id === target.parentInstanceId,
      )
    : [];

  /**
   * The parent is passed in by the enclosing `EntrySection` (its active
   * entry). It used to be inferred here, and the inference was wrong for
   * anything but the single model container: the fallback branch took
   * `instances.find(entity_type_id === parent type)` — the FIRST instance of
   * the parent type — so adding under the second entry created under the
   * first.
   */
  const open = (entityTypeId: string, parentInstanceId: string | null) => {
    const et = entityTypes.find((candidate) => candidate.id === entityTypeId);
    if (!et) {
      extractionLogger.warn('useAddEntry', 'Entity type not found', {entityTypeId});
      return;
    }
    if (et.parent_entity_type_id && !parentInstanceId) {
      toast.error(t('pages', 'extractionScreenParentNotFound'));
      return;
    }
    setTarget({entityTypeId, parentInstanceId});
  };

  const confirm = async (keyValue: string) => {
    if (!target || !entityType || !projectId || !articleId || !templateId) return;
    // The server takes the author from the JWT, materializes the identity and
    // creates the singleton children in one transaction. The endpoint either
    // creates or refuses — there is no "already existed" outcome to branch on.
    const result = await createEntry({
      projectId,
      articleId,
      templateId,
      entityTypeId: entityType.id,
      parentInstanceId: target.parentInstanceId,
      label: keyValue,
      entityKey: keyField ? keyValue : null,
    }).catch((error: unknown) => {
      // Rethrow, never swallow: AddEntryDialog sets `loading` before
      // awaiting this and clears it ONLY in its catch, so a handled-here
      // failure would leave the dialog stuck on "Creating…" with Cancel
      // disabled and onOpenChange refusing to close.
      if (error instanceof ApiError && error.code === 'ENTRY_KEY_DUPLICATE') {
        // The sibling list this tab holds cannot see an entry a peer added
        // since it loaded, so the server's typed 409 is the real backstop.
        throw new Error(t('pages', 'extractionScreenEntryKeyDuplicate'));
      }
      throw error;
    });
    // No local `updateValue` here: the SERVER records the key value as this
    // reviewer's decision inside the create transaction. Writing it again
    // from the form would dirty the field and let autosave POST a second,
    // identical decision — and the reviewer-decision repository is
    // append-only, so that lands as a duplicate audit row for one human
    // action (constitution §IX). The awaited refetch below hydrates the
    // field from the decision the server already wrote.
    extractionLogger.info('useAddEntry', 'Entry created', {instanceId: result.instanceId});
    onEntryCreated?.(target, result.instanceId);
    setTarget(null);
    await onCreated();
    toast.success(`${result.label} ${t('pages', 'extractionScreenInstanceAddedSuccess')}`);
  };

  return {
    open,
    dialogProps: {
      open: target !== null,
      entryLabel: entityType?.entry_label ?? DEFAULT_ENTRY_NOUN,
      keyLabel: keyField?.label ?? null,
      existingKeys: siblings.map((i) => entryKeyOf(i) ?? i.label),
      onConfirm: confirm,
      onCancel: () => setTarget(null),
    },
  };
}
