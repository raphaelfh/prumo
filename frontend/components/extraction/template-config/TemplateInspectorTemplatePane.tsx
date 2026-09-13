import {TemplateInstructionPane} from '@/components/extraction/TemplateInstructionPane';
import {t} from '@/lib/copy';

import type {TemplateInstructionSlot} from './TemplateInspector';

/**
 * The inspector with nothing selected IS the template: its general AI
 * instruction lives here, beside the grid it ships with on Publish
 * (spec 2026-09-13 §4.3). The select-a-row hint stays as one muted line.
 */
export function TemplateInspectorTemplatePane({
  projectId,
  templateId,
  instruction,
}: {
  projectId: string;
  templateId: string;
  instruction: TemplateInstructionSlot;
}) {
  return (
    <div className="space-y-2" data-testid="template-inspector-template">
      <div className="font-medium">{t('extraction', 'instructionTitle')}</div>
      <p className="text-xs text-muted-foreground">{t('extraction', 'instructionScopeHint')}</p>
      <TemplateInstructionPane
        projectId={projectId}
        templateId={templateId}
        draft={instruction.draft}
        onDraftChange={instruction.onDraftChange}
      />
      <p className="pt-1 text-xs text-muted-foreground">{t('extraction', 'inspectorEmptyHint')}</p>
    </div>
  );
}
