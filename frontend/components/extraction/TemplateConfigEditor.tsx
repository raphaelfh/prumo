/**
 * Template configuration editor (refactored)
 *
 * Main change: Works directly with extraction_entity_types
 * instead of "template instances" (is_template=true).
 *
 * Simplifies code and allows natural hierarchy support.
 */

import {useEffect, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Input} from '@/components/ui/input';
import {Accordion, AccordionContent, AccordionItem, AccordionTrigger,} from '@/components/ui/accordion';
import {ChevronRight, Download, Edit2, Loader2, Plus, Save, Settings, Trash2, X} from 'lucide-react';
import {toast} from 'sonner';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';
import {FieldsManager} from './FieldsManager';
import {AddSectionDialog, ImportTemplateDialog, RemoveSectionDialog} from './dialogs';
import {ExtractionEntityType} from '@/types/extraction';

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
        console.warn('📦 Carregando entity types do template:', templateId);

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

        console.warn(`✅ Entity types encontrados: ${(entityTypesData || []).length}`);

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
        toast.error(`${t('common', 'error')}: ${err.message}`);
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

        toast.success(t('extraction', 'labelUpdatedSuccess'));
      setEditingId(null);
      await loadEntityTypes();
    } catch (err: any) {
      console.error('Erro ao atualizar label:', err);
        toast.error(`${t('common', 'error')}: ${err.message}`);
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
          <span className="ml-3 text-muted-foreground">{t('extraction', 'loadingConfiguration')}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                  Template configuration
              </CardTitle>
              <CardDescription className="mt-2">
                  Configure sections and fields used for data extraction
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
                  {entityTypes.length} sections ({rootEntityTypes.length} main)
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
                  <AccordionTrigger className="px-6 py-4 min-h-[44px] hover:no-underline">
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
                                {children.length} sub-sections
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">
                          {(entityType as any).fieldsCount || 0} {t('extraction', 'fieldsCountLabel')}
                      </Badge>
                      <Badge variant="outline">
                          {entityType.cardinality === 'one' ? t('extraction', 'cardinalityUnique') : t('extraction', 'cardinalityMultiple')}
                      </Badge>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <CardContent className="pt-4 space-y-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="text-sm text-muted-foreground min-w-0">
                          <p><strong>{t('extraction', 'technicalName')}:</strong> {entityType.name}</p>
                        <p className="mt-1">
                            <strong>{t('extraction', 'typeLabel')}:</strong> {entityType.cardinality === 'one' ? t('extraction', 'sectionSingle') : t('extraction', 'sectionMultiple')}
                        </p>
                        {entityType.description && (
                          <p className="mt-1">{entityType.description}</p>
                        )}
                      </div>
                          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                        {editingId === entityType.id ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => handleSaveEdit(entityType.id)}
                              className="gap-1"
                            >
                              <Save className="h-4 w-4" />
                                {t('common', 'save')}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={handleCancelEdit}
                              className="gap-1"
                            >
                              <X className="h-4 w-4" />
                                {t('common', 'cancel')}
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
                                {t('extraction', 'editLabelButton')}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRemoveSection(entityType)}
                              className="gap-1 text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                                {t('extraction', 'removeButton')}
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

                      {/* Children of this entity type (sub-sections) */}
                    {hasChildren && (
                      <div className="border-t pt-4 mt-4">
                        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                          <ChevronRight className="h-4 w-4" />
                            {t('extraction', 'subSections')} ({children.length})
                        </h4>
                        <div className="space-y-3 pl-4">
                          {children.map((child) => (
                            <Card key={child.id} className="bg-slate-50">
                              <CardHeader className="pb-3">
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                  <div>
                                    <CardTitle className="text-sm">{child.label}</CardTitle>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {child.name} • {child.cardinality === 'many' ? t('extraction', 'cardinalityMultiple') : t('extraction', 'cardinalityUnique')}
                                    </p>
                                  </div>
                                  <Badge variant="outline" className="text-xs">
                                      {(child as any).fieldsCount || 0} {t('extraction', 'fieldsCountLabel')}
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
                <p className="text-sm font-medium mb-1">{t('extraction', 'noSectionsConfigured')}</p>
              <p className="text-xs mb-4">
                  Import a global template or create custom sections
              </p>
                <div className="flex flex-wrap gap-2 justify-center">
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
                    {t('extraction', 'addSection')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

        {/* Add section button */}
      {entityTypes.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <Button 
                variant="outline" 
                onClick={() => setShowAddSectionDialog(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                  {t('extraction', 'addNewSection')}
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

