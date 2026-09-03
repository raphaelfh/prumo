/**
 * Adding one entry to a repeating section from the run form.
 *
 * Lifted out of `ExtractionFullScreen` (which sits at its file-size
 * ceiling) when the bare `createInstance` call became a dialog. Owns which
 * section the dialog is open for, resolves the parent entry for a nested
 * section (the active model), lists the sibling identities for the chips
 * and the duplicate block, and on confirm creates the instance with the
 * identity materialized (`metadata.entity_key`, identity spec §5.1.1) and
 * records the key value as this reviewer's value of the key field through
 * the form's own write path. A keyless section gets a plain label and no
 * stamp — the human path never refuses.
 */
import {useState} from 'react';
import {toast} from 'sonner';

import type {AddEntryDialogProps} from '@/components/extraction/AddEntryDialog';
import {t} from '@/lib/copy';
import {entryKeyOf, keyFieldOf, normalizeEntryKey} from '@/lib/extraction/entryKey';
import {extractionLogger} from '@/lib/extraction/observability';
import {getRequiredUserId} from '@/services/authService';
import {extractionInstanceService} from '@/services/extractionInstanceService';
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
    const userResult = await getRequiredUserId();
    if (!userResult.ok) {
      toast.error(t('common', 'errors_userNotAuthenticated'));
      return;
    }
    const result = await extractionInstanceService.createInstance({
      projectId,
      articleId,
      templateId,
      entityTypeId: entityType.id,
      entityType,
      parentInstanceId: target.parentInstanceId,
      label: keyValue,
      metadata: keyField
        ? {entity_key: normalizeEntryKey(keyValue), created_via: 'run_form'}
        : {created_via: 'run_form'},
      userId: userResult.data,
    });
    if (result.wasCreated && keyField) {
      // The key value IS the reviewer's answer to the key field.
      updateValue(result.instance.id, keyField.id, keyValue);
    }
    extractionLogger.info('useAddEntry', 'Instance created', {
      instanceId: result.instance.id,
      wasCreated: result.wasCreated,
    });
    setTarget(null);
    await onCreated();
    toast.success(
      result.wasCreated
        ? `${result.instance.label} ${t('pages', 'extractionScreenInstanceAddedSuccess')}`
        : t('pages', 'extractionScreenInstanceAlreadyExists'),
    );
  };

  return {
    open,
    dialogProps: {
      open: target !== null,
      entryLabel: entityType?.entry_label ?? 'entry',
      keyLabel: keyField?.label ?? null,
      existingKeys: siblings.map((i) => entryKeyOf(i) ?? i.label),
      onConfirm: confirm,
      onCancel: () => setTarget(null),
    },
  };
}
