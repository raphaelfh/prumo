/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Comparação de Modelos Preditivos (1:1)
 * 
 * Permite usuário selecionar:
 * 1. Qual dos SEUS modelos comparar
 * 2. Com qual OUTRO USUÁRIO comparar
 * 3. Qual MODELO desse outro usuário comparar
 * 
 * Renderiza grid lado-a-lado usando ComparisonTable genérico.
 * 
 * Features:
 * - Seletores cascata (modelo próprio → usuário → modelo do usuário)
 * - Auto-seleção inteligente (primeiro modelo disponível)
 * - Validação de estado (precisa ter modelos)
 * - Grid de comparação 1:1
 * 
 * @component
 */

import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info } from 'lucide-react';
import { ComparisonTable, type ComparisonColumn, type ComparisonUser } from '@/components/shared/comparison';
import type { ExtractionEntityType, ExtractionField, ExtractionInstance } from '@/types/extraction';
import type { OtherExtraction } from '@/hooks/extraction/colaboracao/useOtherExtractions';

// =================== INTERFACES ===================

interface ModelLevelComparisonProps {
  modelParentType: ExtractionEntityType;
  entityTypes: ExtractionEntityType[];
  myInstances: Record<string, ExtractionInstance[]>; // entityTypeId -> instances
  myValues: Record<string, any>;
  otherExtractions: OtherExtraction[];
  currentUser: ComparisonUser;
}

// =================== COMPONENT ===================

export function ModelLevelComparison(props: ModelLevelComparisonProps) {
  const {
    modelParentType,
    entityTypes,
    myInstances,
    myValues,
    otherExtractions,
    currentUser
  } = props;

  const [mySelectedModelId, setMySelectedModelId] = useState<string | null>(null);
  const [otherSelectedUserId, setOtherSelectedUserId] = useState<string | null>(null);
  const [otherSelectedModelId, setOtherSelectedModelId] = useState<string | null>(null);

  // Meus modelos (instances do tipo prediction_models)
  const myModels = myInstances[modelParentType.id] || [];

  // Auto-selecionar primeiro modelo do usuário atual
  useEffect(() => {
    if (myModels.length > 0 && !mySelectedModelId) {
      setMySelectedModelId(myModels[0].id);
    }
  }, [myModels, mySelectedModelId]);

  // Extrair modelos de outros usuários
  // NOTA: otherExtractions.values contém dados flat de extracted_values
  // Precisamos inferir quais instances existem baseado nas chaves
  const modelsByUser = useMemo(() => {
    const grouped = new Map<string, Array<{ id: string; label: string }>>();

    otherExtractions.forEach(ext => {
      const userModels: Array<{ id: string; label: string }> = [];

      // Analisar chaves para encontrar instanceIds únicos
      // Formato esperado: `${instanceId}_${fieldId}`
      const instanceIds = new Set<string>();

      Object.keys(ext.values).forEach(key => {
        const parts = key.split('_');
        if (parts.length >= 2) {
          // Primeira parte é instanceId (UUID format)
          const potentialInstanceId = parts[0];
          if (potentialInstanceId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
            instanceIds.add(potentialInstanceId);
          }
        }
      });

      // Para cada instanceId, criar entry (usamos instanceId como label por enquanto)
      // TODO: Buscar label real do banco ou metadata
      instanceIds.forEach(instanceId => {
        userModels.push({
          id: instanceId,
          label: `Modelo ${userModels.length + 1}` // Fallback
        });
      });

      if (userModels.length > 0) {
        grouped.set(ext.userId, userModels);
      }
    });

    return grouped;
  }, [otherExtractions]);

  // Resetar modelo selecionado quando mudar usuário
  useEffect(() => {
    if (otherSelectedUserId) {
      const userModels = modelsByUser.get(otherSelectedUserId);
      if (userModels && userModels.length > 0) {
        setOtherSelectedModelId(userModels[0].id);
      } else {
        setOtherSelectedModelId(null);
      }
    }
  }, [otherSelectedUserId, modelsByUser]);

  // Buscar entity types filhos do modelo (Candidate Predictors, Performance, etc)
  const modelChildTypes = useMemo(() => 
    entityTypes.filter(et => et.parent_entity_type_id === modelParentType.id),
    [entityTypes, modelParentType.id]
  );

  // Preparar colunas para model-level (fields dos child types)
  const modelColumns = useMemo<ComparisonColumn[]>(() => {
    const columns: ComparisonColumn[] = [];

    modelChildTypes.forEach(childType => {
      // Pegar fields deste child type (se carregados)
      const fields = (childType as any).fields || [];

      fields.forEach((field: ExtractionField) => {
        columns.push({
          id: field.id,
          label: `${childType.label} > ${field.label}`,
          getValue: (fieldId: string, userData: Record<string, any>) => {
            // Para model-level, precisamos do instanceId
            // Usar modelos selecionados
            // Chave: `${instanceId}_${fieldId}`
            return userData[fieldId]; // Será ajustado com instanceId quando renderizar
          },
          isRequired: field.is_required
        });
      });
    });

    return columns;
  }, [modelChildTypes]);

  // Preparar data específico para os 2 modelos selecionados
  const modelComparisonData = useMemo(() => {
    if (!mySelectedModelId || !otherSelectedModelId || !otherSelectedUserId) {
      return {};
    }

    const data: Record<string, Record<string, any>> = {};

    // Dados do meu modelo selecionado
    const myModelData: Record<string, any> = {};
    modelColumns.forEach(column => {
      const key = `${mySelectedModelId}_${column.id}`;
      myModelData[column.id] = myValues[key];
    });
    data[currentUser.userId] = myModelData;

    // Dados do modelo do outro usuário
    const otherUserData: Record<string, any> = {};
    const otherExtraction = otherExtractions.find(e => e.userId === otherSelectedUserId);
    if (otherExtraction) {
      modelColumns.forEach(column => {
        const key = `${otherSelectedModelId}_${column.id}`;
        otherUserData[column.id] = otherExtraction.values[key];
      });
    }
    data[otherSelectedUserId] = otherUserData;

    return data;
  }, [mySelectedModelId, otherSelectedModelId, otherSelectedUserId, myValues, otherExtractions, modelColumns, currentUser.userId]);

  // Validações
  if (myModels.length === 0) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Você ainda não criou nenhum modelo preditivo. 
          Adicione modelos na aba <strong>Extração</strong> para poder comparar.
        </AlertDescription>
      </Alert>
    );
  }

  if (modelsByUser.size === 0) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Nenhum outro revisor criou modelos ainda.
          A comparação ficará disponível quando outros membros adicionarem modelos.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Seletores de Modelos */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Coluna Esquerda: Meu Modelo */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Seu Modelo</Label>
              <Select 
                value={mySelectedModelId || ''} 
                onValueChange={setMySelectedModelId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione seu modelo" />
                </SelectTrigger>
                <SelectContent>
                  {myModels.map(model => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {myModels.length} modelo{myModels.length !== 1 ? 's' : ''} criado{myModels.length !== 1 ? 's' : ''}
              </p>
            </div>

            {/* Coluna Direita: Modelo de Outro Usuário */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Comparar com</Label>
              
              {/* Seletor de Usuário */}
              <Select 
                value={otherSelectedUserId || ''} 
                onValueChange={setOtherSelectedUserId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione outro revisor" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from(modelsByUser.entries()).map(([userId, models]) => {
                    const user = otherExtractions.find(e => e.userId === userId);
                    return (
                      <SelectItem key={userId} value={userId}>
                        {user?.userName} ({models.length} modelo{models.length !== 1 ? 's' : ''})
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>

              {/* Seletor de Modelo (cascata) */}
              {otherSelectedUserId && modelsByUser.get(otherSelectedUserId) && (
                <Select 
                  value={otherSelectedModelId || ''} 
                  onValueChange={setOtherSelectedModelId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o modelo" />
                  </SelectTrigger>
                  <SelectContent>
                    {modelsByUser.get(otherSelectedUserId)!.map(model => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {otherSelectedUserId && !otherSelectedModelId && (
                <p className="text-xs text-muted-foreground">
                  Selecione um modelo acima
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grid de Comparação 1:1 */}
      {mySelectedModelId && otherSelectedModelId && otherSelectedUserId && (
        <>
          {/* Info sobre os modelos sendo comparados */}
          <div className="flex items-center justify-between bg-muted/50 rounded-lg p-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Seu modelo</Badge>
              <span className="font-medium">
                {myModels.find(m => m.id === mySelectedModelId)?.label}
              </span>
            </div>
            <span className="text-muted-foreground">vs</span>
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {otherExtractions.find(e => e.userId === otherSelectedUserId)?.userName}
              </Badge>
              <span className="font-medium">
                {modelsByUser.get(otherSelectedUserId)?.find(m => m.id === otherSelectedModelId)?.label}
              </span>
            </div>
          </div>

          {/* Tabela de comparação */}
          <ComparisonTable
            columns={modelColumns}
            rows={modelColumns.map(c => c.id)}
            currentUser={currentUser}
            otherUsers={[
              otherExtractions.find(e => e.userId === otherSelectedUserId)!
            ].map(ext => ({
              userId: ext.userId,
              userName: ext.userName,
              userAvatar: ext.userAvatar,
              isCurrentUser: false
            }))}
            data={modelComparisonData}
            showConsensus={false} // Não faz sentido para comparação 1:1
            maxHeight="500px"
          />
        </>
      )}
    </div>
  );
}

