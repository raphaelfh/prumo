/**
 * Gerenciador de Campos de uma Seção
 * 
 * Permite visualizar e editar os campos de uma seção/entidade.
 * Agora com CRUD completo: adicionar, editar, remover campos.
 * 
 * Features:
 * - Listagem de campos em tabela
 * - Edição inline (label, description, is_required)
 * - Adicionar novo campo (dialog)
 * - Remover campo com validação (dialog)
 * - Controle de permissões (manager vs reviewer)
 * 
 * @component
 */

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Edit2, Save, X, Loader2, Plus, Trash2, Lock } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useFieldManagement } from '@/hooks/extraction/useFieldManagement';
import { AddFieldDialog } from './dialogs/AddFieldDialog';
import { DeleteFieldConfirm } from './dialogs/DeleteFieldConfirm';
import { EditFieldDialog } from './dialogs/EditFieldDialog';
import { useProject } from '@/contexts/ProjectContext';
import type { ExtractionField, FieldValidationResult } from '@/types/extraction';

interface FieldsManagerProps {
  entityTypeId: string;
  sectionName?: string;
}

export function FieldsManager({ entityTypeId, sectionName }: FieldsManagerProps) {
  const { project } = useProject();
  const projectId = project?.id || '';

  const {
    fields,
    loading,
    canEdit,
    canCreate,
    canDelete,
    userRole,
    addField,
    updateField,
    deleteField,
    validateField,
  } = useFieldManagement({ entityTypeId, projectId });

  // Estados locais para edição inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<ExtractionField>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  // Estados para dialogs
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [fieldToEdit, setFieldToEdit] = useState<ExtractionField | null>(null);
  const [fieldToDelete, setFieldToDelete] = useState<ExtractionField | null>(null);
  const [deleteValidation, setDeleteValidation] = useState<FieldValidationResult | null>(null);
  const [validatingDelete, setValidatingDelete] = useState(false);

  const handleStartEdit = (field: ExtractionField) => {
    setEditingId(field.id);
    setEditData({
      label: field.label,
      description: field.description,
      is_required: field.is_required,
    });
  };

  const handleSaveEdit = async (fieldId: string) => {
    setSavingEdit(true);
    try {
      await updateField(fieldId, editData);
      setEditingId(null);
      setEditData({});
    } finally {
      setSavingEdit(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditData({});
  };

  const handleOpenEditDialog = (field: ExtractionField) => {
    setFieldToEdit(field);
    setShowEditDialog(true);
  };

  const handleOpenDeleteDialog = async (field: ExtractionField) => {
    setValidatingDelete(true);
    setFieldToDelete(field);
    
    try {
      const validation = await validateField(field.id);
      setDeleteValidation(validation);
    } catch (err) {
      console.error('Erro ao validar campo para exclusão:', err);
      setDeleteValidation({
        canDelete: false,
        canUpdate: false,
        canChangeType: false,
        extractedValuesCount: 0,
        affectedArticles: [],
        message: 'Erro ao validar campo',
      });
    } finally {
      setValidatingDelete(false);
    }
  };

  const handleConfirmDelete = async (fieldId: string) => {
    return await deleteField(fieldId);
  };

  const getFieldTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      text: 'Texto',
      number: 'Número',
      date: 'Data',
      select: 'Seleção',
      multiselect: 'Múltipla Escolha',
      boolean: 'Sim/Não',
    };
    return labels[type] || type;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Carregando campos...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header com ações */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium">
            Campos desta seção ({fields.length})
          </h4>
          {userRole && (
            <Badge variant="outline" className="text-xs">
              {userRole === 'manager' ? '👑 Manager' : userRole === 'reviewer' ? '📝 Reviewer' : '👁️ Viewer'}
            </Badge>
          )}
        </div>
        
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <Button
                  size="sm"
                  onClick={() => setShowAddDialog(true)}
                  disabled={!canCreate}
                  className="gap-2"
                >
                  {canCreate ? (
                    <>
                      <Plus className="h-4 w-4" />
                      Adicionar Campo
                    </>
                  ) : (
                    <>
                      <Lock className="h-4 w-4" />
                      Adicionar Campo
                    </>
                  )}
                </Button>
              </div>
            </TooltipTrigger>
            {!canCreate && (
              <TooltipContent>
                <p>Apenas managers podem adicionar campos</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Tabela de campos */}
      {fields.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground mb-4">
                Nenhum campo nesta seção
              </p>
              {canCreate && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddDialog(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Adicionar Primeiro Campo
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">#</TableHead>
              <TableHead>Campo</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-center">Obrigatório</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((field, index) => (
              <TableRow key={field.id}>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {index + 1}
                </TableCell>
                <TableCell>
                  {editingId === field.id ? (
                    <div className="space-y-2">
                      <Input
                        value={editData.label || ''}
                        onChange={(e) => setEditData({ ...editData, label: e.target.value })}
                        placeholder="Label do campo"
                        disabled={savingEdit}
                      />
                      <Textarea
                        value={editData.description || ''}
                        onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                        placeholder="Descrição"
                        rows={2}
                        className="text-sm"
                        disabled={savingEdit}
                      />
                    </div>
                  ) : (
                    <div>
                      <div className="font-medium">{field.label}</div>
                      {field.description && (
                        <div className="text-sm text-muted-foreground mt-1">
                          {field.description}
                        </div>
                      )}
                      {field.unit && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Unidade: <span className="font-mono">{field.unit}</span>
                        </div>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="font-mono text-xs">
                    {getFieldTypeLabel(field.field_type)}
                  </Badge>
                </TableCell>
                <TableCell className="text-center">
                  {editingId === field.id ? (
                    <Switch
                      checked={editData.is_required ?? field.is_required}
                      onCheckedChange={(checked) =>
                        setEditData({ ...editData, is_required: checked })
                      }
                      disabled={savingEdit}
                    />
                  ) : (
                    <Badge variant={field.is_required ? 'default' : 'outline'}>
                      {field.is_required ? 'Sim' : 'Não'}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {editingId === field.id ? (
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleSaveEdit(field.id)}
                        disabled={savingEdit}
                        className="gap-1"
                      >
                        {savingEdit ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Save className="h-3 w-3" />
                        )}
                        Salvar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleCancelEdit}
                        disabled={savingEdit}
                        className="gap-1"
                      >
                        <X className="h-3 w-3" />
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-1">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleStartEdit(field)}
                                disabled={!canEdit}
                                className="gap-1"
                              >
                                {canEdit ? (
                                  <Edit2 className="h-3 w-3" />
                                ) : (
                                  <Lock className="h-3 w-3" />
                                )}
                              </Button>
                            </div>
                          </TooltipTrigger>
                          {!canEdit && (
                            <TooltipContent>
                              <p>Apenas managers podem editar</p>
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TooltipProvider>

                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleOpenDeleteDialog(field)}
                                disabled={!canDelete || validatingDelete}
                                className="gap-1 text-destructive hover:text-destructive"
                              >
                                {validatingDelete ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : canDelete ? (
                                  <Trash2 className="h-3 w-3" />
                                ) : (
                                  <Lock className="h-3 w-3" />
                                )}
                              </Button>
                            </div>
                          </TooltipTrigger>
                          {!canDelete && !validatingDelete && (
                            <TooltipContent>
                              <p>Apenas managers podem excluir</p>
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Dialogs */}
      <AddFieldDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSave={addField}
        sectionName={sectionName}
      />

      <EditFieldDialog
        field={fieldToEdit}
        open={showEditDialog}
        onOpenChange={(open) => {
          setShowEditDialog(open);
          if (!open) setFieldToEdit(null);
        }}
        onSave={updateField}
        onValidate={validateField}
        sectionName={sectionName}
      />

      <DeleteFieldConfirm
        field={fieldToDelete}
        open={!!fieldToDelete}
        onOpenChange={(open) => {
          if (!open) {
            setFieldToDelete(null);
            setDeleteValidation(null);
          }
        }}
        onConfirm={handleConfirmDelete}
        validation={deleteValidation}
        loading={false}
      />
    </div>
  );
}
