/**
 * Fields Manager header.
 *
 * Header component with title, count and add button.
 *
 * @component
 */

import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,} from '@/components/ui/tooltip';
import {Lock, Plus} from 'lucide-react';
import {t} from '@/lib/copy';

interface FieldsHeaderProps {
  fieldsCount: number;
  userRole: string | null;
  canCreate: boolean;
  onAddField: () => void;
}

export function FieldsHeader({
  fieldsCount,
  userRole,
  canCreate,
  onAddField,
}: FieldsHeaderProps) {
  // Decorative glyph + translated label, mapped explicitly per role. The
  // emoji lives in an aria-hidden span so it never leaks into the accessible
  // name; meaning is carried by the translated label only.
  const getRoleDisplay = (role: string | null): { emoji: string; label: string } => {
    switch (role) {
      case 'manager':
        return { emoji: '👑', label: t('common', 'roleManager') };
      case 'reviewer':
        return { emoji: '📝', label: t('common', 'roleReviewer') };
      default:
        return { emoji: '👁️', label: t('common', 'roleViewer') };
    }
  };

  const roleDisplay = userRole ? getRoleDisplay(userRole) : null;

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium" id="fields-header">
            {t('extraction', 'fieldsOfThisSection')} ({fieldsCount})
        </h4>
        {roleDisplay && (
            <Badge variant="outline" className="text-xs"
                   aria-label={t('common', 'userRoleAria').replace('{{role}}', roleDisplay.label)}>
            <span aria-hidden="true">{roleDisplay.emoji}</span> {roleDisplay.label}
          </Badge>
        )}
      </div>
      
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <Button
                size="sm"
                onClick={onAddField}
                disabled={!canCreate}
                className="gap-2"
                aria-label={t('extraction', 'addFieldAria')}
                aria-describedby="fields-header"
              >
                {canCreate ? (
                  <>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                      {t('extraction', 'addFieldButton')}
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4" aria-hidden="true" />
                      {t('extraction', 'addFieldButton')}
                  </>
                )}
              </Button>
            </div>
          </TooltipTrigger>
          {!canCreate && (
            <TooltipContent>
                <p>{t('extraction', 'onlyManagersCanAddFields')}</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
