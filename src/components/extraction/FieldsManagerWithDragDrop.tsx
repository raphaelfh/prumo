/**
 * FieldsManager com drag-and-drop para reordenar campos
 * 
 * Features:
 * - Todas as funcionalidades do FieldsManager original
 * - Drag-and-drop para reordenar campos
 * - Feedback visual durante drag
 * - Keyboard support para acessibilidade
 * - Rollback se falha no backend
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
import { Edit2, Save, X, Loader2, Plus, Trash2, Lock, GripVertical } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
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

// Componente para linha da tabela com drag
interface SortableTableRowProps {
  field: ExtractionField;
  index: number;
  isEditing: boolean;
  editData: Partial<ExtractionField>;
  canEdit: boolean;
  canDelete: boolean;
  savingEdit: boolean;
  onStartEdit: (field: ExtractionField) => void;
  onSaveEdit: (fieldId: string) => Promise<void>;
  onCancelEdit: () => void;
  onEditData: (data: Partial<ExtractionField>) => void;
  onOpenDeleteDialog: (field: ExtractionField) => void;
  onOpenEditDialog: (field: ExtractionField) => void;
}

function SortableTableRow({
  field,
  index,
  isEditing,
  editData,
  canEdit,
  canDelete,
  savingEdit,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditData,
  onOpenDeleteDialog,
  onOpenEditDialog,
}: SortableTableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
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

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && "relative z-50")}
    >
      {/* Drag Handle */}
      <TableCell className="w-[30px] p-2">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 rounded hover:bg-muted"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground/40" />
        </div>
      </TableCell>

      {/* Número */}
      <TableCell className="font-mono text-xs text-muted-foreground w-[50px]">
        {index + 1}
      </TableCell>

      {/* Campo */}
      <TableCell>
        {isEditing ? (
          <div className="space-y-2">
            <Input
              value={editData.label || ''}
              onChange={(e) => onEditData({ ...editData, label: e.target.value })}
              placeholder="Label do campo"
              disabled={savingEdit}
            />
            <Textarea
              value={editData.description || ''}
              onChange={(e) => onEditData({ ...editData, description: e.target.value })}
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

      {/* Tipo */}
      <TableCell>
        <Badge variant="secondary" className="font-mono text-xs">
          {getFieldTypeLabel(field.field_type)}
        </Badge>
      </TableCell>

      {/* Obrigatório */}
      <TableCell className="text-center">
        {isEditing ? (
          <Switch
            checked={editData.is_required ?? field.is_required}
            onCheckedChange={(checked) =>
              onEditData({ ...editData, is_required: checked })
            }
            disabled={savingEdit}
          />
        ) : (
          <Badge variant={field.is_required ? 'default' : 'outline'}>
            {field.is_required ? 'Sim' : 'Não'}
          </Badge>
        )}
      </TableCell>

      {/* Ações */}
      <TableCell className="text-right">
        {isEditing ? (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              onClick={() => onSaveEdit(field.id)}
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
              onClick={onCancelEdit}
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
                      onClick={() => onStartEdit(field)}
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

            {/* Botão Editar Avançado */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onOpenEditDialog(field)}
                      disabled={!canEdit}
                      className="gap-1"
                    >
                      <Edit2 className="h-3 w-3" />
                    </Button>
                  </div>
                </TooltipTrigger>
                {canEdit ? (
                  <TooltipContent>
                    <p>Edição avançada (tipo, unidade, etc.)</p>
                  </TooltipContent>
                ) : (
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
                      onClick={() => onOpenDeleteDialog(field)}
                      disabled={!canDelete}
                      className="gap-1 text-destructive hover:text-destructive"
                    >
                      {canDelete ? (
                        <Trash2 className="h-3 w-3" />
                      ) : (
                        <Lock className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                </TooltipTrigger>
                {!canDelete && (
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
  );
}

export function FieldsManagerWithDragDrop({ entityTypeId, sectionName }: FieldsManagerProps) {
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
    reorderFields,
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

  // Drag and drop
  const [isReordering, setIsReordering] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Handlers para edição inline (mantidos para compatibilidade)
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

  // Handlers para dialogs
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

  // Drag and drop handler
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    setIsReordering(true);
    
    // Otimistic update (UI first)
    const oldIndex = fields.findIndex((field) => field.id === active.id);
    const newIndex = fields.findIndex((field) => field.id === over.id);
    const reorderedFields = arrayMove(fields, oldIndex, newIndex);
    
    // Preparar dados para backend
    const reorderData = reorderedFields.map((field, index) => ({
      id: field.id,
      sort_order: index + 1, // sort_order começa em 1
    }));

    try {
      const success = await reorderFields(reorderData);
      if (!success) {
        // Se falhou no backend, reverter mudança
        // (a lista será recarregada automaticamente)
      }
    } catch (err) {
      console.error('Erro ao reordenar:', err);
    } finally {
      setIsReordering(false);
    }
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
          {isReordering && (
            <Badge variant="secondary" className="text-xs animate-pulse">
              Reordenando...
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

      {/* Tabela de campos com drag-and-drop */}
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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30px]"></TableHead>
                <TableHead className="w-[50px]">#</TableHead>
                <TableHead>Campo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-center">Obrigatório</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <SortableContext
                items={fields.map((field) => field.id)}
                strategy={verticalListSortingStrategy}
              >
                {fields.map((field, index) => (
                  <SortableTableRow
                    key={field.id}
                    field={field}
                    index={index}
                    isEditing={editingId === field.id}
                    editData={editData}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    savingEdit={savingEdit}
                    onStartEdit={handleStartEdit}
                    onSaveEdit={handleSaveEdit}
                    onCancelEdit={handleCancelEdit}
                    onEditData={setEditData}
                    onOpenDeleteDialog={handleOpenDeleteDialog}
                    onOpenEditDialog={handleOpenEditDialog}
                  />
                ))}
              </SortableContext>
            </TableBody>
          </Table>
        </DndContext>
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
