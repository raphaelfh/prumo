/**
 * Dialog to create a custom template.
 * Lets the user create an empty template and then add sections and fields
 * manually via the configuration UI.
 */

import {useState, useMemo} from 'react';
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
import {t} from '@/lib/copy';

// Schema built with copy for validation messages
const buildCustomTemplateSchema = () => z.object({
  name: z.string()
      .min(3, t('extraction', 'createValidationNameMin'))
      .max(100, t('extraction', 'createValidationNameMax')),
  description: z.string()
      .max(500, t('extraction', 'createValidationDescMax'))
    .optional()
    .nullable(),
  framework: z.enum(['CUSTOM', 'CHARMS', 'PICOS'], {
      errorMap: () => ({message: t('extraction', 'createValidationFramework')})
  })
});

type CustomTemplateInput = z.infer<ReturnType<typeof buildCustomTemplateSchema>>;

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
    const CustomTemplateSchema = useMemo(() => buildCustomTemplateSchema(), []);

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
        toast.error(t('extraction', 'createAuthRequired'));
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

        toast.success(`"${data.name}" ${t('extraction', 'createSuccessCreated')}`);
        toast.info(t('extraction', 'createInfoAddSections'));
      
      form.reset();
      onTemplateCreated(template.id);
      onOpenChange(false);

    } catch (err: any) {
        console.error('Error creating template:', err);
        toast.error(`${t('extraction', 'createErrorCreate')}: ${err.message}`);
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
            <DialogTitle>{t('extraction', 'createTitle')}</DialogTitle>
          <DialogDescription>
              {t('extraction', 'createDesc')}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              {/* Name */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                      {t('extraction', 'createNameLabel')} <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={t('extraction', 'createNamePlaceholder')}
                      disabled={loading}
                    />
                  </FormControl>
                  <FormDescription>
                      {t('extraction', 'createNameDesc')}
                  </FormDescription>
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
                    <FormLabel>{t('extraction', 'createDescriptionLabel')}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value || ''}
                      placeholder={t('extraction', 'createDescriptionPlaceholder')}
                      rows={3}
                      disabled={loading}
                    />
                  </FormControl>
                  <FormDescription>
                      {t('extraction', 'createDescriptionDesc')}
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
                    <FormLabel>{t('extraction', 'createFrameworkLabel')}</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={loading}
                  >
                    <FormControl>
                      <SelectTrigger>
                          <SelectValue placeholder={t('extraction', 'createFrameworkPlaceholder')}/>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                        <SelectItem value="CUSTOM">{t('extraction', 'createFrameworkCustom')}</SelectItem>
                        <SelectItem value="CHARMS">{t('extraction', 'createFrameworkCharms')}</SelectItem>
                        <SelectItem value="PICOS">{t('extraction', 'createFrameworkPicos')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                      {t('extraction', 'createFrameworkDesc')}
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
                  {t('common', 'cancel')}
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t('extraction', 'createCreating')}
                  </>
                ) : (
                  <>
                    <PlusCircle className="h-4 w-4 mr-2" />
                      {t('extraction', 'createTemplateButton')}
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

