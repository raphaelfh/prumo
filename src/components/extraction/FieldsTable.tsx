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
import { Edit2, Save, X, Loader2, Trash2, Lock } from 'lucide-react';
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
                            aria-label={`Editar campo ${field.label}`}
                          >
                            {canEdit ? (
                              <Edit2 className="h-3 w-3" aria-hidden="true" />
                            ) : (
                              <Lock className="h-3 w-3" aria-hidden="true" />
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
                            onClick={() => onOpenDeleteDialog(field)}
                            disabled={!canDelete || validatingDelete === field.id}
                            className="gap-1 text-destructive hover:text-destructive"
                            aria-label={`Excluir campo ${field.label}`}
                          >
                            {validatingDelete === field.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                            ) : canDelete ? (
                              <Trash2 className="h-3 w-3" aria-hidden="true" />
                            ) : (
                              <Lock className="h-3 w-3" aria-hidden="true" />
                            )}
                          </Button>
                        </div>
                      </TooltipTrigger>
                      {!canDelete && validatingDelete !== field.id && (
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
  );
});
