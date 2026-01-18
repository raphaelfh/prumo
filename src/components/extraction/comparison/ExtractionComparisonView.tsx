/**
 * View Principal de Comparação para Extraction
 * 
 * Orquestra comparação em 2 níveis hierárquicos:
 * 1. Study-level: Campos únicos compartilhados (Participants, Outcome, etc)
 * 2. Model-level: Comparação 1:1 de modelos preditivos
 * 
 * Usa ComparisonTable genérico e delega complexidade para sub-componentes.
 * 
 * @component
 */

import { useState, useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Users, BarChart, GitBranch, Info } from 'lucide-react';
import { ComparisonTable, type ComparisonColumn, type ComparisonUser } from '@/components/shared/comparison';
import { ModelLevelComparison } from './ModelLevelComparison';
import type { ExtractionEntityType, ExtractionField, ExtractionInstance } from '@/types/extraction';
import type { OtherExtraction } from '@/hooks/extraction/colaboracao/useOtherExtractions';

// =================== INTERFACES ===================

interface ExtractionComparisonViewProps {
  entityTypes: ExtractionEntityType[];
  myValues: Record<string, any>; // fieldId -> value
  myInstances: ExtractionInstance[];
  otherExtractions: OtherExtraction[];
  currentUserId: string;
  currentUserName: string;
}

// =================== COMPONENT ===================

export function ExtractionComparisonView(props: ExtractionComparisonViewProps) {
  const {
    entityTypes,
    myValues,
    myInstances,
    otherExtractions,
    currentUserId,
    currentUserName
  } = props;

  const [activeLevel, setActiveLevel] = useState<'study' | 'models'>('study');

  // Separar entity types por nível hierárquico
  const studyLevelTypes = useMemo(() => 
    entityTypes.filter(et => !et.parent_entity_type_id),
    [entityTypes]
  );

  const modelParentType = useMemo(() => 
    entityTypes.find(et => et.name === 'prediction_models'),
    [entityTypes]
  );

  // Preparar colunas para study-level (fields flat)
  const studyColumns = useMemo<ComparisonColumn[]>(() => {
    const columns: ComparisonColumn[] = [];

    studyLevelTypes.forEach(entityType => {
      // Assumindo que entity types têm fields carregados
      const fields = entityTypes
        .filter(et => et.id === entityType.id)
        .flatMap(et => (et as any).fields || []);

      fields.forEach((field: ExtractionField) => {
        columns.push({
          id: field.id,
          label: `${entityType.label} > ${field.label}`,
          getValue: (fieldId: string, userData: Record<string, any>) => {
            // Para study-level, valores são diretos (sem instance prefix)
            return userData[fieldId];
          },
          isRequired: field.is_required
        });
      });
    });

    return columns;
  }, [studyLevelTypes, entityTypes]);

  // Preparar dados para ComparisonTable
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

  // Preparar lista de usuários
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

  // Agrupar instances do usuário atual por entity type
  const myInstancesByType = useMemo(() => {
    const grouped: Record<string, ExtractionInstance[]> = {};
    myInstances.forEach(instance => {
      if (!grouped[instance.entity_type_id]) {
        grouped[instance.entity_type_id] = [];
      }
      grouped[instance.entity_type_id].push(instance);
    });
    return grouped;
  }, [myInstances]);

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Comparação de Extrações
          </CardTitle>
          <Badge variant="outline">
            {otherExtractions.length} outro{otherExtractions.length !== 1 ? 's' : ''} revisor{otherExtractions.length !== 1 ? 'es' : ''}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {studyColumns.length === 0 && !modelParentType ? (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Configure o template de extração para habilitar comparação.
            </AlertDescription>
          </Alert>
        ) : (
          <Tabs value={activeLevel} onValueChange={(v) => setActiveLevel(v as any)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="study" className="gap-2" disabled={studyColumns.length === 0}>
                <BarChart className="h-4 w-4" />
                Study-level
                {studyColumns.length > 0 && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    {studyColumns.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="models" className="gap-2" disabled={!modelParentType}>
                <GitBranch className="h-4 w-4" />
                Model-level
                {modelParentType && myInstancesByType[modelParentType.id]?.length > 0 && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    {myInstancesByType[modelParentType.id].length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {/* Study-level: Grid tradicional com ComparisonTable genérico */}
            <TabsContent value="study" className="mt-4">
              {studyColumns.length > 0 ? (
                <ComparisonTable
                  columns={studyColumns}
                  rows={studyColumns.map(c => c.id)}
                  currentUser={currentUser}
                  otherUsers={otherUsers}
                  data={comparisonData}
                  showConsensus
                  maxHeight="500px"
                />
              ) : (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Nenhum campo study-level configurado no template.
                  </AlertDescription>
                </Alert>
              )}
            </TabsContent>

            {/* Model-level: Comparação 1:1 com seletores */}
            <TabsContent value="models" className="mt-4">
              {modelParentType ? (
                <ModelLevelComparison
                  modelParentType={modelParentType}
                  entityTypes={entityTypes}
                  myInstances={myInstancesByType}
                  myValues={myValues}
                  otherExtractions={otherExtractions}
                  currentUser={currentUser}
                />
              ) : (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Este template não possui entidade de modelos preditivos.
                  </AlertDescription>
                </Alert>
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

