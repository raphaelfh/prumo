/**
 * Dialog para adicionar novo campo de extração
 * 
 * Features:
 * - Formulário com react-hook-form + zod
 * - Geração automática de nome (snake_case) a partir do label
 * - Validação em tempo real
 * - Campos condicionais (unit para number, allowed_values para select)
 * - Feedback visual de erros
 * 
 * @component
 */

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Info } from 'lucide-react';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  ExtractionFieldSchema,
  ExtractionFieldInput,
  ExtractionField,
} from '@/types/extraction';
import { AllowedValuesList } from './AllowedValuesList';
import { AllowedUnitsList } from './AllowedUnitsList';

interface AddFieldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (fieldData: ExtractionFieldInput) => Promise<ExtractionField | null>;
  sectionName?: string;
  entityTypeId?: string;
  createOtherSpecifyField?: (parentFieldName: string, parentFieldLabel: string, sortOrder: number) => Promise<ExtractionField | null>;
  removeOtherSpecifyField?: (parentFieldName: string) => Promise<boolean>;
}

/**
 * Gera nome em snake_case a partir de um label
 */
function generateSnakeCaseName(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD') // Normalizar para decompor acentos
    .replace(/[\u0300-\u036f]/g, '') // Remover acentos
    .replace(/[^a-z0-9]+/g, '_') // Substituir não-alfanuméricos por _
    .replace(/^_+|_+$/g, '') // Remover _ do início/fim
    .replace(/_+/g, '_'); // Remover _ consecutivos
}

export function AddFieldDialog({
  open,
  onOpenChange,
  onSave,
  sectionName,
  entityTypeId,
  createOtherSpecifyField,
  removeOtherSpecifyField,
}: AddFieldDialogProps) {
  const [loading, setLoading] = useState(false);
  const [autoGenerateName, setAutoGenerateName] = useState(true);
  const [allowOther, setAllowOther] = useState(false);

  const form = useForm<ExtractionFieldInput>({
    resolver: zodResolver(ExtractionFieldSchema),
    defaultValues: {
      name: '',
      label: '',
      description: '',
      field_type: 'text',
      is_required: false,
      unit: null,
      allowed_units: null,
      allowed_values: null,
      llm_description: null,
      validation_schema: {},
      sort_order: 0,
    },
  });

  const fieldType = form.watch('field_type');
  const label = form.watch('label');

  // Gerar nome automaticamente quando label muda
  useEffect(() => {
    if (autoGenerateName && label) {
      const generatedName = generateSnakeCaseName(label);
      form.setValue('name', generatedName);
    }
  }, [label, autoGenerateName, form]);

  const handleSubmit = async (data: ExtractionFieldInput) => {
    setLoading(true);
    try {
      // Configurar suporte a "Outro (especificar)" via flags dedicadas
      const finalData = { 
        ...data,
        allow_other: (fieldType === 'select' || fieldType === 'multiselect') ? allowOther : false,
        other_label: (fieldType === 'select' || fieldType === 'multiselect') && allowOther ? (data as any).other_label || 'Outro (especificar)' : null,
        other_placeholder: (fieldType === 'select' || fieldType === 'multiselect') && allowOther ? (data as any).other_placeholder || null : null,
      } as any;

      const result = await onSave(finalData);
      if (result) {
        // Não criar/remover campos auxiliares; "Outro" é inline
        // Resetar formulário e fechar
        form.reset();
        setAutoGenerateName(true);
        setAllowOther(false);
        onOpenChange(false);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    form.reset();
    setAutoGenerateName(true);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adicionar Novo Campo</DialogTitle>
          <DialogDescription>
            {sectionName ? (
              <>Adicione um novo campo para a seção <strong>{sectionName}</strong></>
            ) : (
              'Crie um novo campo para coletar dados dos artigos'
            )}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            {/* Label */}
            <FormField
              control={form.control}
              name="label"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Label <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Ex: Idade dos Participantes"
                      disabled={loading}
                    />
                  </FormControl>
                  <FormDescription>
                    Nome que aparecerá para os revisores ao extrair dados
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Nome (snake_case) */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Nome Técnico <span className="text-destructive">*</span>
                  </FormLabel>
                  <div className="flex items-center gap-2">
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Ex: idade_participantes"
                        className="font-mono text-sm"
                        disabled={loading}
                        onChange={(e) => {
                          field.onChange(e);
                          // Desabilitar auto-geração se usuário editar manualmente
                          if (e.target.value !== generateSnakeCaseName(label)) {
                            setAutoGenerateName(false);
                          }
                        }}
                      />
                    </FormControl>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setAutoGenerateName(true);
                        form.setValue('name', generateSnakeCaseName(label));
                      }}
                      disabled={loading}
                    >
                      Auto
                    </Button>
                  </div>
                  <FormDescription>
                    Nome interno do campo (snake_case). Gerado automaticamente do label.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Tipo de Campo */}
            <FormField
              control={form.control}
              name="field_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo de Campo</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={loading}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o tipo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="text">Texto</SelectItem>
                      <SelectItem value="number">Número</SelectItem>
                      <SelectItem value="date">Data</SelectItem>
                      <SelectItem value="select">Seleção Única</SelectItem>
                      <SelectItem value="multiselect">Múltipla Escolha</SelectItem>
                      <SelectItem value="boolean">Sim/Não</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Descrição */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrição</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value || ''}
                      placeholder="Descreva o que deve ser coletado neste campo..."
                      rows={3}
                      disabled={loading}
                    />
                  </FormControl>
                  <FormDescription>
                    Instruções para ajudar os revisores a preencher corretamente
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Instrução para IA */}
            <FormField
              control={form.control}
              name="llm_description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Instrução para IA (opcional)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value || ''}
                      placeholder="Exemplo: Extraia o número total de participantes no baseline, antes de exclusões..."
                      rows={3}
                      disabled={loading}
                    />
                  </FormControl>
                  <FormDescription>
                    Instrução específica para extração automática com IA. Seja claro sobre O QUE extrair e ONDE encontrar no artigo.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Unidades Disponíveis (condicional - apenas para números) */}
            {fieldType === 'number' && (
              <FormField
                control={form.control}
                name="allowed_units"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unidades Disponíveis (opcional)</FormLabel>
                    <AllowedUnitsList
                      values={Array.isArray(field.value) ? field.value : []}
                      onChange={(newUnits) => {
                        field.onChange(newUnits.length > 0 ? newUnits : null);
                        // Sincronizar unit com a primeira unidade
                        if (newUnits.length > 0) {
                          form.setValue('unit', newUnits[0]);
                        } else {
                          form.setValue('unit', null);
                        }
                      }}
                      disabled={loading}
                    />
                    <FormDescription>
                      Configure as unidades que o revisor poderá escolher durante a extração.
                      A primeira unidade é a padrão/sugerida. Deixe vazio para usar sugestões automáticas.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Valores Permitidos (condicional - para select/multiselect) */}
            {(fieldType === 'select' || fieldType === 'multiselect') && (
              <>
                <FormField
                  control={form.control}
                  name="allowed_values"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Valores Permitidos <span className="text-destructive">*</span>
                      </FormLabel>
                      <AllowedValuesList
                        values={Array.isArray(field.value) ? field.value : []}
                        onChange={(newValues) => {
                          field.onChange(newValues.length > 0 ? newValues : null);
                        }}
                        disabled={loading}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Opção: Permitir "Outro (especificar)" */}
                <div className="space-y-3 rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="font-medium">Permitir "Outro (especificar)"</Label>
                      <p className="text-xs text-muted-foreground mt-1">Mostra opção inline e input contextual</p>
                    </div>
                  <Switch
                      checked={allowOther}
                      onCheckedChange={setAllowOther}
                    disabled={loading}
                  />
                  </div>

                  {allowOther && (
                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={form.control}
                        name={"other_label" as any}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Label do "Outro"</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="Outro (especificar)" disabled={loading} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={"other_placeholder" as any}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Placeholder</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="Digite aqui" disabled={loading} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Campo Obrigatório */}
            <FormField
              control={form.control}
              name="is_required"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Campo Obrigatório</FormLabel>
                    <FormDescription>
                      Marque se este campo deve ser preenchido obrigatoriamente
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={loading}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {/* Info adicional */}
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Dicas:</p>
                  <ul className="mt-1 list-disc list-inside space-y-1 text-xs">
                    <li>O nome técnico é gerado automaticamente do label</li>
                    <li>Unidades disponíveis: configure as opções que aparecerão para o revisor (a primeira é a padrão)</li>
                    <li>Deixe as unidades vazias para usar sugestões automáticas baseadas no contexto</li>
                    <li>Para campos de seleção, defina pelo menos 2 opções</li>
                  </ul>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={loading}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Adicionar Campo
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

