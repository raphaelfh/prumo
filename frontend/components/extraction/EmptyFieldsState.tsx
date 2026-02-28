/**
 * Estado Vazio do Gerenciador de Campos
 * 
 * Componente exibido quando não há campos na seção.
 * 
 * @component
 */

import {memo} from 'react';
import {Card, CardContent} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Plus} from 'lucide-react';

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
            Nenhum campo nesta seção
          </p>
          {canCreate && (
            <Button
              variant="outline"
              size="sm"
              onClick={onAddField}
              aria-label="Adicionar primeiro campo nesta seção"
            >
              <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
              Adicionar Primeiro Campo
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
});
