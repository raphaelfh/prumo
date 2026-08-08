import {useEffect, useState} from 'react';

import {useFieldManagement} from '@/hooks/extraction/useFieldManagement';
import {t} from '@/lib/copy';

import {AddFieldDialog} from '../dialogs/AddFieldDialog';
import {DeleteFieldConfirm} from '../dialogs/DeleteFieldConfirm';
import {EditFieldDialog} from '../dialogs/EditFieldDialog';
import type {ExtractionField, FieldValidationResult} from '@/types/extraction';

/**
 * Editing bridge for the B-1 grid shell.
 *
 * The grid renders but does not edit yet, so field edits still travel the
 * dialogs that shipped before this slice — reached in one click from a row
 * instead of five through the accordion. This component is mounted ONLY
 * while a dialog is open, so `useFieldManagement` (which fetches the
 * section's fields and owns the cache refresh) never runs idle.
 *
 * Deleted by B-5, when a committed cell stops minting a template version
 * and the grid becomes the editor. The impact pre-fetch below is the third
 * copy of that flow (FieldsManager and FieldsManagerWithDragDrop hold the
 * others, both now orphaned) — consolidate it into `DeleteFieldConfirm` via
 * an `onValidate` prop, the shape `EditFieldDialog` already uses, when B-5
 * deletes those two.
 */
interface TemplateFieldDialogsProps {
  mode: 'add' | 'edit' | 'delete';
  entityTypeId: string;
  sectionName: string;
  projectId: string;
  templateId: string;
  field: ExtractionField | null;
  onClose: () => void;
}

export function TemplateFieldDialogs({
  mode,
  entityTypeId,
  sectionName,
  projectId,
  templateId,
  field,
  onClose,
}: TemplateFieldDialogsProps) {
  const {
    addField,
    updateField,
    deleteField,
    validateField,
    createOtherSpecifyField,
    removeOtherSpecifyField,
  } = useFieldManagement({entityTypeId, projectId, templateId});

  // Delete runs the same pre-flight impact check the accordion did — a field
  // carrying reviewer decisions is protected by RESTRICT foreign keys, so the
  // user must see the impact BEFORE the database refuses the delete.
  const [validation, setValidation] = useState<FieldValidationResult | null>(null);
  const [validating, setValidating] = useState(true);
  const deletingFieldId = mode === 'delete' ? (field?.id ?? null) : null;

  useEffect(() => {
    if (!deletingFieldId) return;
    let cancelled = false;
    // Microtask so the state writes land in an async callback — the pattern
    // the sibling loaders use (react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      if (cancelled) return;
      setValidating(true);
      void validateField(deletingFieldId).then((result) => {
        if (cancelled) return;
        setValidation(
          result ?? {
            canDelete: false,
            canUpdate: false,
            canChangeType: false,
            extractedValuesCount: 0,
            affectedArticles: [],
            message: t('extraction', 'errors_validateField'),
          },
        );
        setValidating(false);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [deletingFieldId, validateField]);

  const handleOpenChange = (open: boolean) => {
    if (!open) onClose();
  };

  if (mode === 'add') {
    return (
      <AddFieldDialog
        open
        onOpenChange={handleOpenChange}
        onSave={addField}
        sectionName={sectionName}
        entityTypeId={entityTypeId}
        createOtherSpecifyField={createOtherSpecifyField}
        removeOtherSpecifyField={removeOtherSpecifyField}
      />
    );
  }

  if (mode === 'delete') {
    return (
      <DeleteFieldConfirm
        field={field}
        open
        onOpenChange={handleOpenChange}
        onConfirm={deleteField}
        validation={validation}
        loading={validating}
      />
    );
  }

  return (
    <EditFieldDialog
      field={field}
      open
      onOpenChange={handleOpenChange}
      onSave={updateField}
      onValidate={validateField}
      sectionName={sectionName}
    />
  );
}
