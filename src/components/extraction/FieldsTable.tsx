/**
 * Tabela de Campos de Extração
 * 
 * Componente responsável por exibir a lista de campos em formato de tabela
 * com funcionalidades de edição inline e ações.
 * 
 * @component
 */

import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Edit2, Save, X, Loader2, Trash2, Lock, Settings, MoreVertical } from 'lucide-react';
import type { ExtractionField } from '@/types/extraction';

interface FieldsTableProps {
  fields: ExtractionField[];
  editingId: string | null;
  editData: Partial<ExtractionField>;
  savingEdit: boolean;
  validatingDelete: string | null;
  canEdit: boolean;
  canDelete: boolean;
  onStartEdit: (field: ExtractionField) => void;
  onOpenEditDialog: (field: ExtractionField) => void;
  onUpdateEditData: (data: Partial<ExtractionField>) => void;
  onSaveEdit: (fieldId: string) => void;
  onCancelEdit: () => void;
  onOpenDeleteDialog: (field: ExtractionField) => void;
  getFieldTypeLabel: (type: string) => string;
}

export const FieldsTable = memo(function FieldsTable({
  fields,
  editingId,
  editData,
  savingEdit,
  validatingDelete,
  canEdit,
  canDelete,
  onStartEdit,
  onOpenEditDialog,
  onUpdateEditData,
  onSaveEdit,
  onCancelEdit,
  onOpenDeleteDialog,
  getFieldTypeLabel,
}: FieldsTableProps) {
  return (
    <Table role="table" aria-label="Lista de campos de extração">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[50px]" scope="col" aria-label="Número do campo">#</TableHead>
          <TableHead scope="col">Campo</TableHead>
          <TableHead scope="col">Tipo</TableHead>
          <TableHead className="text-center" scope="col">Obrigatório</TableHead>
          <TableHead className="text-right" scope="col">Ações</TableHead>
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
                    onChange={(e) => onUpdateEditData({ label: e.target.value })}
                    placeholder="Label do campo"
                    disabled={savingEdit}
                    aria-label={`Editar label do campo ${field.label}`}
                    aria-describedby={`field-${field.id}-label-help`}
                  />
                  <Textarea
                    value={editData.description || ''}
                    onChange={(e) => onUpdateEditData({ description: e.target.value })}
                    placeholder="Descrição"
                    rows={2}
                    className="text-sm"
                    disabled={savingEdit}
                    aria-label={`Editar descrição do campo ${field.label}`}
                    aria-describedby={`field-${field.id}-description-help`}
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
                    onUpdateEditData({ is_required: checked })
                  }
                  disabled={savingEdit}
                  aria-label={`Campo ${field.label} é obrigatório`}
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
                    onClick={() => onSaveEdit(field.id)}
                    disabled={savingEdit}
                    className="gap-1"
                    aria-label={`Salvar alterações do campo ${field.label}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSaveEdit(field.id);
                      }
                    }}
                  >
                    {savingEdit ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    ) : (
                      <Save className="h-3 w-3" aria-hidden="true" />
                    )}
                    Salvar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onCancelEdit}
                    disabled={savingEdit}
                    className="gap-1"
                    aria-label={`Cancelar edição do campo ${field.label}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onCancelEdit();
                      }
                    }}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                    Cancelar
                  </Button>
                </div>
              ) : (
                <div className="flex justify-end">
                  {canEdit || canDelete ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          aria-label={`Ações para o campo ${field.label}`}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canEdit && (
                          <>
                            <DropdownMenuItem
                              onClick={() => onStartEdit(field)}
                              className="gap-2"
                            >
                              <Edit2 className="h-4 w-4" />
                              Edição Rápida
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => onOpenEditDialog(field)}
                              className="gap-2"
                            >
                              <Settings className="h-4 w-4" />
                              Edição Completa
                            </DropdownMenuItem>
                          </>
                        )}
                        {canEdit && canDelete && <DropdownMenuSeparator />}
                        {canDelete && (
                          <DropdownMenuItem
                            onClick={() => onOpenDeleteDialog(field)}
                            disabled={validatingDelete === field.id}
                            className="gap-2 text-destructive focus:text-destructive"
                          >
                            {validatingDelete === field.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                            Excluir Campo
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            disabled
                          >
                            <Lock className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Apenas managers podem editar ou excluir</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
});
