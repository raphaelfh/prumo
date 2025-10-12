/**
 * Grid de Comparação de Extrações
 * 
 * REFATORADO: Agora usa ComparisonTable genérico
 * Mantido para compatibilidade com código existente
 * 
 * @component
 * @deprecated Migrar para ExtractionComparisonView
 */

import { useMemo, useCallback } from 'react';
import { ComparisonTable, type ComparisonColumn, type ComparisonUser } from '@/components/shared/comparison';
import type { ExtractionField } from '@/types/extraction';
import type { OtherExtraction } from '@/hooks/extraction/colaboracao/useOtherExtractions';

// =================== INTERFACES ===================

interface ComparisonGridViewProps {
  fields: ExtractionField[];
  instanceId: string;
  myValues: Record<string, any>; // key: fieldId
  otherExtractions: OtherExtraction[];
  currentUserId: string;
  currentUserName: string;
  onValueUpdate?: (instanceId: string, fieldId: string, value: any) => void;
}

// =================== COMPONENT ===================

/**
 * Componente refatorado que usa ComparisonTable genérico
 * Wrapper para manter compatibilidade com código existente
 */
export function ComparisonGridView(props: ComparisonGridViewProps) {
  const { fields, instanceId, myValues, otherExtractions, currentUserId, currentUserName, onValueUpdate } = props;

  // Preparar columns (cada field é uma row)
  const columns = useMemo<ComparisonColumn[]>(() => 
    fields.map(field => ({
      id: field.id,
      label: field.label,
      getValue: (fieldId: string, userData: Record<string, any>) => {
        // Para instance-specific values, usar chave composta
        return userData[`${instanceId}_${fieldId}`] || userData[fieldId];
      },
      isRequired: field.is_required
    })),
    [fields, instanceId]
  );

  // Preparar usuários
  const currentUser: ComparisonUser = {
    userId: currentUserId,
    userName: currentUserName,
    isCurrentUser: true
  };

  const otherUsers: ComparisonUser[] = otherExtractions.map(ext => ({
    userId: ext.userId,
    userName: ext.userName,
    userAvatar: ext.userAvatar,
    isCurrentUser: false
  }));

  // Preparar data (userId -> fieldId -> value)
  const comparisonData = useMemo(() => {
    const data: Record<string, Record<string, any>> = {};
    
    // Dados do usuário atual
    data[currentUserId] = myValues;

    // Dados de outros usuários
    otherExtractions.forEach(ext => {
      data[ext.userId] = ext.values;
    });

    return data;
  }, [currentUserId, myValues, otherExtractions]);

  // Handler para edição inline (delega para parent)
  const handleValueChange = useCallback((fieldId: string, newValue: any) => {
    if (onValueUpdate) {
      onValueUpdate(instanceId, fieldId, newValue);
    }
  }, [instanceId, onValueUpdate]);

  // Usar ComparisonTable genérico
  return (
    <ComparisonTable
      columns={columns}
      rows={fields.map(f => f.id)}
      currentUser={currentUser}
      otherUsers={otherUsers}
      data={comparisonData}
      showConsensus
      editable={!!onValueUpdate}
      onValueChange={handleValueChange}
      maxHeight="600px"
    />
  );
}

