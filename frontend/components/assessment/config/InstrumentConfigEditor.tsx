/**
 * Editor de Configuracao do Instrumento de Avaliacao
 *
 * Permite visualizar e editar os items de um instrumento de projeto,
 * grouped by domain. Based on TemplateConfigEditor pattern.
 *
 * Uses existing hooks and services:
 * - useProjectInstrument() to load data
 * - updateItem(), deleteItem() do projectAssessmentInstrumentService
 */

import {useState} from 'react';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Textarea} from '@/components/ui/textarea';
import {Switch} from '@/components/ui/switch';
import {Label} from '@/components/ui/label';
import {Accordion, AccordionContent, AccordionItem, AccordionTrigger,} from '@/components/ui/accordion';
import {Edit2, Loader2, Plus, Save, Settings, Trash2, X,} from 'lucide-react';
import {toast} from 'sonner';
import {projectInstrumentKeys, useProjectInstrument} from '@/hooks/assessment/useProjectAssessmentInstruments';
import {deleteItem, updateItem,} from '@/services/projectAssessmentInstrumentService';
import {useQueryClient} from '@tanstack/react-query';
import type {ProjectAssessmentItem} from '@/types/assessment';
import {AddItemDialog} from './AddItemDialog';
import {AllowedValuesList} from '@/components/extraction/dialogs/AllowedValuesList';
import {t} from '@/lib/copy';

interface InstrumentConfigEditorProps {
  instrumentId: string;
  projectId: string;
}

export function InstrumentConfigEditor({ instrumentId, projectId }: InstrumentConfigEditorProps) {
  const queryClient = useQueryClient();
  const { data: instrument, isLoading, error } = useProjectInstrument(instrumentId);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    question: string;
    description: string;
    required: boolean;
    allowedLevels: string[];
  }>({ question: '', description: '', required: true, allowedLevels: [] });
  const [saving, setSaving] = useState(false);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [showAddItemDialog, setShowAddItemDialog] = useState(false);

  const invalidateQueries = () => {
    queryClient.invalidateQueries({
      queryKey: projectInstrumentKeys.byId(instrumentId),
    });
    queryClient.invalidateQueries({
      queryKey: projectInstrumentKeys.byProject(projectId),
    });
  };

  const handleStartEdit = (item: ProjectAssessmentItem) => {
    setEditingItemId(item.id);
    setEditForm({
      question: item.question,
      description: item.description || '',
      required: item.required,
      allowedLevels: [...item.allowedLevels],
    });
  };

  const handleCancelEdit = () => {
    setEditingItemId(null);
    setEditForm({ question: '', description: '', required: true, allowedLevels: [] });
  };

  const handleSaveEdit = async (itemId: string) => {
    if (editForm.allowedLevels.length === 0) {
        toast.error(t('assessment', 'addItemAddOneLevel'));
      return;
    }
    setSaving(true);
    try {
      await updateItem(itemId, {
        question: editForm.question,
        description: editForm.description || null,
        required: editForm.required,
        allowedLevels: editForm.allowedLevels,
      });
        toast.success(t('assessment', 'configEditorItemUpdated'));
      setEditingItemId(null);
      invalidateQueries();
    } catch (err) {
        console.error('Error updating item:', err);
        toast.error(t('assessment', 'configEditorItemUpdateError'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleRequired = async (item: ProjectAssessmentItem) => {
    try {
      await updateItem(item.id, { required: !item.required });
      toast.success(
          item.required ? t('assessment', 'configEditorItemOptional') : t('assessment', 'configEditorItemRequired')
      );
      invalidateQueries();
    } catch (err) {
        console.error('Error changing item:', err);
        toast.error(t('assessment', 'configEditorItemChangeError'));
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    setDeletingItemId(itemId);
    try {
      await deleteItem(itemId);
        toast.success(t('assessment', 'configEditorItemRemoved'));
      invalidateQueries();
    } catch (err) {
        console.error('Error removing item:', err);
        toast.error(t('assessment', 'configEditorItemRemoveError'));
    } finally {
      setDeletingItemId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-3 text-muted-foreground">{t('assessment', 'configEditorLoading')}</span>
      </div>
    );
  }

  if (error || !instrument) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-destructive text-center">
              {t('assessment', 'configEditorErrorLoad')}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Group items by domain
  const itemsByDomain = new Map<string, ProjectAssessmentItem[]>();
  (instrument.items || [])
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .forEach((item) => {
        const domain = item.domain || t('assessment', 'configEditorNoDomain');
      if (!itemsByDomain.has(domain)) {
        itemsByDomain.set(domain, []);
      }
      itemsByDomain.get(domain)!.push(item);
    });

  const domainEntries = Array.from(itemsByDomain.entries());
  const existingDomains = Array.from(itemsByDomain.keys());
  const totalItems = instrument.items?.length || 0;
  const requiredItems = (instrument.items || []).filter((i) => i.required).length;

  // Compute default allowed levels: use the most common set across items
  const defaultAllowedLevels = (() => {
    const items = instrument.items || [];
    if (items.length === 0) return [];
    const levelCounts = new Map<string, number>();
    items.forEach((item) => {
      const key = JSON.stringify([...item.allowedLevels].sort());
      levelCounts.set(key, (levelCounts.get(key) || 0) + 1);
    });
    let maxKey = '';
    let maxCount = 0;
    levelCounts.forEach((count, key) => {
      if (count > maxCount) {
        maxCount = count;
        maxKey = key;
      }
    });
    return maxKey ? JSON.parse(maxKey) as string[] : [];
  })();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                  {t('assessment', 'configEditorTitle')}
              </CardTitle>
              <CardDescription className="mt-2">
                  {t('assessment', 'configEditorDesc')} {instrument.name}
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline">
                  {totalItems} {t('assessment', 'instrumentItemsLabel')} ({requiredItems} {t('assessment', 'configEditorRequiredCount')})
              </Badge>
              <Badge variant="outline">
                  {domainEntries.length} {t('assessment', 'instrumentDomainsLabel')}
              </Badge>
            </div>
          </div>
        </CardHeader>
      </Card>

      {domainEntries.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-muted-foreground">
                <p className="text-sm font-medium mb-1">{t('assessment', 'configEditorNoItems')}</p>
              <p className="text-xs mb-4">
                  {t('assessment', 'configEditorNoItemsDesc')}
              </p>
              <Button variant="outline" onClick={() => setShowAddItemDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                  {t('assessment', 'addItemTitle')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Accordion type="single" collapsible className="space-y-2">
          {domainEntries.map(([domain, items]) => {
            const domainRequired = items.filter((i) => i.required).length;

            return (
              <AccordionItem key={domain} value={domain}>
                <Card>
                  <AccordionTrigger className="px-6 py-4 hover:no-underline">
                    <div className="flex items-center justify-between w-full pr-4">
                      <div className="flex items-center gap-3">
                        <span className="font-medium">{domain}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                            {items.length} {t('assessment', 'instrumentItemsLabel')}
                        </Badge>
                        <Badge variant="secondary">
                            {domainRequired} {t('assessment', 'configEditorRequiredCount')}
                        </Badge>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <CardContent className="pt-2 space-y-3">
                      {items.map((item) => {
                        const isEditing = editingItemId === item.id;
                        const isDeleting = deletingItemId === item.id;

                        return (
                          <Card
                            key={item.id}
                            className="bg-muted/30"
                          >
                            <CardContent className="pt-4 pb-4">
                              {isEditing ? (
                                <div className="space-y-3">
                                  <div className="space-y-2">
                                      <Label>{t('assessment', 'configEditorQuestionLabel')}</Label>
                                    <Textarea
                                      value={editForm.question}
                                      onChange={(e) =>
                                        setEditForm((f) => ({ ...f, question: e.target.value }))
                                      }
                                      rows={2}
                                    />
                                  </div>
                                  <div className="space-y-2">
                                      <Label>{t('assessment', 'configEditorDescriptionLabel')}</Label>
                                    <Textarea
                                      value={editForm.description}
                                      onChange={(e) =>
                                        setEditForm((f) => ({ ...f, description: e.target.value }))
                                      }
                                      rows={2}
                                      placeholder={t('assessment', 'configEditorDescriptionPlaceholder')}
                                    />
                                  </div>
                                  <div className="space-y-2">
                                      <Label>{t('assessment', 'addItemAllowedLevelsLabel')}</Label>
                                    <AllowedValuesList
                                      values={editForm.allowedLevels}
                                      onChange={(levels) =>
                                        setEditForm((f) => ({ ...f, allowedLevels: levels }))
                                      }
                                      disabled={saving}
                                    />
                                    {editForm.allowedLevels.length === 0 && (
                                      <p className="text-xs text-destructive">
                                          {t('assessment', 'addItemAddOneLevel')}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Switch
                                      checked={editForm.required}
                                      onCheckedChange={(checked) =>
                                        setEditForm((f) => ({ ...f, required: checked }))
                                      }
                                    />
                                      <Label>{t('assessment', 'configEditorRequired')}</Label>
                                  </div>
                                  <div className="flex gap-2 justify-end">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={handleCancelEdit}
                                      disabled={saving}
                                    >
                                      <X className="h-4 w-4 mr-1" />
                                        {t('common', 'cancel')}
                                    </Button>
                                    <Button
                                      size="sm"
                                      onClick={() => handleSaveEdit(item.id)}
                                      disabled={saving}
                                    >
                                      {saving ? (
                                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                      ) : (
                                        <Save className="h-4 w-4 mr-1" />
                                      )}
                                        {t('common', 'save')}
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-start justify-between gap-4">
                                  <div className="flex items-start gap-3 flex-1 min-w-0">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2 mb-1">
                                        <Badge variant="secondary" className="font-mono text-xs shrink-0">
                                          {item.itemCode}
                                        </Badge>
                                        {item.required ? (
                                          <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100 text-xs">
                                              {t('assessment', 'configEditorRequired')}
                                          </Badge>
                                        ) : (
                                          <Badge variant="outline" className="text-xs">
                                              {t('assessment', 'configEditorOptional')}
                                          </Badge>
                                        )}
                                      </div>
                                      <p className="text-sm font-medium">{item.question}</p>
                                      {item.description && (
                                        <p className="text-xs text-muted-foreground mt-1">
                                          {item.description}
                                        </p>
                                      )}
                                      {item.allowedLevels.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-2">
                                          {item.allowedLevels.map((level) => (
                                            <Badge
                                              key={level}
                                              variant="outline"
                                              className="text-xs"
                                            >
                                              {level}
                                            </Badge>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <Switch
                                      checked={item.required}
                                      onCheckedChange={() => handleToggleRequired(item)}
                                      aria-label={t('assessment', 'configEditorRequired')}
                                    />
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleStartEdit(item)}
                                    >
                                      <Edit2 className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleDeleteItem(item.id)}
                                      disabled={isDeleting}
                                      className="text-destructive hover:text-destructive"
                                    >
                                      {isDeleting ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </CardContent>
                  </AccordionContent>
                </Card>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="text-center">
            <Button variant="outline" onClick={() => setShowAddItemDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
                {t('assessment', 'addItemTitle')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <AddItemDialog
        instrumentId={instrumentId}
        existingDomains={existingDomains}
        defaultAllowedLevels={defaultAllowedLevels}
        open={showAddItemDialog}
        onOpenChange={setShowAddItemDialog}
        onItemAdded={() => {
          setShowAddItemDialog(false);
          invalidateQueries();
        }}
      />
    </div>
  );
}

export default InstrumentConfigEditor;
