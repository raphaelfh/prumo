/**
 * Editor de Configuração do Template
 * 
 * Permite ao usuário gerenciar:
 * - Instâncias template (modelos de entidades)
 * - Campos de cada entidade
 * - Labels e descrições customizadas
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { 
  Settings, 
  Plus, 
  Edit2, 
  Save,
  X,
  Loader2,
  Trash2,
  Download
} from 'lucide-react';
import { toast } from 'sonner';
import { FieldsManager } from './FieldsManager';
import { AddSectionDialog, RemoveSectionDialog, ImportTemplateDialog } from './dialogs';

interface TemplateConfigEditorProps {
  projectId: string;
  templateId: string;
}

interface TemplateInstance {
  id: string;
  label: string;
  entity_type_id: string;
  entity_name: string;
  entity_label: string;
  cardinality: string;
  sort_order: number;
  num_fields: number;
}

export function TemplateConfigEditor({ projectId, templateId }: TemplateConfigEditorProps) {
  const [instances, setInstances] = useState<TemplateInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [showAddSectionDialog, setShowAddSectionDialog] = useState(false);
  const [removingSectionId, setRemovingSectionId] = useState<string | null>(null);
  const [removingSectionName, setRemovingSectionName] = useState('');
  const [showImportDialog, setShowImportDialog] = useState(false);

  useEffect(() => {
    if (projectId && templateId) {
      loadTemplateInstances();
    }
  }, [projectId, templateId]);

  const loadTemplateInstances = async () => {
    setLoading(true);
    
    try {
      // Buscar instâncias template
      const { data: instancesData, error: instancesError } = await supabase
        .from('extraction_instances')
        .select('id, label, entity_type_id, sort_order')
        .eq('project_id', projectId)
        .eq('template_id', templateId)
        .eq('is_template', true)
        .order('sort_order', { ascending: true });

      if (instancesError) {
        console.error('Erro ao buscar instâncias:', instancesError);
        throw instancesError;
      }

      if (!instancesData || instancesData.length === 0) {
        setInstances([]);
        return;
      }

      // Buscar dados das entidades e campos
      const instancesWithDetails = await Promise.all(
        instancesData.map(async (instance) => {
          // Buscar entidade
          const { data: entityData, error: entityError } = await supabase
            .from('extraction_entity_types')
            .select('name, label, cardinality')
            .eq('id', instance.entity_type_id)
            .single();

          if (entityError) {
            console.error('Erro ao buscar entidade:', entityError);
            return null;
          }

          // Buscar contagem de campos
          const { count } = await supabase
            .from('extraction_fields')
            .select('id', { count: 'exact', head: true })
            .eq('entity_type_id', instance.entity_type_id);

          return {
            id: instance.id,
            label: instance.label,
            entity_type_id: instance.entity_type_id,
            entity_name: entityData.name,
            entity_label: entityData.label,
            cardinality: entityData.cardinality,
            sort_order: instance.sort_order,
            num_fields: count || 0,
          };
        })
      );

      // Filtrar nulls
      const validInstances = instancesWithDetails.filter(i => i !== null) as TemplateInstance[];
      setInstances(validInstances);
    } catch (err: any) {
      console.error('Erro ao carregar instâncias template:', err);
      toast.error(`Erro: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStartEdit = (instance: TemplateInstance) => {
    setEditingId(instance.id);
    setEditLabel(instance.label);
  };

  const handleSaveEdit = async (instanceId: string) => {
    try {
      const { error } = await supabase
        .from('extraction_instances')
        .update({ label: editLabel })
        .eq('id', instanceId);

      if (error) throw error;

      toast.success('Label atualizado com sucesso');
      setEditingId(null);
      await loadTemplateInstances();
    } catch (err: any) {
      console.error('Erro ao atualizar label:', err);
      toast.error(`Erro: ${err.message}`);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditLabel('');
  };

  const handleSectionAdded = async () => {
    console.log('🔄 Recarregando seções após criação...');
    await loadTemplateInstances();
  };

  const handleRemoveSection = (instance: TemplateInstance) => {
    console.log('🗑️ Preparando remoção de seção:', instance.label);
    setRemovingSectionId(instance.id);
    setRemovingSectionName(instance.label);
  };

  const handleSectionRemoved = async () => {
    console.log('🔄 Recarregando seções após remoção...');
    setRemovingSectionId(null);
    setRemovingSectionName('');
    await loadTemplateInstances();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Carregando configuração...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Configuração do Template
              </CardTitle>
              <CardDescription className="mt-2">
                Configure as seções e campos que serão usados na extração de dados
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowImportDialog(true)}
                className="text-muted-foreground hover:text-foreground"
              >
                <Download className="h-4 w-4 mr-2" />
                Importar Template
              </Button>
              <Badge variant="outline">
                {instances.length} seções configuradas
              </Badge>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Accordion type="single" collapsible className="space-y-2">
        {instances.map((instance) => (
          <AccordionItem key={instance.id} value={instance.id}>
            <Card>
              <AccordionTrigger className="px-6 py-4 hover:no-underline">
                <div className="flex items-center justify-between w-full pr-4">
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary" className="font-mono text-xs">
                      {instance.sort_order}
                    </Badge>
                    {editingId === instance.id ? (
                      <Input
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="max-w-xs"
                      />
                    ) : (
                      <span className="font-medium">{instance.label}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {instance.num_fields} campos
                    </Badge>
                    <Badge variant="outline">
                      {instance.cardinality === 'one' ? 'Único' : 'Múltiplo'}
                    </Badge>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <CardContent className="pt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      <p><strong>Nome técnico:</strong> {instance.entity_name}</p>
                      <p className="mt-1"><strong>Tipo:</strong> {instance.cardinality === 'one' ? 'Seção única' : 'Seção múltipla'}</p>
                    </div>
                    <div className="flex gap-2">
                      {editingId === instance.id ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() => handleSaveEdit(instance.id)}
                            className="gap-1"
                          >
                            <Save className="h-4 w-4" />
                            Salvar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleCancelEdit}
                            className="gap-1"
                          >
                            <X className="h-4 w-4" />
                            Cancelar
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleStartEdit(instance)}
                            className="gap-1"
                          >
                            <Edit2 className="h-4 w-4" />
                            Editar Label
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRemoveSection(instance)}
                            className="gap-1 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                            Remover
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="border-t pt-4">
                    <FieldsManager 
                      entityTypeId={instance.entity_type_id}
                      sectionName={instance.label}
                    />
                  </div>
                </CardContent>
              </AccordionContent>
            </Card>
          </AccordionItem>
        ))}
      </Accordion>

      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">
            <Plus className="h-8 w-8 mx-auto mb-2 text-primary" />
            <p className="text-sm font-medium">Adicionar nova seção</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Crie seções personalizadas para seu projeto
            </p>
            <Button 
              variant="outline" 
              size="sm" 
              className="mt-2"
              onClick={() => setShowAddSectionDialog(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Adicionar Seção
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Dialog para adicionar nova seção */}
      <AddSectionDialog
        projectId={projectId}
        templateId={templateId}
        open={showAddSectionDialog}
        onOpenChange={setShowAddSectionDialog}
        onSectionAdded={handleSectionAdded}
      />

      {/* Dialog para remover seção */}
      <RemoveSectionDialog
        projectId={projectId}
        templateId={templateId}
        sectionId={removingSectionId}
        sectionName={removingSectionName}
        open={!!removingSectionId}
        onOpenChange={(open) => {
          if (!open) {
            setRemovingSectionId(null);
            setRemovingSectionName('');
          }
        }}
        onSectionRemoved={handleSectionRemoved}
      />

      {/* Dialog para importar template */}
      <ImportTemplateDialog
        projectId={projectId}
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onTemplateImported={() => {
          // Recarregar página para atualizar templates
          window.location.reload();
        }}
      />
    </div>
  );
}
