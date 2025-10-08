/**
 * Dialog para adicionar nova seção ao template
 * 
 * Features:
 * - Formulário com react-hook-form + zod
 * - Geração automática de nome (snake_case) a partir do label
 * - Validação em tempo real
 * - Campos condicionais para cardinalidade
 * - Feedback visual de erros
 * - Integração com supabase
 * 
 * @component
 */

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Plus, Loader2, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// =================== SCHEMAS ===================

const AddSectionSchema = z.object({
  name: z.string()
    .min(1, 'Nome é obrigatório')
    .min(2, 'Nome deve ter pelo menos 2 caracteres')
    .max(50, 'Nome deve ter no máximo 50 caracteres')
    .regex(
      /^[a-zA-Z_][a-zA-Z0-9_]*$/,
      'Nome deve começar com letra e conter apenas letras, números e _'
    ),
  label: z.string()
    .min(1, 'Label é obrigatório')
    .min(2, 'Label deve ter pelo menos 2 caracteres')
    .max(100, 'Label deve ter no máximo 100 caracteres'),
  description: z.string()
    .max(500, 'Descrição deve ter no máximo 500 caracteres')
    .optional()
    .nullable(),
  cardinality: z.enum(['one', 'many'], {
    required_error: 'Cardinalidade é obrigatória'
  }),
  is_required: z.boolean().default(false)
});

type AddSectionInput = z.infer<typeof AddSectionSchema>;

// =================== INTERFACES ===================

interface AddSectionDialogProps {
  projectId: string;
  templateId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSectionAdded: () => void;
}

// =================== UTILS ===================

/**
 * Converte label para snake_case
 */
const generateSnakeCaseName = (label: string): string => {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove acentos
    .replace(/[^a-z0-9\s]/g, '') // Remove caracteres especiais
    .trim()
    .replace(/\s+/g, '_'); // Substitui espaços por _
};

// =================== COMPONENT ===================

export function AddSectionDialog({
  projectId,
  templateId,
  open,
  onOpenChange,
  onSectionAdded,
}: AddSectionDialogProps) {
  const [loading, setLoading] = useState(false);
  const [autoGenerateName, setAutoGenerateName] = useState(true);

  const form = useForm<AddSectionInput>({
    resolver: zodResolver(AddSectionSchema),
    defaultValues: {
      name: '',
      label: '',
      description: '',
      cardinality: 'one',
      is_required: false,
    },
  });

  const label = form.watch('label');

  // Gerar nome automaticamente quando label muda
  useEffect(() => {
    if (autoGenerateName && label) {
      const generatedName = generateSnakeCaseName(label);
      form.setValue('name', generatedName);
    }
  }, [label, autoGenerateName, form]);

  const handleSubmit = async (data: AddSectionInput) => {
    setLoading(true);
    
    try {
      console.log('🆕 Criando nova seção:', data);

      // 1. Buscar próximo sort_order
      const { data: existingInstances, error: orderError } = await supabase
        .from('extraction_instances')
        .select('sort_order')
        .eq('project_id', projectId)
        .eq('template_id', templateId)
        .eq('is_template', true)
        .order('sort_order', { ascending: false })
        .limit(1);

      if (orderError) {
        console.error('Erro ao buscar sort_order:', orderError);
        throw orderError;
      }

      const nextSortOrder = (existingInstances?.[0]?.sort_order || 0) + 1;

      // 2. Criar entity type
      const { data: newEntityType, error: entityError } = await supabase
        .from('extraction_entity_types')
        .insert({
          project_template_id: templateId, // Corrigido: templateId é na verdade um project_extraction_templates.id
          name: data.name,
          label: data.label,
          description: data.description || null,
          cardinality: data.cardinality,
          sort_order: nextSortOrder,
          is_required: data.is_required,
        })
        .select()
        .single();

      if (entityError) {
        console.error('Erro ao criar entity type:', entityError);
        throw entityError;
      }

      console.log('✅ Entity type criado:', newEntityType.id);

      // 3. Criar instância template
      const { error: instanceError } = await supabase
        .from('extraction_instances')
        .insert({
          project_id: projectId,
          template_id: templateId,
          entity_type_id: newEntityType.id,
          label: data.label,
          sort_order: nextSortOrder,
          metadata: {},
          created_by: (await supabase.auth.getUser()).data.user?.id || '',
          status: 'pending',
          is_template: true,
          article_id: null
        });

      if (instanceError) {
        console.error('Erro ao criar instância template:', instanceError);
        throw instanceError;
      }

      console.log('✅ Instância template criada');

      toast.success(`Seção "${data.label}" criada com sucesso!`);
      
      // Limpar formulário e fechar dialog
      form.reset();
      onOpenChange(false);
      onSectionAdded();

    } catch (error: any) {
      console.error('Erro ao criar seção:', error);
      toast.error(`Erro ao criar seção: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      form.reset();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Adicionar Nova Seção
          </DialogTitle>
          <DialogDescription>
            Crie uma nova seção personalizada para extrair dados específicos do seu projeto.
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
                  <FormLabel>Label da Seção *</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="ex: Critérios de Exclusão" 
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Nome que aparecerá na interface para os usuários
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Nome Técnico */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    Nome Técnico *
                    <div className="flex items-center gap-1">
                      <Switch
                        checked={autoGenerateName}
                        onCheckedChange={setAutoGenerateName}
                        size="sm"
                      />
                      <span className="text-xs text-muted-foreground">Auto</span>
                    </div>
                  </FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="ex: exclusion_criteria" 
                      {...field}
                      disabled={autoGenerateName}
                    />
                  </FormControl>
                  <FormDescription>
                    Nome único usado internamente (snake_case). {autoGenerateName && 'Gerado automaticamente.'}
                  </FormDescription>
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
                  <FormLabel>Descrição (Opcional)</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Descreva o que esta seção deve coletar e como deve ser preenchida..."
                      rows={3}
                      {...field}
                      value={field.value || ''}
                    />
                  </FormControl>
                  <FormDescription>
                    Explicação detalhada que aparecerá como tooltip na interface
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Cardinalidade */}
            <FormField
              control={form.control}
              name="cardinality"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo de Seção *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o tipo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="one">
                        <div className="flex flex-col items-start">
                          <span className="font-medium">Seção Única</span>
                          <span className="text-xs text-muted-foreground">
                            Uma ocorrência por artigo (ex: Resumo, Conclusão)
                          </span>
                        </div>
                      </SelectItem>
                      <SelectItem value="many">
                        <div className="flex flex-col items-start">
                          <span className="font-medium">Seção Múltipla</span>
                          <span className="text-xs text-muted-foreground">
                            Várias ocorrências por artigo (ex: Autores, Grupos)
                          </span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription className="flex items-start gap-2">
                    <Info className="h-4 w-4 mt-0.5 text-blue-500 flex-shrink-0" />
                    <span>
                      Seção única para dados que aparecem uma vez no artigo.
                      Seção múltipla permite criar várias instâncias (como uma lista ou tabela).
                    </span>
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Obrigatória */}
            <FormField
              control={form.control}
              name="is_required"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Seção Obrigatória</FormLabel>
                    <FormDescription>
                      Se ativado, esta seção deve ser preenchida para todos os artigos
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={loading}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Criando...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Criar Seção
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
