/**
 * Editor de Configuração do Template (REFATORADO)
 * 
 * Mudança principal: Trabalha diretamente com extraction_entity_types
 * ao invés de usar "template instances" (is_template=true).
 * 
 * Isso simplifica o código e permite suporte natural a hierarquia.
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
  Download,
  ChevronRight
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { FieldsManager } from './FieldsManager';
import { AddSectionDialog, RemoveSectionDialog, ImportTemplateDialog } from './dialogs';
import { ExtractionEntityType } from '@/types/extraction';

interface TemplateConfigEditorProps {
  projectId: string;
  templateId: string;
}

export function TemplateConfigEditor({ projectId, templateId }: TemplateConfigEditorProps) {
  const [entityTypes, setEntityTypes] = useState<ExtractionEntityType[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [showAddSectionDialog, setShowAddSectionDialog] = useState(false);
  const [removingSectionId, setRemovingSectionId] = useState<string | null>(null);
  const [removingSectionName, setRemovingSectionName] = useState('');
  const [showImportDialog, setShowImportDialog] = useState(false);

  useEffect(() => {
    if (projectId && templateId) {
      loadEntityTypes();
    }
  }, [projectId, templateId]);

  const loadEntityTypes = async () => {
    setLoading(true);
    
    try {
      console.log('📦 Carregando entity types do template:', templateId);

      // Buscar entity types do project_template
      const { data: entityTypesData, error: entityTypesError } = await supabase
        .from('extraction_entity_types')
        .select('*, extraction_fields(count)')
        .eq('project_template_id', templateId)
        .order('sort_order', { ascending: true });

      if (entityTypesError) {
        console.error('❌ Erro ao buscar entity types:', entityTypesError);
        throw entityTypesError;
      }

      console.log(`✅ Entity types encontrados: ${(entityTypesData || []).length}`);

      // Para cada entity type, contar fields
      const entityTypesWithCounts = await Promise.all(
        (entityTypesData || []).map(async (et) => {
          const { count, error: countError } = await supabase
            .from('extraction_fields')
            .select('*', { count: 'exact', head: true })
            .eq('entity_type_id', et.id);

          if (countError) {
            console.error(`Erro ao contar fields de ${et.name}:`, countError);
          }

          return {
            ...et,
            fieldsCount: count || 0
          };
        })
      );

      setEntityTypes(entityTypesWithCounts as ExtractionEntityType[]);
    } catch (err: any) {
      console.error('Erro ao carregar entity types:', err);
      toast.error(`Erro: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStartEdit = (entityType: ExtractionEntityType) => {
    setEditingId(entityType.id);
    setEditLabel(entityType.label);
  };

  const handleSaveEdit = async (entityTypeId: string) => {
    try {
      const { error } = await supabase
        .from('extraction_entity_types')
        .update({ label: editLabel })
        .eq('id', entityTypeId);

      if (error) throw error;

      toast.success('Label atualizado com sucesso');
      setEditingId(null);
      await loadEntityTypes();
    } catch (err: any) {
      console.error('Erro ao atualizar label:', err);
      toast.error(`Erro: ${err.message}`);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditLabel('');
  };

  const handleRemoveSection = (entityType: ExtractionEntityType) => {
    setRemovingSectionId(entityType.id);
    setRemovingSectionName(entityType.label);
  };

  const handleSectionAdded = () => {
    setShowAddSectionDialog(false);
    loadEntityTypes();
  };

  const handleSectionRemoved = () => {
    setRemovingSectionId(null);
    setRemovingSectionName('');
    loadEntityTypes();
  };

  // Organizar entity types por hierarquia
  const rootEntityTypes = entityTypes.filter(et => !et.parent_entity_type_id);
  const childEntityTypes = entityTypes.filter(et => et.parent_entity_type_id);

  // Map de children por parent
  const childrenByParent: Record<string, ExtractionEntityType[]> = {};
  childEntityTypes.forEach(child => {
    if (child.parent_entity_type_id) {
      if (!childrenByParent[child.parent_entity_type_id]) {
        childrenByParent[child.parent_entity_type_id] = [];
      }
      childrenByParent[child.parent_entity_type_id].push(child);
    }
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Carregando configuração...</span>
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
                {entityTypes.length} seções ({rootEntityTypes.length} principais)
              </Badge>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Accordion type="single" collapsible className="space-y-2">
        {rootEntityTypes.map((entityType) => {
          const children = childrenByParent[entityType.id] || [];
          const hasChildren = children.length > 0;
          
          return (
            <AccordionItem key={entityType.id} value={entityType.id}>
              <Card className={cn(hasChildren && "border-l-4 border-l-primary")}>
                <AccordionTrigger className="px-6 py-4 hover:no-underline">
                  <div className="flex items-center justify-between w-full pr-4">
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary" className="font-mono text-xs">
                        {entityType.sort_order}
                      </Badge>
                      {editingId === entityType.id ? (
                        <Input
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className="max-w-xs"
                          autoFocus
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{entityType.label}</span>
                          {hasChildren && (
                            <Badge variant="secondary" className="text-xs">
                              {children.length} sub-seções
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">
                        {(entityType as any).fieldsCount || 0} campos
                      </Badge>
                      <Badge variant="outline">
                        {entityType.cardinality === 'one' ? 'Único' : 'Múltiplo'}
                      </Badge>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <CardContent className="pt-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">
                        <p><strong>Nome técnico:</strong> {entityType.name}</p>
                        <p className="mt-1">
                          <strong>Tipo:</strong> {entityType.cardinality === 'one' ? 'Seção única' : 'Seção múltipla'}
                        </p>
                        {entityType.description && (
                          <p className="mt-1">{entityType.description}</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {editingId === entityType.id ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => handleSaveEdit(entityType.id)}
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
                              onClick={() => handleStartEdit(entityType)}
                              className="gap-1"
                            >
                              <Edit2 className="h-4 w-4" />
                              Editar Label
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRemoveSection(entityType)}
                              className="gap-1 text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                              Remover
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Campos deste entity type */}
                    <div className="border-t pt-4">
                      <FieldsManager 
                        entityTypeId={entityType.id}
                        sectionName={entityType.label}
                      />
                    </div>

                    {/* Children deste entity type (sub-seções) */}
                    {hasChildren && (
                      <div className="border-t pt-4 mt-4">
                        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                          <ChevronRight className="h-4 w-4" />
                          Sub-seções ({children.length})
                        </h4>
                        <div className="space-y-3 pl-4">
                          {children.map((child) => (
                            <Card key={child.id} className="bg-slate-50">
                              <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <CardTitle className="text-sm">{child.label}</CardTitle>
                                    <p className="text-xs text-muted-foreground mt-1">
                                      {child.name} • {child.cardinality === 'many' ? 'Múltiplo' : 'Único'}
                                    </p>
                                  </div>
                                  <Badge variant="outline" className="text-xs">
                                    {(child as any).fieldsCount || 0} campos
                                  </Badge>
                                </div>
                              </CardHeader>
                              <CardContent>
                                <FieldsManager 
                                  entityTypeId={child.id}
                                  sectionName={child.label}
                                />
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </AccordionContent>
              </Card>
            </AccordionItem>
          );
        })}
      </Accordion>

      {entityTypes.length === 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-muted-foreground">
              <Plus className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-sm font-medium mb-1">Nenhuma seção configurada</p>
              <p className="text-xs mb-4">
                Importe um template global ou crie seções personalizadas
              </p>
              <div className="flex gap-2 justify-center">
                <Button 
                  variant="outline" 
                  onClick={() => setShowImportDialog(true)}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Importar Template
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => setShowAddSectionDialog(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Adicionar Seção
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Botão adicionar seção */}
      {entityTypes.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <Button 
                variant="outline" 
                onClick={() => setShowAddSectionDialog(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Adicionar Nova Seção
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dialogs */}
      <AddSectionDialog
        projectId={projectId}
        templateId={templateId}
        open={showAddSectionDialog}
        onOpenChange={setShowAddSectionDialog}
        onSectionAdded={handleSectionAdded}
      />

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

      <ImportTemplateDialog
        projectId={projectId}
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onTemplateImported={() => {
          setShowImportDialog(false);
          loadEntityTypes();
        }}
      />
    </div>
  );
}

