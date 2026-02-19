/**
 * Editor de Configuracao do Instrumento de Avaliacao
 *
 * Permite visualizar e editar os items de um instrumento de projeto,
 * agrupados por dominio. Baseado no pattern de TemplateConfigEditor.
 *
 * Usa hooks e services existentes:
 * - useProjectInstrument() para carregar dados
 * - updateItem(), deleteItem() do projectAssessmentInstrumentService
 */

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Settings,
  Edit2,
  Save,
  X,
  Loader2,
  Trash2,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { useProjectInstrument } from '@/hooks/assessment/useProjectAssessmentInstruments';
import {
  updateItem,
  deleteItem,
} from '@/services/projectAssessmentInstrumentService';
import { useQueryClient } from '@tanstack/react-query';
import { projectInstrumentKeys } from '@/hooks/assessment/useProjectAssessmentInstruments';
import type { ProjectAssessmentItem } from '@/types/assessment';
import { AddItemDialog } from './AddItemDialog';
import { AllowedValuesList } from '@/components/extraction/dialogs/AllowedValuesList';

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
      toast.error('Adicione pelo menos um nivel permitido');
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
      toast.success('Item atualizado com sucesso');
      setEditingItemId(null);
      invalidateQueries();
    } catch (err) {
      console.error('Erro ao atualizar item:', err);
      toast.error('Erro ao atualizar item');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleRequired = async (item: ProjectAssessmentItem) => {
    try {
      await updateItem(item.id, { required: !item.required });
      toast.success(
        item.required ? 'Item marcado como opcional' : 'Item marcado como obrigatorio'
      );
      invalidateQueries();
    } catch (err) {
      console.error('Erro ao alterar item:', err);
      toast.error('Erro ao alterar item');
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    setDeletingItemId(itemId);
    try {
      await deleteItem(itemId);
      toast.success('Item removido com sucesso');
      invalidateQueries();
    } catch (err) {
      console.error('Erro ao remover item:', err);
      toast.error('Erro ao remover item');
    } finally {
      setDeletingItemId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Carregando configuracao...</span>
      </div>
    );
  }

  if (error || !instrument) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-destructive text-center">
            Erro ao carregar instrumento. Tente novamente.
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
      const domain = item.domain || 'Sem dominio';
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
                Configuracao do Instrumento
              </CardTitle>
              <CardDescription className="mt-2">
                Configure os items de avaliacao de {instrument.name}
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline">
                {totalItems} items ({requiredItems} obrigatorios)
              </Badge>
              <Badge variant="outline">
                {domainEntries.length} dominios
              </Badge>
            </div>
          </div>
        </CardHeader>
      </Card>

      {domainEntries.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-muted-foreground">
              <p className="text-sm font-medium mb-1">Nenhum item configurado</p>
              <p className="text-xs mb-4">
                Este instrumento nao possui items de avaliacao.
              </p>
              <Button variant="outline" onClick={() => setShowAddItemDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Adicionar Item
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
                          {items.length} items
                        </Badge>
                        <Badge variant="secondary">
                          {domainRequired} obrigatorios
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
                                    <Label>Questao</Label>
                                    <Textarea
                                      value={editForm.question}
                                      onChange={(e) =>
                                        setEditForm((f) => ({ ...f, question: e.target.value }))
                                      }
                                      rows={2}
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label>Descricao</Label>
                                    <Textarea
                                      value={editForm.description}
                                      onChange={(e) =>
                                        setEditForm((f) => ({ ...f, description: e.target.value }))
                                      }
                                      rows={2}
                                      placeholder="Descricao ou orientacao para o avaliador"
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label>Niveis Permitidos</Label>
                                    <AllowedValuesList
                                      values={editForm.allowedLevels}
                                      onChange={(levels) =>
                                        setEditForm((f) => ({ ...f, allowedLevels: levels }))
                                      }
                                      disabled={saving}
                                    />
                                    {editForm.allowedLevels.length === 0 && (
                                      <p className="text-xs text-destructive">
                                        Adicione pelo menos um nivel permitido
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
                                    <Label>Obrigatorio</Label>
                                  </div>
                                  <div className="flex gap-2 justify-end">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={handleCancelEdit}
                                      disabled={saving}
                                    >
                                      <X className="h-4 w-4 mr-1" />
                                      Cancelar
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
                                      Salvar
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
                                            Obrigatorio
                                          </Badge>
                                        ) : (
                                          <Badge variant="outline" className="text-xs">
                                            Opcional
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
                                      aria-label="Obrigatorio"
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
              Adicionar Item
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
