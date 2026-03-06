/**
 * Dialog to add a new section to the template
 *
 * Features:
 * - Form with react-hook-form + zod
 * - Auto-generated name (snake_case) from label
 * - Real-time validation
 * - Conditional fields for cardinality
 * - Visual error feedback
 * - Supabase integration
 *
 * @component
 */

import {useEffect, useState} from 'react';
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
import {Info, Loader2, Plus} from 'lucide-react';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';
import {t} from '@/lib/copy';

// =================== SCHEMAS ===================

const getAddSectionSchema = () => z.object({
  name: z.string()
      .min(1, t('extraction', 'nameRequired'))
      .min(2, t('extraction', 'nameMin2'))
      .max(50, t('extraction', 'nameMax50'))
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, t('extraction', 'nameFormat')),
  label: z.string()
      .min(1, t('extraction', 'labelRequired'))
      .min(2, t('extraction', 'labelMin2'))
      .max(100, t('extraction', 'labelMax100')),
  description: z.string()
      .max(500, t('extraction', 'descriptionMax500'))
    .optional()
    .nullable(),
  cardinality: z.enum(['one', 'many'], {
      required_error: t('extraction', 'cardinalityRequired'),
  }),
    is_required: z.boolean().default(false),
});

type AddSectionInput = z.infer<ReturnType<typeof getAddSectionSchema>>;

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
 * Convert label to snake_case
 */
const generateSnakeCaseName = (label: string): string => {
  return label
    .toLowerCase()
    .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/[^a-z0-9\s]/g, '') // Remove special characters
    .trim()
      .replace(/\s+/g, '_'); // Replace spaces with _
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
      resolver: zodResolver(getAddSectionSchema()),
    defaultValues: {
      name: '',
      label: '',
      description: '',
      cardinality: 'one',
      is_required: false,
    },
  });

  const label = form.watch('label');

    // Auto-generate name when label changes
  useEffect(() => {
    if (autoGenerateName && label) {
      const generatedName = generateSnakeCaseName(label);
      form.setValue('name', generatedName);
    }
  }, [label, autoGenerateName, form]);

  const handleSubmit = async (data: AddSectionInput) => {
    setLoading(true);
    
    try {
        console.log('Creating new section:', data);

        // 1. Fetch next sort_order from existing entity_types
      const { data: existingEntityTypes, error: orderError } = await supabase
        .from('extraction_entity_types')
        .select('sort_order')
        .eq('project_template_id', templateId)
        .order('sort_order', { ascending: false })
        .limit(1);

      if (orderError) {
          console.error('Error fetching sort_order:', orderError);
        throw orderError;
      }

      const nextSortOrder = (existingEntityTypes?.[0]?.sort_order || 0) + 1;

        // 2. Create entity type
      const { data: newEntityType, error: entityError } = await supabase
        .from('extraction_entity_types')
        .insert({
          project_template_id: templateId,
          name: data.name,
          label: data.label,
          description: data.description || null,
          cardinality: data.cardinality,
          sort_order: nextSortOrder,
          is_required: data.is_required,
            parent_entity_type_id: null // New section is always ROOT
        })
        .select()
        .single();

      if (entityError) {
          console.error('Error creating entity type:', entityError);
        throw entityError;
      }

        console.log('Entity type created:', newEntityType.id);

        toast.success(t('extraction', 'sectionCreatedSuccess').replace('{{label}}', data.label));

        // Reset form and close dialog
      form.reset();
      onOpenChange(false);
      onSectionAdded();

    } catch (error: any) {
        console.error('Error creating section:', error);
        toast.error(`${t('extraction', 'sectionCreateError')}: ${error.message}`);
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
              {t('extraction', 'addNewSection')}
          </DialogTitle>
          <DialogDescription>
              Create a custom section to extract project-specific data.
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
                    <FormLabel>{t('extraction', 'sectionLabelLabel')}</FormLabel>
                  <FormControl>
                    <Input
                        placeholder={t('extraction', 'placeholderSectionLabel')}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                      Name shown in the UI for users
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

              {/* Technical name */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                      Technical name *
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
                        placeholder={t('extraction', 'placeholderSectionNameExample')}
                      {...field}
                      disabled={autoGenerateName}
                    />
                  </FormControl>
                  <FormDescription>
                      Unique internal name (snake_case). {autoGenerateName && 'Auto-generated.'}
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
                    <FormLabel>{t('extraction', 'sectionDescriptionOptional')}</FormLabel>
                  <FormControl>
                    <Textarea
                        placeholder={t('extraction', 'placeholderSectionDescription')}
                      rows={3}
                      {...field}
                      value={field.value || ''}
                    />
                  </FormControl>
                  <FormDescription>
                      Detailed explanation shown as a tooltip in the UI
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
                    <FormLabel>{t('extraction', 'sectionTypeLabel')}</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                          <SelectValue placeholder={t('extraction', 'selectTypePlaceholder')}/>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="one">
                        <div className="flex flex-col items-start">
                            <span className="font-medium">{t('extraction', 'sectionTypeSingle')}</span>
                          <span className="text-xs text-muted-foreground">
                            One occurrence per article (e.g. Summary, Conclusion)
                          </span>
                        </div>
                      </SelectItem>
                      <SelectItem value="many">
                        <div className="flex flex-col items-start">
                            <span className="font-medium">{t('extraction', 'sectionTypeMultiple')}</span>
                          <span className="text-xs text-muted-foreground">
                            Multiple occurrences per article (e.g. Authors, Groups)
                          </span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription className="flex items-start gap-2">
                    <Info className="h-4 w-4 mt-0.5 text-blue-500 flex-shrink-0" />
                    <span>
                      Single section for data that appears once per article.
                      Multiple section allows several instances (e.g. a list or table).
                    </span>
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

              {/* Required */}
            <FormField
              control={form.control}
              name="is_required"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                      <FormLabel className="text-base">{t('extraction', 'sectionRequiredLabel')}</FormLabel>
                    <FormDescription>
                        When enabled, this section must be filled for all articles
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
                  {t('common', 'cancel')}
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Creating...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                      {t('extraction', 'createSection')}
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
