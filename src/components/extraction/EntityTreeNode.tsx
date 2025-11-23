/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Componente Recursivo para Renderização de Hierarquia de Extraction
 * 
 * Renderiza entity types e suas instances de forma recursiva,
 * suportando parent-child relationships de qualquer profundidade.
 * 
 * Features:
 * - Expansão/colapso de accordions
 * - Adicionar/remover instâncias
 * - Renderização recursiva de children
 * - Indicadores visuais de hierarquia (indentação)
 * - Badge de contagem de instâncias
 * - Progresso por seção
 */

import { useState } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EntityNode } from '@/types/extraction';
import type { OtherExtraction } from '@/hooks/extraction/colaboracao/useOtherExtractions';
import type { AISuggestion } from '@/hooks/extraction/ai/useAISuggestions';

interface EntityTreeNodeProps {
  node: EntityNode;
  level: number;
  projectId: string;
  articleId: string;
  values: Record<string, any>;
  onValueChange: (instanceId: string, fieldId: string, value: any) => void;
  onAddInstance?: (entityTypeId: string, parentInstanceId?: string | null) => Promise<void>;
  onRemoveInstance?: (instanceId: string) => Promise<void>;
  otherExtractions?: OtherExtraction[];
  aiSuggestions?: Record<string, AISuggestion>;
  onAcceptAI?: (instanceId: string, fieldId: string) => Promise<void>;
  onRejectAI?: (instanceId: string, fieldId: string) => Promise<void>;
}

export function EntityTreeNode({
  node,
  level,
  projectId,
  articleId,
  values,
  onValueChange,
  onAddInstance,
  onRemoveInstance,
  otherExtractions,
  aiSuggestions,
  onAcceptAI,
  onRejectAI
}: EntityTreeNodeProps) {
  const { entityType, instances, children } = node;
  const [addingInstance, setAddingInstance] = useState(false);
  
  // Calcular indentação baseada no nível
  const indent = level * 24; // 24px por nível

  // Calcular progresso desta seção (fields virão de outra fonte, não do entityType)
  const requiredFields = 0; // TODO: Calcular baseado em fields carregados separadamente
  const totalRequired = requiredFields * (entityType.cardinality === 'many' ? instances.length : 1);
  
  const completedRequired = 0; // TODO: Calcular baseado em fields e values reais

  const progressPercentage = totalRequired > 0 ? Math.round((completedRequired / totalRequired) * 100) : 0;
  const isComplete = totalRequired > 0 && completedRequired === totalRequired;

  // Determinar cor da borda
  const borderColor = isComplete 
    ? "border-l-green-500" 
    : completedRequired > 0
    ? "border-l-blue-500"
    : "border-l-slate-300";

  const handleAddInstance = async () => {
    if (!onAddInstance) return;
    
    setAddingInstance(true);
    try {
      // Para entity types com parent, precisamos do parent_instance_id
      // Por simplicidade, assumimos que estamos adicionando ao primeiro parent
      const parentInstanceId = entityType.parent_entity_type_id && instances.length > 0
        ? instances[0].parent_instance_id || null
        : null;
      
      await onAddInstance(entityType.id, parentInstanceId);
    } finally {
      setAddingInstance(false);
    }
  };

  const handleRemoveInstance = async (instanceId: string) => {
    if (!onRemoveInstance) return;
    
    if (confirm('Tem certeza que deseja deletar esta instância? Todos os dados extraídos serão perdidos.')) {
      await onRemoveInstance(instanceId);
    }
  };

  return (
    <div style={{ marginLeft: indent }} className="mb-4">
      <Accordion type="single" collapsible className={cn("bg-white border-l-4", borderColor)}>
        <AccordionItem value={entityType.id} className="border-none">
          <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-slate-50/50">
            <div className="flex items-center justify-between w-full pr-4">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold text-base">{entityType.label}</h3>
                {entityType.cardinality === 'many' && (
                  <Badge variant="outline" className="text-xs">
                    {instances.length} instância{instances.length !== 1 ? 's' : ''}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="font-medium">{completedRequired}/{totalRequired}</span>
                <span>{progressPercentage}%</span>
              </div>
            </div>
          </AccordionTrigger>

          <AccordionContent className="px-6 pb-6">
            <div className="space-y-4">
              
              {/* Sem instâncias */}
              {instances.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>Nenhuma instância criada para esta seção</p>
                  {entityType.cardinality === 'many' && onAddInstance && (
                    <Button 
                      variant="outline" 
                      className="mt-4"
                      onClick={handleAddInstance}
                      disabled={addingInstance}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Adicionar {entityType.label}
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  {/* Renderizar instâncias */}
                  {instances.map((instance, index) => (
                    <Card key={instance.id} className="bg-slate-50">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm flex items-center gap-2">
                            {entityType.cardinality === 'many' && (
                              <Badge variant="outline" className="text-xs">
                                #{index + 1}
                              </Badge>
                            )}
                            {instance.label}
                          </CardTitle>
                          {entityType.cardinality === 'many' && onRemoveInstance && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveInstance(instance.id)}
                              className="h-8 w-8 text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="bg-white">
                        {/* Campos desta instância */}
                        <div className="text-sm text-muted-foreground p-4">
                          Fields renderizados pelo componente pai (FieldsManager)
                        </div>

                        {/* RECURSÃO: Renderizar children desta instância */}
                        {children.length > 0 && (
                          <div className="mt-4 space-y-2">
                            {children
                              .filter(childNode => 
                                childNode.instances.some(i => i.parent_instance_id === instance.id)
                              )
                              .map(childNode => (
                                <EntityTreeNode
                                  key={childNode.entityType.id}
                                  node={{
                                    ...childNode,
                                    instances: childNode.instances.filter(
                                      i => i.parent_instance_id === instance.id
                                    )
                                  }}
                                  level={level + 1}
                                  projectId={projectId}
                                  articleId={articleId}
                                  values={values}
                                  onValueChange={onValueChange}
                                  onAddInstance={onAddInstance}
                                  onRemoveInstance={onRemoveInstance}
                                  otherExtractions={otherExtractions}
                                  aiSuggestions={aiSuggestions}
                                  onAcceptAI={onAcceptAI}
                                  onRejectAI={onRejectAI}
                                />
                              ))
                            }
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}

                  {/* Botão adicionar instância (se cardinality='many') */}
                  {entityType.cardinality === 'many' && onAddInstance && (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={handleAddInstance}
                      disabled={addingInstance}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      {addingInstance ? 'Adicionando...' : `Adicionar ${entityType.label}`}
                    </Button>
                  )}
                </>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}


