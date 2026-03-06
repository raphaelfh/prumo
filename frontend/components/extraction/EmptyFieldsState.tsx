/**
 * Estado Vazio do Gerenciador de Campos
 *
 * Component shown when there are no fields in the section.
 * 
 * @component
 */

import {memo} from 'react';
import {Card, CardContent} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Plus} from 'lucide-react';
import {t} from '@/lib/copy';

interface EmptyFieldsStateProps {
  canCreate: boolean;
  onAddField: () => void;
}

export const EmptyFieldsState = memo(function EmptyFieldsState({ canCreate, onAddField }: EmptyFieldsStateProps) {
  return (
    <Card role="region" aria-labelledby="empty-state-title">
      <CardContent className="pt-6">
        <div className="text-center py-8">
          <p id="empty-state-title" className="text-sm text-muted-foreground mb-4">
              {t('extraction', 'noFieldsInSection')}
          </p>
          {canCreate && (
            <Button
              variant="outline"
              size="sm"
              onClick={onAddField}
              aria-label={t('extraction', 'addFirstFieldInSectionAria')}
            >
              <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
                {t('extraction', 'addFirstFieldButton')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
});
