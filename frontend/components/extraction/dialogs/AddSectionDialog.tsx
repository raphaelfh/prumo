/**
 * Dialog to add a new section to the template — the PERMANENT create
 * surface for sections (B-8: inline section creation was dropped).
 *
 * Three mode variants (B-8 D3), chosen by the invoking menu/ghost:
 * - root ("New section"): the B-7 study-section form — cardinality
 *   select, description, required switch;
 * - group ("Add repeating group…"): Label + Entry label only; role
 *   model_container and cardinality 'many' are hard-coded (the server
 *   422s anything else — the form never offers the impossible);
 * - perModel ("New per-{noun} section"): parent preset from the invoking
 *   group; cardinality select stays, worded per-{noun}.
 *
 * Mount keyed by `mode.kind` (the editor does) so react-hook-form
 * re-initializes defaults when the variant changes between opens.
 *
 * @component
 */

import {useEffect, useState} from 'react';
import {useForm, useWatch} from 'react-hook-form';
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
import {createSection} from '@/services/templateService';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {generateSnakeCaseName} from '@/lib/extraction/slug';

// =================== MODES ===================

/** Which create variant the dialog runs (B-8 D3). */
export type AddSectionMode =
  | {kind: 'root'}
  | {kind: 'group'}
  | {kind: 'perModel'; parentId: string; parentLabel: string; entryNoun: string};

// =================== SCHEMAS ===================

/** One superset shape across modes (react-hook-form needs a single form
 * type); honesty per mode lives in WHICH controls render and in the
 * submit mapping below — group mode hard-codes cardinality 'many' /
 * is_required false, and the server 422s any contract breach anyway. */
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
  entry_label: z.string()
      .max(50, t('templateConfig', 'entryLabelMax50'))
    .optional(),
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
  mode: AddSectionMode;
  onOpenChange: (open: boolean) => void;
  onSectionAdded: () => void;
}

const ROLE_BY_MODE = {
  root: 'study_section',
  group: 'model_container',
  perModel: 'model_section',
} as const;

// =================== COMPONENT ===================

export function AddSectionDialog({
  projectId,
  templateId,
  open,
  mode,
  onOpenChange,
  onSectionAdded,
}: AddSectionDialogProps) {
  const [loading, setLoading] = useState(false);
  const [autoGenerateName, setAutoGenerateName] = useState(true);
  const noun = mode.kind === 'perModel' ? mode.entryNoun : 'model';

  const form = useForm<AddSectionInput>({
      resolver: zodResolver(getAddSectionSchema()),
    defaultValues: {
      name: '',
      label: '',
      description: '',
      entry_label: '',
      // A group ALWAYS repeats; the other modes default to one.
      cardinality: mode.kind === 'group' ? 'many' : 'one',
      is_required: false,
    },
  });

  // useWatch instead of form.watch — the latter is incompatible with the
  // React Compiler (react-hooks/incompatible-library).
  const label = useWatch({control: form.control, name: 'label'});

    // Auto-generate name when label changes
  useEffect(() => {
    if (autoGenerateName && label) {
      const generatedName = generateSnakeCaseName(label);
      form.setValue('name', generatedName);
    }
  }, [label, autoGenerateName, form]);

  const handleSubmit = async (data: AddSectionInput) => {
    setLoading(true);

    const result = await createSection({
      projectId,
      templateId,
      name: data.name,
      label: data.label,
      description: mode.kind === 'group' ? null : data.description || null,
      cardinality: mode.kind === 'group' ? 'many' : data.cardinality,
      role: ROLE_BY_MODE[mode.kind],
      parentEntityTypeId: mode.kind === 'perModel' ? mode.parentId : null,
      // Blank → omit so the server defaults the noun to 'model' (D3).
      entryLabel: mode.kind === 'group' ? data.entry_label?.trim() || undefined : undefined,
      isRequired: mode.kind === 'group' ? false : data.is_required,
    });

    if (!result.ok) {
      console.error('Error creating section:', result.error);
      toast.error(`${t('extraction', 'sectionCreateError')}: ${result.error.message}`);
      setLoading(false);
      return;
    }

    toast.success(t('extraction', 'sectionCreatedSuccess').replace('{{label}}', data.label));

    // Reset form and close dialog
    form.reset();
    onOpenChange(false);
    onSectionAdded();
    setLoading(false);
  };

  const handleClose = () => {
    if (!loading) {
      form.reset();
      onOpenChange(false);
    }
  };

  const title =
    mode.kind === 'group'
      ? t('templateConfig', 'addGroupDialogTitle')
      : mode.kind === 'perModel'
        ? t('templateConfig', 'newPerModelSection').replace('{{noun}}', noun)
        : t('extraction', 'addNewSection');
  const description =
    mode.kind === 'group'
      ? t('templateConfig', 'addGroupDialogDesc')
      : mode.kind === 'perModel'
        ? t('templateConfig', 'perModelDialogDesc')
            .replace('{{group}}', mode.parentLabel)
            .replace('{{noun}}', noun)
        : t('templateConfig', 'addSectionDialogDesc');

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
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

            {/* Entry label — group mode only (D3): what one entry is
                called; blank falls back to the server default "model". */}
            {mode.kind === 'group' && (
              <FormField
                control={form.control}
                name="entry_label"
                render={({field}) => (
                  <FormItem>
                    <FormLabel>{t('templateConfig', 'entryLabelLabel')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t('templateConfig', 'entryLabelPlaceholder')}
                        {...field}
                        value={field.value || ''}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('templateConfig', 'entryLabelHint')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Description — not part of the minimal group form */}
            {mode.kind !== 'group' && (
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
            )}

            {/* Cardinality — root and per-model modes; a group is always
                'many' (no choice to offer). Wording follows the mode:
                per-article for roots, per-{noun} for model sections. */}
            {mode.kind !== 'group' && (
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
                          <span className="font-medium">
                            {mode.kind === 'perModel'
                              ? t('templateConfig', 'cardinalityOncePerModel').replace('{{noun}}', noun)
                              : t('extraction', 'sectionTypeSingle')}
                          </span>
                          {mode.kind === 'root' && (
                            <span className="text-xs text-muted-foreground">
                              {t('templateConfig', 'cardinalityRootSingleHint')}
                            </span>
                          )}
                        </div>
                      </SelectItem>
                      <SelectItem value="many">
                        <div className="flex flex-col items-start">
                          <span className="font-medium">
                            {mode.kind === 'perModel'
                              ? t('templateConfig', 'cardinalityRepeatsPerModel').replace('{{noun}}', noun)
                              : t('extraction', 'sectionTypeMultiple')}
                          </span>
                          {mode.kind === 'root' && (
                            <span className="text-xs text-muted-foreground">
                              {t('templateConfig', 'cardinalityRootMultipleHint')}
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {mode.kind === 'root' && (
                    <FormDescription className="flex items-start gap-2">
                      <Info className="h-4 w-4 mt-0.5 text-info shrink-0" />
                      <span>{t('templateConfig', 'cardinalityRootInfo')}</span>
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            )}

            {/* Required — root and per-model modes only */}
            {mode.kind !== 'group' && (
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
            )}

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
