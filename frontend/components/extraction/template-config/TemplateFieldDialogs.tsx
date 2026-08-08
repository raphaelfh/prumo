import {useFieldManagement} from '@/hooks/extraction/useFieldManagement';

import {AddFieldDialog} from '../dialogs/AddFieldDialog';
import {EditFieldDialog} from '../dialogs/EditFieldDialog';
import type {ExtractionField} from '@/types/extraction';

/**
 * Editing bridge for the B-1 grid shell.
 *
 * The grid renders but does not edit yet, so field edits still travel the
 * dialogs that shipped before this slice — reached in one click from a row
 * instead of five through the accordion. This component is mounted ONLY
 * while a dialog is open, so `useFieldManagement` (which fetches the
 * section's fields and owns the cache refresh) never runs idle.
 *
 * Deleted by B-5 Task 8, when the grid becomes the editor. Delete already
 * left (Task 7): `TemplateConfigEditor` hosts `DeleteFieldConfirm`
 * directly, with the impact pre-fetch folded into the dialog via its
 * `onValidate` prop and a dedicated delete mutation.
 */
interface TemplateFieldDialogsProps {
  mode: 'add' | 'edit';
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
    validateField,
    createOtherSpecifyField,
    removeOtherSpecifyField,
  } = useFieldManagement({entityTypeId, projectId, templateId});

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
