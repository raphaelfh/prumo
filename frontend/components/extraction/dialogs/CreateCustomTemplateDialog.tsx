/**
 * Dialog para criar template personalizado
 * 
 * Permite que o usuário crie um template vazio e depois
 * adicione seções e campos manualmente através da UI de configuração.
 */

import {useState} from 'react';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,} from '@/components/ui/form';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue,} from '@/components/ui/select';
import {Loader2, PlusCircle} from 'lucide-react';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/contexts/AuthContext';
import {toast} from 'sonner';

// Schema de validação
const CustomTemplateSchema = z.object({
  name: z.string()
    .min(3, 'Nome deve ter pelo menos 3 caracteres')
    .max(100, 'Nome deve ter no máximo 100 caracteres'),
  description: z.string()
    .max(500, 'Descrição deve ter no máximo 500 caracteres')
    .optional()
    .nullable(),
  framework: z.enum(['CUSTOM', 'CHARMS', 'PICOS'], {
    errorMap: () => ({ message: 'Selecione um framework' })
  })
});

type CustomTemplateInput = z.infer<typeof CustomTemplateSchema>;

interface CreateCustomTemplateDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTemplateCreated: (templateId?: string) => void;
}

export function CreateCustomTemplateDialog({
  projectId,
  open,
  onOpenChange,
  onTemplateCreated,
}: CreateCustomTemplateDialogProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  const form = useForm<CustomTemplateInput>({
    resolver: zodResolver(CustomTemplateSchema),
    defaultValues: {
      name: '',
      description: '',
      framework: 'CUSTOM',
    },
  });

  const handleSubmit = async (data: CustomTemplateInput) => {
    if (!user) {
      toast.error('Você precisa estar autenticado');
      return;
    }

    setLoading(true);
    try {
      const { data: template, error } = await supabase
        .from('project_extraction_templates')
        .insert({
          project_id: projectId,
          name: data.name,
          description: data.description,
          framework: data.framework,
          version: '1.0.0',
          schema: {
            description: data.description || '',
            custom: true,
            created_via_ui: true
          },
          is_active: true,
          created_by: user.id
        })
        .select()
        .single();

      if (error) throw error;

      toast.success(`Template "${data.name}" criado com sucesso!`);
      toast.info('Agora adicione seções e campos na aba Configuração');
      
      form.reset();
      onTemplateCreated(template.id);
      onOpenChange(false);

    } catch (err: any) {
      console.error('Erro ao criar template:', err);
      toast.error(`Erro ao criar template: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    form.reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Criar Template Personalizado</DialogTitle>
          <DialogDescription>
            Crie um template vazio e adicione seções e campos personalizados
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            {/* Nome */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Nome do Template <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Ex: Extração Personalizada - Diabetes"
                      disabled={loading}
                    />
                  </FormControl>
                  <FormDescription>
                    Nome descritivo para identificar este template
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
                  <FormLabel>Descrição</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value || ''}
                      placeholder="Descreva o propósito deste template..."
                      rows={3}
                      disabled={loading}
                    />
                  </FormControl>
                  <FormDescription>
                    Explique quais dados serão extraídos e para qual finalidade
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Framework */}
            <FormField
              control={form.control}
              name="framework"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Framework Base</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={loading}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um framework" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="CUSTOM">Personalizado</SelectItem>
                      <SelectItem value="CHARMS">CHARMS (customizado)</SelectItem>
                      <SelectItem value="PICOS">PICOS (customizado)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Base conceitual do template (pode ser CUSTOM se totalmente personalizado)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Criando...
                  </>
                ) : (
                  <>
                    <PlusCircle className="h-4 w-4 mr-2" />
                    Criar Template
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

