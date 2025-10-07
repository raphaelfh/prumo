/**
 * Componente para editar instâncias de extração
 * 
 * Permite criar, editar e gerenciar instâncias de entidades
 * para extração de dados de artigos.
 */

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  FileText, 
  Plus, 
  Edit, 
  Trash2,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { 
  ProjectExtractionTemplate, 
  ExtractionInstance, 
  ExtractedValue 
} from '@/types/extraction';

interface InstanceEditorProps {
  projectId: string;
  template: ProjectExtractionTemplate | null;
  instances: ExtractionInstance[];
  values: ExtractedValue[];
  onInstanceCreate: (entityTypeId: string, label: string, parentInstanceId?: string) => Promise<ExtractionInstance | null>;
  onInstanceUpdate: (instanceId: string, updates: Partial<ExtractionInstance>) => Promise<ExtractionInstance | null>;
  onInstanceDelete: (instanceId: string) => Promise<boolean>;
  onValueSave: (instanceId: string, fieldId: string, value: any, source?: any, confidenceScore?: number, evidenceData?: any[]) => Promise<ExtractedValue | null>;
  onValueUpdate: (valueId: string, updates: Partial<ExtractedValue>) => Promise<ExtractedValue | null>;
  onValueDelete: (valueId: string) => Promise<boolean>;
  loading: boolean;
}

export function InstanceEditor({
  projectId,
  template,
  instances,
  values,
  onInstanceCreate,
  onInstanceUpdate,
  onInstanceDelete,
  onValueSave,
  onValueUpdate,
  onValueDelete,
  loading
}: InstanceEditorProps) {
  if (!template) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-8">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h4 className="font-medium mb-2">Nenhum template selecionado</h4>
            <p className="text-sm text-muted-foreground">
              Selecione um template de extração para começar a trabalhar
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Editor de Instâncias</h3>
          <p className="text-sm text-muted-foreground">
            Gerencie instâncias de entidades para o template {template.name}
          </p>
        </div>
        <Button disabled={loading}>
          <Plus className="h-4 w-4 mr-2" />
          Nova Instância
        </Button>
      </div>

      {/* Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total de Instâncias</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{instances.length}</div>
            <p className="text-xs text-muted-foreground">
              instâncias criadas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Valores Extraídos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{values.length}</div>
            <p className="text-xs text-muted-foreground">
              valores preenchidos
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Progresso</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {instances.length > 0 ? Math.round((values.length / (instances.length * 5)) * 100) : 0}%
            </div>
            <p className="text-xs text-muted-foreground">
              de completude
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Lista de Instâncias */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <FileText className="h-5 w-5" />
            <span>Instâncias</span>
          </CardTitle>
          <CardDescription>
            Instâncias de entidades criadas para extração
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto mb-2"></div>
                <p className="text-sm text-muted-foreground">Carregando instâncias...</p>
              </div>
            </div>
          ) : instances.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h4 className="font-medium mb-2">Nenhuma instância criada</h4>
              <p className="text-sm text-muted-foreground mb-4">
                Crie instâncias de entidades para começar a extrair dados
              </p>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Criar Primeira Instância
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {instances.map((instance) => {
                const instanceValues = values.filter(v => v.instance_id === instance.id);
                const completionPercentage = Math.round((instanceValues.length / 5) * 100); // Placeholder

                return (
                  <div
                    key={instance.id}
                    className="p-4 border rounded-lg hover:border-primary/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="flex items-center space-x-2">
                          {completionPercentage === 100 ? (
                            <CheckCircle className="h-5 w-5 text-green-500" />
                          ) : (
                            <AlertCircle className="h-5 w-5 text-orange-500" />
                          )}
                          <div>
                            <h4 className="font-medium">{instance.label}</h4>
                            <p className="text-sm text-muted-foreground">
                              {instanceValues.length} valores preenchidos
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge variant="outline">
                          {completionPercentage}% completo
                        </Badge>
                        <Button size="sm" variant="outline">
                          <Edit className="h-4 w-4 mr-2" />
                          Editar
                        </Button>
                        <Button size="sm" variant="outline" className="text-destructive">
                          <Trash2 className="h-4 w-4 mr-2" />
                          Excluir
                        </Button>
                      </div>
                    </div>
                    
                    {/* Progress bar */}
                    <div className="mt-3">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all"
                          style={{ width: `${completionPercentage}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Placeholder para formulário de edição */}
      <Card>
        <CardHeader>
          <CardTitle>Editor de Campos</CardTitle>
          <CardDescription>
            Preencha os valores para os campos da instância selecionada
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Edit className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h4 className="font-medium mb-2">Selecione uma instância</h4>
            <p className="text-sm text-muted-foreground">
              Clique em uma instância acima para editar seus campos
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
