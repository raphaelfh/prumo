/**
 * Dialog para editar campo de extração existente
 * 
 * Features:
 * - Edição completa de todos os atributos
 * - Validação de mudança de tipo (não permitir se houver dados)
 * - Editor de unit com sugestões
 * - Editor de allowed_values com drag-drop
 * - Preview do campo
 * - Validação em tempo real
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
import { Loader2, Info, AlertTriangle, Eye } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
  ExtractionFieldUpdate,
  ExtractionField,
  FieldValidationResult,
} from '@/types/extraction';
import { AllowedValuesList } from './AllowedValuesList';
import { AllowedUnitsList } from './AllowedUnitsList';

interface EditFieldDialogProps {
  field: ExtractionField | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (fieldId: string, updates: ExtractionFieldUpdate) => Promise<ExtractionField | null>;
  onValidate: (fieldId: string) => Promise<FieldValidationResult>;
  sectionName?: string;
}

export function EditFieldDialog({
  field,
  open,
  onOpenChange,
  onSave,
  onValidate,
  sectionName,
}: EditFieldDialogProps) {
  const [loading, setLoading] = useState(false);
  const [validation, setValidation] = useState<FieldValidationResult | null>(null);
  const [validatingType, setValidatingType] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const form = useForm<ExtractionFieldUpdate>({
    resolver: zodResolver(ExtractionFieldSchema.partial()),
    defaultValues: {
      label: '',
      description: '',
      field_type: 'text',
      is_required: false,
      unit: null,
      allowed_units: null,
      allowed_values: null,
      validation_schema: {},
    },
  });

  const fieldType = form.watch('field_type');

  // Carregar dados do campo quando abrir
  useEffect(() => {
    if (field && open) {
      form.reset({
        label: field.label,
        description: field.description || '',
        field_type: field.field_type,
        is_required: field.is_required,
        unit: field.unit,
        allowed_units: field.allowed_units,
        allowed_values: field.allowed_values,
        validation_schema: field.validation_schema || {},
      });
      
      // Buscar validação do campo
      loadValidation();
    }
  }, [field, open, form]);

  const loadValidation = async () => {
    if (!field) return;
    
    try {
      const result = await onValidate(field.id);
      setValidation(result);
    } catch (err) {
      console.error('Erro ao validar campo:', err);
    }
  };

  const handleTypeChange = async (newType: string) => {
    if (!field || !validation) return;

    // Se está mudando tipo e campo tem dados extraídos
    if (newType !== field.field_type && !validation.canChangeType) {
      setValidatingType(true);
      // Revalidar para ter certeza
      const freshValidation = await onValidate(field.id);
      setValidation(freshValidation);
      setValidatingType(false);

      if (!freshValidation.canChangeType) {
        form.setValue('field_type', field.field_type); // Reverter
        return;
      }
    }

    form.setValue('field_type', newType);
    
    // Limpar allowed_values se não for select/multiselect
    if (newType !== 'select' && newType !== 'multiselect') {
      form.setValue('allowed_values', null);
    }
    
    // Limpar unit e allowed_units se não for number
    if (newType !== 'number') {
      form.setValue('unit', null);
      form.setValue('allowed_units', null);
    }
  };

  const handleSubmit = async (data: ExtractionFieldUpdate) => {
    if (!field) return;

    setLoading(true);
    try {
      const result = await onSave(field.id, data);
      if (result) {
        onOpenChange(false);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    form.reset();
    onOpenChange(false);
  };

  if (!field) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Campo</DialogTitle>
          <DialogDescription>
            {sectionName ? (
              <>Editando campo <strong>{field.label}</strong> da seção <strong>{sectionName}</strong></>
            ) : (
              <>Edite as configurações do campo <strong>{field.label}</strong></>
            )}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Coluna Esquerda - Informações Básicas */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-medium mb-4">Informações Básicas</h3>
                  
                  {/* Label */}
                  <FormField
                    control={form.control}
                    name="label"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Label <span className="text-destructive">*</span></FormLabel>
                        <FormControl>
                          <Input {...field} disabled={loading} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Nome (readonly, apenas para referência) */}
                <div>
                  <Label>Nome Técnico</Label>
                  <Input
                    value={field.name}
                    disabled
                    className="font-mono text-sm bg-muted"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Nome interno (não pode ser alterado após criação)
                  </p>
                </div>

                {/* Tipo */}
                <FormField
                  control={form.control}
                  name="field_type"
                  render={({ field: formField }) => (
                    <FormItem>
                      <FormLabel>Tipo de Campo</FormLabel>
                      <Select
                        onValueChange={handleTypeChange}
                        defaultValue={formField.value}
                        disabled={loading || validatingType}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
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
                      {validation && !validation.canChangeType && (
                        <Alert className="mt-2">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription>
                            Não é possível mudar o tipo deste campo porque possui {validation.extractedValuesCount} valores extraídos.
                          </AlertDescription>
                        </Alert>
                      )}
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
                          rows={3}
                          disabled={loading}
                        />
                      </FormControl>
                      <FormDescription>
                        Instruções para ajudar os revisores
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

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
                          checked={field.value || false}
                          onCheckedChange={field.onChange}
                          disabled={loading}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              {/* Coluna Direita - Configurações Específicas */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-medium mb-4">Configurações Específicas</h3>

                  {/* Unidades Disponíveis (condicional - para números) */}
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
                            A primeira unidade é a padrão. Deixe vazio para usar sugestões automáticas.
                            {validation && validation.extractedValuesCount > 0 && (
                              <span className="block mt-1 text-amber-600">
                                ⚠️ Mudanças afetarão apenas novas extrações ({validation.extractedValuesCount} valores existentes).
                              </span>
                            )}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  {/* Valores Permitidos (condicional - para select) */}
                  {(fieldType === 'select' || fieldType === 'multiselect') && (
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
                            showReorder={true}
                          />
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  {/* Preview Toggle */}
                  <div className="flex items-center space-x-2 pt-4">
                    <Switch
                      id="show-preview"
                      checked={showPreview}
                      onCheckedChange={setShowPreview}
                    />
                    <Label htmlFor="show-preview" className="cursor-pointer">
                      Mostrar preview do campo
                    </Label>
                  </div>
                </div>
              </div>
            </div>

            {/* Preview do Campo (condicional) */}
            {showPreview && (
              <div className="border-t pt-6">
                <div className="flex items-center gap-2 mb-4">
                  <Eye className="h-5 w-5 text-muted-foreground" />
                  <h3 className="text-lg font-medium">Preview</h3>
                  <p className="text-sm text-muted-foreground">Como aparecerá para o revisor</p>
                </div>
                
                <div className="rounded-lg border bg-muted/30 p-4">
                  {/* TODO: FieldPreview component será implementado depois */}
                  <div className="text-center text-muted-foreground py-8">
                    <Eye className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Preview do campo será implementado no Sprint 3</p>
                    <p className="text-xs mt-1">
                      Mostrará como este campo aparecerá na interface de extração
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Info sobre impacto (se houver dados extraídos) */}
            {validation && validation.extractedValuesCount > 0 && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  <strong>Atenção:</strong> Este campo possui {validation.extractedValuesCount} valores extraídos
                  em {validation.affectedArticles.length} artigo(s). Algumas alterações podem não ser permitidas.
                </AlertDescription>
              </Alert>
            )}

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
                Salvar Alterações
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
