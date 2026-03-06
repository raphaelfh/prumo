/**
 * Header do Gerenciador de Campos
 *
 * Header component with title, count and add button.
 * 
 * @component
 */

import {memo} from 'react';
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

export const FieldsHeader = memo(function FieldsHeader({
  fieldsCount,
  userRole,
  canCreate,
  onAddField,
}: FieldsHeaderProps) {
  const getRoleBadge = (role: string | null) => {
    switch (role) {
      case 'manager':
        return '👑 Manager';
      case 'reviewer':
        return '📝 Reviewer';
      default:
        return '👁️ Viewer';
    }
  };

  return (
    <div className="flex items-center justify-between" role="banner">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium" id="fields-header">
            {t('extraction', 'fieldsOfThisSection')} ({fieldsCount})
        </h4>
        {userRole && (
            <Badge variant="outline" className="text-xs"
                   aria-label={t('common', 'userRoleAria').replace('{{role}}', getRoleBadge(userRole))}>
            {getRoleBadge(userRole)}
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
});
