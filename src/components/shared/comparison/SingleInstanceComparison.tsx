/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Comparação de Instância Única
 * 
 * Para cardinality='one':
 * - Renderiza ComparisonTable com todos os fields
 * - Compara valores de todos os usuários lado a lado
 */

import { useMemo, useCallback } from 'react';
import { ComparisonTable, type ComparisonColumn, type ComparisonUser } from './ComparisonTable';
import { extractInstanceValuesForUser } from '@/lib/comparison/grouping';
import type { ComparisonSectionViewProps } from './ComparisonSectionView';

export function SingleInstanceComparison(props: ComparisonSectionViewProps) {
  const instance = props.instances[0];
  
  if (!instance) {
    return (
      <div className="text-center py-4 text-muted-foreground text-sm">
        Nenhuma instância criada para esta seção
      </div>
    );
  }
  
  // Preparar columns (cada field é uma row)
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
  
  // Preparar data (userId -> fieldId -> value)
  const comparisonData = useMemo(() => {
    const data: Record<string, Record<string, any>> = {};
    
    // Meus valores
    data[props.currentUser.userId] = extractInstanceValuesForUser(
      props.myValues, 
      instance.id
    );
    
    // Valores de outros usuários
    props.otherExtractions.forEach(ext => {
      // Encontrar instanceId correspondente (mesma seção)
      // Para cardinality='one', sempre há apenas 1 instance por usuário
      data[ext.userId] = extractInstanceValuesForUser(
        ext.values,
        instance.id // Assumindo mesmo ID (pode precisar ajuste)
      );
    });
    
    return data;
  }, [props.currentUser.userId, props.myValues, props.otherExtractions, instance.id]);
  
  // Preparar lista de outros usuários
  const otherUsers = useMemo<ComparisonUser[]>(() => 
    props.otherExtractions.map(ext => ({
      userId: ext.userId,
      userName: ext.userName,
      userAvatar: ext.userAvatar,
      isCurrentUser: false
    })),
    [props.otherExtractions]
  );
  
  // Handler para edição
  const handleValueChange = useCallback((fieldId: string, newValue: any) => {
    if (props.onValueUpdate) {
      props.onValueUpdate(instance.id, fieldId, newValue);
    }
  }, [instance.id, props.onValueUpdate]);
  
  return (
    <ComparisonTable
      columns={columns}
      rows={props.entityType.fields.map(f => f.id)}
      currentUser={props.currentUser}
      otherUsers={otherUsers}
      data={comparisonData}
      showConsensus
      editable={props.editable}
      onValueChange={handleValueChange}
      maxHeight="600px"
    />
  );
}
