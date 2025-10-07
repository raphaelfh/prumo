/**
 * Componente para gerenciar templates de extração
 * 
 * Permite clonar templates globais, criar templates customizados
 * e gerenciar templates ativos do projeto.
 */

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Database, 
  Copy, 
  Plus, 
  Settings, 
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { 
  ProjectExtractionTemplate, 
  ExtractionTemplateOption 
} from '@/types/extraction';

interface TemplateManagerProps {
  projectId: string;
  templates: ProjectExtractionTemplate[];
  activeTemplate: ProjectExtractionTemplate | null;
  onTemplateSelect: (template: ProjectExtractionTemplate) => void;
  onTemplateClone: (globalTemplateId: string, customName?: string) => Promise<ProjectExtractionTemplate | null>;
  onTemplateCreate: (name: string, description: string, framework: 'CHARMS' | 'PICOS' | 'CUSTOM') => Promise<ProjectExtractionTemplate | null>;
  loading: boolean;
}

export function TemplateManager({
  projectId,
  templates,
  activeTemplate,
  onTemplateSelect,
  onTemplateClone,
  onTemplateCreate,
  loading
}: TemplateManagerProps) {
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Templates globais disponíveis (hardcoded por enquanto)
  const globalTemplates: ExtractionTemplateOption[] = [
    {
      id: '03a08505-8857-4d3a-8db5-2808c7dfb528', // ID real do template CHARMS
      name: 'CHARMS',
      description: 'Checklist for critical Appraisal and data extraction for systematic Reviews of prediction Modelling Studies',
      framework: 'CHARMS',
      version: '1.0.0'
    }
  ];

  const handleCloneTemplate = async (globalTemplateId: string, customName?: string) => {
    const result = await onTemplateClone(globalTemplateId, customName);
    if (result) {
      setShowCloneDialog(false);
      onTemplateSelect(result);
    }
  };

  const handleCreateTemplate = async (name: string, description: string, framework: 'CHARMS' | 'PICOS' | 'CUSTOM') => {
    const result = await onTemplateCreate(name, description, framework);
    if (result) {
      setShowCreateDialog(false);
      onTemplateSelect(result);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Gerenciar Templates</h3>
          <p className="text-sm text-muted-foreground">
            Clone templates padrão ou crie templates customizados
          </p>
        </div>
        <div className="flex space-x-2">
          <Button
            onClick={() => setShowCloneDialog(true)}
            variant="outline"
            size="sm"
          >
            <Copy className="h-4 w-4 mr-2" />
            Clonar Template
          </Button>
          <Button
            onClick={() => setShowCreateDialog(true)}
            size="sm"
          >
            <Plus className="h-4 w-4 mr-2" />
            Criar Template
          </Button>
        </div>
      </div>

      {/* Templates do Projeto */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Database className="h-5 w-5" />
            <span>Templates do Projeto</span>
          </CardTitle>
          <CardDescription>
            Templates ativos e disponíveis para este projeto
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto mb-2"></div>
                <p className="text-sm text-muted-foreground">Carregando templates...</p>
              </div>
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-8">
              <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h4 className="font-medium mb-2">Nenhum template encontrado</h4>
              <p className="text-sm text-muted-foreground mb-4">
                Clone um template padrão ou crie um template customizado para começar
              </p>
              <div className="flex justify-center space-x-2">
                <Button
                  onClick={() => setShowCloneDialog(true)}
                  variant="outline"
                  size="sm"
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Clonar Template
                </Button>
                <Button
                  onClick={() => setShowCreateDialog(true)}
                  size="sm"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Criar Template
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                    activeTemplate?.id === template.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                  }`}
                  onClick={() => onTemplateSelect(template)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      {activeTemplate?.id === template.id && (
                        <CheckCircle className="h-5 w-5 text-primary" />
                      )}
                      <div>
                        <h4 className="font-medium">{template.name}</h4>
                        <p className="text-sm text-muted-foreground">
                          {template.description || 'Sem descrição'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge variant="outline">{template.framework}</Badge>
                      <Badge variant="secondary">v{template.version}</Badge>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Criado em {new Date(template.created_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Templates Globais Disponíveis */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Settings className="h-5 w-5" />
            <span>Templates Globais</span>
          </CardTitle>
          <CardDescription>
            Templates padrão disponíveis para clonagem
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {globalTemplates.map((template) => (
              <div
                key={template.id}
                className="p-4 border rounded-lg"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">{template.name}</h4>
                    <p className="text-sm text-muted-foreground">
                      {template.description}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge variant="outline">{template.framework}</Badge>
                    <Button
                      onClick={() => handleCloneTemplate(template.id)}
                      size="sm"
                      variant="outline"
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Clonar
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Dialogs placeholder - serão implementados depois */}
      {showCloneDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Clonar Template</CardTitle>
              <CardDescription>
                Escolha um template global para clonar
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Funcionalidade será implementada em breve
              </p>
              <div className="flex justify-end space-x-2">
                <Button
                  onClick={() => setShowCloneDialog(false)}
                  variant="outline"
                >
                  Cancelar
                </Button>
                <Button onClick={() => setShowCloneDialog(false)}>
                  Clonar
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {showCreateDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Criar Template Customizado</CardTitle>
              <CardDescription>
                Crie um template personalizado para este projeto
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Funcionalidade será implementada em breve
              </p>
              <div className="flex justify-end space-x-2">
                <Button
                  onClick={() => setShowCreateDialog(false)}
                  variant="outline"
                >
                  Cancelar
                </Button>
                <Button onClick={() => setShowCreateDialog(false)}>
                  Criar
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
