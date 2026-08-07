import {Pencil, Sparkles} from 'lucide-react';

import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {t} from '@/lib/copy';

import type {GridField, GridSection} from './templateTree';

/**
 * Docked, non-modal inspector (spec §2).
 *
 * READ-ONLY in the B-1 shell: it repoints on selection and offers one
 * escape hatch to the existing edit dialog. The writable form (Section
 * combobox, Required switch, drag-ordered options) lands with B-5, once
 * a committed change no longer mints a template version.
 */

const KIND_COPY = {
  root: 'inspectorKindRoot',
  group: 'inspectorKindGroup',
  groupChild: 'inspectorKindGroupChild',
} as const;

interface TemplateInspectorProps {
  field: GridField | null;
  section: GridSection | null;
  /** The section that owns the selected field, for the read-only Section row. */
  owningSection: GridSection | null;
  onEditField: (field: GridField) => void;
}

function Label({children}: {children: React.ReactNode}) {
  return (
    <div className="mb-[3px] mt-[9px] text-[9.5px] uppercase tracking-[0.05em] text-muted-foreground">
      {children}
    </div>
  );
}

function ReadOnlyValue({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div
      className={`rounded-md border bg-background px-2 py-1 ${muted ? 'text-muted-foreground' : ''}`}
    >
      {children}
    </div>
  );
}

export function TemplateInspector({
  field,
  section,
  owningSection,
  onEditField,
}: TemplateInspectorProps) {
  if (!field && !section) {
    return (
      <aside className="w-[300px] shrink-0 border-l bg-muted/20 px-3.5 py-3 text-xs">
        <div className="font-medium">{t('extraction', 'inspectorEmptyTitle')}</div>
        <p className="mt-1 text-muted-foreground">
          {t('extraction', 'inspectorEmptyHint')}
        </p>
      </aside>
    );
  }

  if (field) {
    return (
      <aside
        data-testid="template-inspector"
        className="w-[300px] shrink-0 overflow-y-auto border-l bg-muted/20 px-3.5 py-3 text-xs"
      >
        <div className="flex items-center gap-1.5">
          <strong className="min-w-0 flex-1 truncate">{field.label}</strong>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            onClick={() => onEditField(field)}
          >
            <Pencil className="mr-1 size-3" aria-hidden />
            {t('extraction', 'inspectorEditButton')}
          </Button>
        </div>

        <Label>{t('extraction', 'inspectorKeyLabel')}</Label>
        <ReadOnlyValue muted>
          <span className="font-mono text-[10px]">{field.key}</span>
        </ReadOnlyValue>

        {owningSection && (
          <>
            <Label>{t('extraction', 'inspectorSectionLabel')}</Label>
            <ReadOnlyValue>{owningSection.label}</ReadOnlyValue>
          </>
        )}

        <Label>{t('extraction', 'inspectorTypeLabel')}</Label>
        <ReadOnlyValue>
          <span className="capitalize">{field.fieldType}</span>
          {field.unit && (
            <span className="ml-1.5 text-muted-foreground">· {field.unit}</span>
          )}
        </ReadOnlyValue>

        <Label>{t('extraction', 'inspectorRequiredLabel')}</Label>
        <ReadOnlyValue muted={!field.isRequired}>
          {field.isRequired
            ? t('extraction', 'inspectorRequiredYes')
            : t('extraction', 'inspectorRequiredNo')}
        </ReadOnlyValue>

        {field.optionCount > 0 && (
          <>
            <Label>{t('extraction', 'inspectorOptionsLabel')}</Label>
            <div className="flex flex-wrap gap-1 pr-1">
              {(field.allowedValues ?? []).map((option) => (
                <span
                  key={option}
                  className="inline-flex items-center rounded-full border bg-background px-2 py-0.5 text-[10.5px]"
                >
                  {option}
                </span>
              ))}
            </div>
          </>
        )}

        <Label>
          <span className="inline-flex items-center gap-1 text-primary">
            <Sparkles className="size-3" aria-hidden />
            {t('extraction', 'inspectorAiLabel')}
          </span>
        </Label>
        <ReadOnlyValue muted={!field.aiInstruction}>
          {field.aiInstruction ?? t('extraction', 'inspectorAiEmpty')}
        </ReadOnlyValue>
        <p className="mt-[3px] text-[10.5px] text-muted-foreground">
          {t('extraction', 'inspectorAiHint')}
        </p>

        <Label>{t('extraction', 'inspectorDescriptionLabel')}</Label>
        <ReadOnlyValue muted={!field.description}>
          {field.description ?? t('extraction', 'inspectorDescriptionEmpty')}
        </ReadOnlyValue>
        <p className="mt-[3px] text-[10.5px] text-muted-foreground">
          {t('extraction', 'inspectorDescriptionHint')}
        </p>
      </aside>
    );
  }

  const selectedSection = section as GridSection;
  return (
    <aside
      data-testid="template-inspector"
      className="w-[300px] shrink-0 overflow-y-auto border-l bg-muted/20 px-3.5 py-3 text-xs"
    >
      <div className="flex items-center gap-1.5">
        <strong className="min-w-0 flex-1 truncate">{selectedSection.label}</strong>
        <Badge variant="secondary" className="shrink-0 text-[10px]">
          {t('extraction', KIND_COPY[selectedSection.kind])}
        </Badge>
      </div>

      <Label>{t('extraction', 'inspectorKeyLabel')}</Label>
      <ReadOnlyValue muted>
        <span className="font-mono text-[10px]">{selectedSection.key}</span>
      </ReadOnlyValue>

      <Label>{t('extraction', 'fieldsCountLabel')}</Label>
      <ReadOnlyValue>{selectedSection.totalFieldCount}</ReadOnlyValue>

      <Label>{t('extraction', 'inspectorDescriptionLabel')}</Label>
      <ReadOnlyValue muted={!selectedSection.description}>
        {selectedSection.description ?? t('extraction', 'inspectorDescriptionEmpty')}
      </ReadOnlyValue>
    </aside>
  );
}
