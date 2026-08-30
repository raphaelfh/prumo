/**
 * The Configuration panel with no active template: the two ways to get one,
 * plus the manager note.
 *
 * The catalogue used to be a table here AND a pane inside the import dialog.
 * It now lives only in the dialog, so this screen offers two symmetrical
 * choices instead of one button and one table (spec 2026-08-27, slice A).
 */

import {AlertCircle, Import, PlusCircle} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {t} from '@/lib/copy';

interface ConfigureTemplateCardsProps {
  onCreateTemplate: () => void;
  onImportTemplate: () => void;
}

export function ConfigureTemplateCards({
  onCreateTemplate,
  onImportTemplate,
}: ConfigureTemplateCardsProps) {
  return (
    <Card className="border-border/40 shadow-elev-popover rounded-md w-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-[13px] font-medium text-foreground">
          {t('extraction', 'configPanelTitle')}
        </CardTitle>
        <CardDescription className="text-[13px] text-muted-foreground">
          {t('extraction', 'configPanelDesc')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ChoiceCard
          icon={<PlusCircle className="h-4 w-4 text-primary" strokeWidth={1.5} />}
          title={t('extraction', 'configCreateCustomTitle')}
          description={t('extraction', 'configCreateCustomFullDesc')}
          actionLabel={t('extraction', 'configCreateTemplateButton')}
          actionIcon={<PlusCircle className="h-4 w-4 mr-2" strokeWidth={1.5} />}
          testId="extraction-open-create"
          onAction={onCreateTemplate}
        />

        <ChoiceCard
          icon={<Import className="h-4 w-4 text-primary" strokeWidth={1.5} />}
          title={t('extraction', 'configImportCardTitle')}
          description={t('extraction', 'configImportCardDesc')}
          actionLabel={t('extraction', 'configImportCardButton')}
          actionIcon={<Import className="h-4 w-4 mr-2" strokeWidth={1.5} />}
          testId="extraction-open-import"
          onAction={onImportTemplate}
        />

        <div className="bg-info/5 border border-info/30 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <AlertCircle className="h-4 w-4 text-info mt-0.5 shrink-0" strokeWidth={1.5} />
            <div className="text-[13px] text-foreground">
              <p className="font-medium mb-1">{t('extraction', 'configManagersNote')}</p>
              <p className="text-muted-foreground">{t('extraction', 'configManagersNoteDesc')}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface ChoiceCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  actionIcon: React.ReactNode;
  testId: string;
  onAction: () => void;
}

/** The two choices are siblings, so they render through one shape. */
function ChoiceCard({
  icon,
  title,
  description,
  actionLabel,
  actionIcon,
  testId,
  onAction,
}: ChoiceCardProps) {
  return (
    <div className="border border-border/40 rounded-lg p-4 hover:bg-muted/50 transition-colors duration-75">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2 flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            {icon}
            <h3 className="text-[13px] font-semibold">{title}</h3>
          </div>
          <p className="text-[13px] text-muted-foreground">{description}</p>
        </div>
        {/* Height comes from the size scale — never a className override
            (scripts/fitness/check_button_scale.py). */}
        <Button
          variant="outline"
          className="w-full sm:w-auto sm:ml-4"
          data-testid={testId}
          onClick={onAction}
        >
          {actionIcon}
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}
