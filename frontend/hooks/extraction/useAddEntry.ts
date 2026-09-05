/**
 * Adding one entry to a repeating section from the run form.
 *
 * Lifted out of `ExtractionFullScreen` (which sits at its file-size
 * ceiling) when the bare `createInstance` call became a dialog. Owns which
 * section the dialog is open for, resolves the parent entry for a nested
 * section (the active model), lists the sibling identities for the chips
 * and the duplicate block, and on confirm calls
 * `POST /api/v1/extraction/instances`, which materializes the identity and
 * the singleton children in one transaction. The key value is then written
 * as this reviewer's value of the key field through the form's own write
 * path. A keyless section gets a plain label — the human path never refuses
 * for want of a key; the server's typed 409 is the backstop for a duplicate
 * this tab's sibling list could not see.
 */
import {useState} from 'react';
import {toast} from 'sonner';

import type {AddEntryDialogProps} from '@/components/extraction/AddEntryDialog';
import {t} from '@/lib/copy';
import {DEFAULT_ENTRY_NOUN, entryKeyOf, keyFieldOf} from '@/lib/extraction/entryKey';
import {extractionLogger} from '@/lib/extraction/observability';
import {ApiError, createEntry} from '@/integrations/api/client';
import {toResult} from '@/lib/error-utils';
import type {
  ExtractionEntityTypeWithFields,
  ExtractionInstance,
  ExtractionValue,
} from '@/types/extraction';

export interface UseAddEntryArgs {
  projectId: string | undefined;
  articleId: string | undefined;
  templateId: string | undefined;
  entityTypes: ExtractionEntityTypeWithFields[];
  instances: ExtractionInstance[];
  /** The model container's id, so a per-model section resolves its parent to the active model. */
  modelParentEntityTypeId: string | null;
  activeModelId: string | null;
  /** The form's own value write (autosave) — records the key value for the reviewer. */
  updateValue: (instanceId: string, fieldId: string, value: ExtractionValue) => void;
  /** Re-derives the instances after a create (the run view refetch). */
  onCreated: () => Promise<unknown>;
}

interface Target {
  entityTypeId: string;
  parentInstanceId: string | null;
}

export interface UseAddEntryReturn {
  /** Open the dialog for a section (the `onAddInstance` handler). */
  open: (entityTypeId: string) => void;
  dialogProps: AddEntryDialogProps;
}

export function useAddEntry(args: UseAddEntryArgs): UseAddEntryReturn {
  const {
    projectId,
    articleId,
    templateId,
    entityTypes,
    instances,
    modelParentEntityTypeId,
    activeModelId,
    updateValue,
    onCreated,
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

  const open = (entityTypeId: string) => {
    const et = entityTypes.find((candidate) => candidate.id === entityTypeId);
    if (!et) {
      extractionLogger.warn('useAddEntry', 'Entity type not found', {entityTypeId});
      return;
    }
    let parentInstanceId: string | null = null;
    if (et.parent_entity_type_id) {
      if (et.parent_entity_type_id === modelParentEntityTypeId) {
        // A per-model section repeats under the active model.
        if (!activeModelId) {
          toast.error(t('pages', 'extractionScreenSelectModelFirst'));
          return;
        }
        parentInstanceId = activeModelId;
      } else {
        const parent = instances.find((i) => i.entity_type_id === et.parent_entity_type_id);
        if (!parent) {
          toast.error(t('pages', 'extractionScreenParentNotFound'));
          return;
        }
        parentInstanceId = parent.id;
      }
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
    });
    if (keyField) {
      // The key value IS the reviewer's answer to the key field.
      updateValue(result.instanceId, keyField.id, keyValue);
    }
    extractionLogger.info('useAddEntry', 'Entry created', {instanceId: result.instanceId});
    setTarget(null);
    await onCreated();
    toast.success(`${result.label} ${t('pages', 'extractionScreenInstanceAddedSuccess')}`);
  };

  const confirmOrReport = async (keyValue: string) => {
    const outcome = await toResult(() => confirm(keyValue), 'useAddEntry.confirm');
    if (outcome.ok) return;
    const error = outcome.error;
    // The server is the backstop for a duplicate the dialog's own list could
    // not see (a peer added the same entry since this tab loaded).
    if (error instanceof ApiError && error.code === 'ENTRY_KEY_DUPLICATE') {
      toast.error(t('pages', 'extractionScreenEntryKeyDuplicate'));
      return;
    }
    toast.error(error instanceof Error ? error.message : t('common', 'errors_serverError'));
  };

  return {
    open,
    dialogProps: {
      open: target !== null,
      entryLabel: entityType?.entry_label ?? DEFAULT_ENTRY_NOUN,
      keyLabel: keyField?.label ?? null,
      existingKeys: siblings.map((i) => entryKeyOf(i) ?? i.label),
      onConfirm: confirmOrReport,
      onCancel: () => setTarget(null),
    },
  };
}
