/**
 * Dialog para adicionar novo item ao instrumento de avaliacao
 *
 * Segue o pattern de AddSectionDialog (Extracao):
 * - react-hook-form + zodResolver para validacao
 * - shadcn Form components
 * - Loading state durante submit
 * - form.reset() ao fechar
 * - toast.success() / toast.error() para feedback
 *
 * Reutiliza AllowedValuesList do modulo de Extracao para
 * o campo allowedLevels (multi-value string[]).
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
import {Switch} from '@/components/ui/switch';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue,} from '@/components/ui/select';
import {Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,} from '@/components/ui/form';
import {Loader2, Plus} from 'lucide-react';
import {toast} from 'sonner';
import {addItem} from '@/services/projectAssessmentInstrumentService';
import {AllowedValuesList} from '@/components/extraction/dialogs/AllowedValuesList';

// =================== CONSTANTS ===================

const NEW_DOMAIN_SENTINEL = '__novo_dominio__';

// =================== SCHEMAS ===================

const AddItemSchema = z.object({
  domain: z.string().min(1, 'Dominio e obrigatorio'),
  customDomain: z.string().optional(),
  itemCode: z
    .string()
    .min(1, 'Codigo e obrigatorio')
    .max(50, 'Codigo deve ter no maximo 50 caracteres'),
  question: z
    .string()
    .min(1, 'Questao e obrigatoria')
    .max(2000, 'Questao deve ter no maximo 2000 caracteres'),
  description: z
    .string()
    .max(2000, 'Descricao deve ter no maximo 2000 caracteres')
    .optional()
    .nullable(),
  required: z.boolean().default(true),
}).refine(
  (data) => {
    if (data.domain === NEW_DOMAIN_SENTINEL) {
      return !!data.customDomain && data.customDomain.trim().length > 0;
    }
    return true;
  },
  {
    message: 'Nome do novo dominio e obrigatorio',
    path: ['customDomain'],
  }
);

type AddItemInput = z.infer<typeof AddItemSchema>;

// =================== INTERFACES ===================

interface AddItemDialogProps {
  instrumentId: string;
  existingDomains: string[];
  defaultAllowedLevels: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onItemAdded: () => void;
}

// =================== COMPONENT ===================

export function AddItemDialog({
  instrumentId,
  existingDomains,
  defaultAllowedLevels,
  open,
  onOpenChange,
  onItemAdded,
}: AddItemDialogProps) {
  const [loading, setLoading] = useState(false);
  const [allowedLevels, setAllowedLevels] = useState<string[]>(defaultAllowedLevels);

  const form = useForm<AddItemInput>({
    resolver: zodResolver(AddItemSchema),
    defaultValues: {
      domain: existingDomains[0] || NEW_DOMAIN_SENTINEL,
      customDomain: '',
      itemCode: '',
      question: '',
      description: '',
      required: true,
    },
  });

  const selectedDomain = form.watch('domain');
  const isNewDomain = selectedDomain === NEW_DOMAIN_SENTINEL;

  const handleSubmit = async (data: AddItemInput) => {
    if (allowedLevels.length === 0) {
      toast.error('Adicione pelo menos um nivel permitido');
      return;
    }

    setLoading(true);

    try {
      const resolvedDomain = isNewDomain
        ? data.customDomain!.trim()
        : data.domain;

      await addItem(instrumentId, {
        domain: resolvedDomain,
        itemCode: data.itemCode,
        question: data.question,
        description: data.description || null,
        required: data.required,
        allowedLevels,
      });

      toast.success('Item adicionado com sucesso');

      form.reset();
      setAllowedLevels(defaultAllowedLevels);
      onOpenChange(false);
      onItemAdded();
    } catch (error: any) {
      console.error('Erro ao adicionar item:', error);
      toast.error(`Erro ao adicionar item: ${error.message || 'Erro desconhecido'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      form.reset();
      setAllowedLevels(defaultAllowedLevels);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Adicionar Item
          </DialogTitle>
          <DialogDescription>
            Crie um novo item de avaliacao para o instrumento.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            {/* Domain */}
            <FormField
              control={form.control}
              name="domain"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Dominio *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o dominio" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {existingDomains.map((domain) => (
                        <SelectItem key={domain} value={domain}>
                          {domain}
                        </SelectItem>
                      ))}
                      <SelectItem value={NEW_DOMAIN_SENTINEL}>
                        Novo dominio...
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Custom Domain Name (shown when "Novo dominio..." is selected) */}
            {isNewDomain && (
              <FormField
                control={form.control}
                name="customDomain"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome do Novo Dominio *</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="ex: D5, Novo Dominio"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Item Code */}
            <FormField
              control={form.control}
              name="itemCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Codigo do Item *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="ex: 1.4, C1"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Codigo curto para identificar o item
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Question */}
            <FormField
              control={form.control}
              name="question"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Questao *</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="A questao de avaliacao que o revisor deve responder"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Description */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descricao (Opcional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Orientacao adicional para o avaliador"
                      rows={2}
                      {...field}
                      value={field.value || ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Allowed Levels */}
            <div className="space-y-2">
              <FormLabel>Niveis Permitidos *</FormLabel>
              <AllowedValuesList
                values={allowedLevels}
                onChange={setAllowedLevels}
                disabled={loading}
              />
              {allowedLevels.length === 0 && (
                <p className="text-xs text-destructive">
                  Adicione pelo menos um nivel permitido
                </p>
              )}
            </div>

            {/* Required */}
            <FormField
              control={form.control}
              name="required"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Item Obrigatorio</FormLabel>
                    <FormDescription>
                      Se ativado, este item deve ser respondido para todos os artigos
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
                    Adicionando...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Adicionar Item
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
