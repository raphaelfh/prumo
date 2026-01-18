/**
 * Comparação com Seletor de Entidade
 * 
 * Para cardinality='many':
 * - Agrupa instances por label (ex: "model A", "model B")
 * - Seletor para escolher qual entidade comparar
 * - Tabela comparando essa entidade entre TODOS os usuários
 * 
 * Exemplo de UX:
 * [Seletor: model A ▼] <- Pode escolher model A, model B, etc
 * 
 * Tabela comparando "model A":
 * | Campo              | Você    | User 2  | User 3  |
 * |--------------------|---------|---------|---------|
 * | Type of predictors | Clinical| Imaging | Clinical|
 * | Number of preds    | 5       | 3       | 5       |
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info } from 'lucide-react';
import { ComparisonTable, type ComparisonColumn, type ComparisonUser } from './ComparisonTable';
import { groupInstancesByLabel, extractInstanceValuesForUser } from '@/lib/comparison/grouping';
import type { ComparisonSectionViewProps } from './ComparisonSectionView';

export function EntitySelectorComparison(props: ComparisonSectionViewProps) {
  // Agrupar instances por label (CORRIGIDO: usar instances reais do banco)
  const groupedEntities = useMemo(() => 
    groupInstancesByLabel(
      props.instances,
      props.currentUser.userId,
      props.allUserInstances, // NOVO: usar instances reais do banco
      props.entityType.id
    ),
    [props.instances, props.currentUser.userId, props.allUserInstances, props.entityType.id]
  );
  
  // State: entidade selecionada
  const [selectedEntityLabel, setSelectedEntityLabel] = useState<string | null>(null);
  
  // Auto-selecionar primeira entidade
  useEffect(() => {
    if (groupedEntities.length > 0 && !selectedEntityLabel) {
      setSelectedEntityLabel(groupedEntities[0].label);
    }
  }, [groupedEntities, selectedEntityLabel]);
  
  // Entidade ativa
  const activeEntity = useMemo(() => 
    groupedEntities.find(e => e.label === selectedEntityLabel),
    [groupedEntities, selectedEntityLabel]
  );
  
  // Preparar columns
  const columns = useMemo<ComparisonColumn[]>(() => 
    props.entityType.fields.map(field => ({
      id: field.id,
      label: field.label,
      getValue: (fieldId: string, userData: Record<string, any>) => userData[fieldId],
      isRequired: field.is_required,
      field: field // ✅ NOVO: passar field para a coluna
    })),
    [props.entityType.fields]
  );
  
  // Preparar data para entidade selecionada
  const comparisonData = useMemo(() => {
    if (!activeEntity) return {};
    
    const data: Record<string, Record<string, any>> = {};
    
    // Para cada usuário que tem essa entidade, extrair valores
    activeEntity.instancesByUser.forEach((instanceId, userId) => {
      if (userId === props.currentUser.userId) {
        data[userId] = extractInstanceValuesForUser(props.myValues, instanceId);
      } else {
        const ext = props.otherExtractions.find(e => e.userId === userId);
        if (ext) {
          data[userId] = extractInstanceValuesForUser(ext.values, instanceId);
        }
      }
    });
    
    return data;
  }, [activeEntity, props.currentUser.userId, props.myValues, props.otherExtractions]);
  
  // Preparar lista de usuários (apenas os que têm essa entidade)
  const usersWithEntity = useMemo<ComparisonUser[]>(() => {
    if (!activeEntity) return [];
    
    const users: ComparisonUser[] = [];
    
    activeEntity.instancesByUser.forEach((instanceId, userId) => {
      if (userId === props.currentUser.userId) {
        users.push(props.currentUser);
      } else {
        const ext = props.otherExtractions.find(e => e.userId === userId);
        if (ext) {
          users.push({
            userId: ext.userId,
            userName: ext.userName,
            userAvatar: ext.userAvatar,
            isCurrentUser: false
          });
        }
      }
    });
    
    return users;
  }, [activeEntity, props.currentUser, props.otherExtractions]);
  
  // Handler para edição
  const handleValueChange = useCallback((fieldId: string, newValue: any) => {
    if (activeEntity && props.onValueUpdate) {
      const myInstanceId = activeEntity.instancesByUser.get(props.currentUser.userId);
      if (myInstanceId) {
        props.onValueUpdate(myInstanceId, fieldId, newValue);
      }
    }
  }, [activeEntity, props.currentUser.userId, props.onValueUpdate]);
  
  // Validações
  if (props.instances.length === 0) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Você ainda não criou nenhuma instância de <strong>{props.entityType.label}</strong>.
        </AlertDescription>
      </Alert>
    );
  }
  
  if (groupedEntities.length === 0) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Nenhuma entidade encontrada para comparação.
        </AlertDescription>
      </Alert>
    );
  }
  
  return (
    <div className="space-y-4">
      {/* Card de Seletor */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-end gap-4">
            <div className="flex-1 space-y-2">
              <Label className="text-sm font-medium">
                Selecione uma {props.entityType.label.toLowerCase()} para comparar entre usuários
              </Label>
              <Select 
                value={selectedEntityLabel || ''} 
                onValueChange={setSelectedEntityLabel}
              >
                <SelectTrigger>
                  <SelectValue placeholder={`Selecione uma ${props.entityType.label.toLowerCase()}`} />
                </SelectTrigger>
                <SelectContent>
                  {groupedEntities.map(entity => {
                    const userCount = entity.instancesByUser.size;
                    return (
                      <SelectItem key={entity.label} value={entity.label}>
                        {entity.label} ({userCount} usuário{userCount !== 1 ? 's' : ''})
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {groupedEntities.length} entidade{groupedEntities.length !== 1 ? 's' : ''} disponível{groupedEntities.length !== 1 ? 'eis' : ''}
              </p>
            </div>
            
            {activeEntity && (
              <Badge variant="secondary" className="mb-1">
                {activeEntity.instancesByUser.size} revisor{activeEntity.instancesByUser.size !== 1 ? 'es' : ''}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
      
      {/* Tabela de Comparação */}
      {activeEntity && (
        <ComparisonTable
          columns={columns}
          rows={props.entityType.fields.map(f => f.id)}
          currentUser={props.currentUser}
          otherUsers={usersWithEntity.filter(u => !u.isCurrentUser)}
          data={comparisonData}
          showConsensus
          editable={props.editable}
          onValueChange={handleValueChange}
          maxHeight="600px"
        />
      )}
    </div>
  );
}
