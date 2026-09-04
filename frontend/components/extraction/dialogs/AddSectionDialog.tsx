/**
 * Dialog to add a new section to the template — the PERMANENT create
 * surface for sections (B-8: inline section creation was dropped).
 *
 * Three mode variants (B-8 D3), chosen by the invoking menu/ghost:
 * - root ("New section"): the B-7 study-section form — cardinality
 *   select, description, required switch;
 * - group ("Add repeating group…"): Label + Entry label + Description;
 *   role model_container and cardinality 'many' are fixed (the server
 *   422s anything else — the form never offers the impossible);
 * - perModel ("New per-{noun} section"): parent preset from the invoking
 *   group; cardinality select stays, worded per-{noun}.
 *
 * Every repeating section is created WITH its entry noun (entry-group
 * train): the entry-label field renders whenever the form's cardinality is
 * 'many' — always for a group, once the select says so in the other two
 * modes — and the schema requires it non-blank then.
 *
 * Every mode offers the description: it is the section's AI instruction
 * (sent with every extraction of the section; for a repeating one also
 * how its entries are identified), so a group created without one would
 * have nothing to tell the identifier.
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
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue,} from '@/components/ui/select';
import {Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,} from '@/components/ui/form';
import {Info, Loader2, Plus} from 'lucide-react';
import {createSection} from '@/services/templateService';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {generateSnakeCaseName} from '@/lib/extraction/slug';
import {DEFAULT_ENTRY_NOUN} from '@/lib/extraction/entryKey';

// =================== MODES ===================

/** Which create variant the dialog runs (B-8 D3). */
export type AddSectionMode =
  | {kind: 'root'}
  | {kind: 'group'}
  | {kind: 'perModel'; parentId: string; parentLabel: string; entryNoun: string};

// =================== SCHEMAS ===================

/** One superset shape across modes (react-hook-form needs a single form
 * type); honesty per mode lives in WHICH controls render and in the
 * submit mapping below — group mode fixes cardinality 'many' through its
 * default value and is_required false, and the server 422s any contract
 * breach anyway. */
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
}).superRefine((data, ctx) => {
  // A repeating section is created WITH its entry noun (the server 422s a
  // blank one); a section that repeats once carries none.
  if (data.cardinality === 'many' && !data.entry_label?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['entry_label'],
      message: t('templateConfig', 'entryLabelRequired'),
    });
  }
});

/* `is_required` carries a `.default()`, so the schema's input and output
 * types differ (optional before parse, guaranteed after). @hookform/resolvers
 * v5 types that split faithfully, so useForm must be told both: values are
 * the INPUT shape, handleSubmit receives the parsed OUTPUT. */
type AddSectionInput = z.input<ReturnType<typeof getAddSectionSchema>>;
type AddSectionOutput = z.output<ReturnType<typeof getAddSectionSchema>>;

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
  const noun = mode.kind === 'perModel' ? mode.entryNoun : DEFAULT_ENTRY_NOUN;

  const form = useForm<AddSectionInput, unknown, AddSectionOutput>({
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
  // The entry-label field follows the cardinality: a group always repeats
  // (its default is 'many'), the other modes repeat when the select says so.
  const cardinality = useWatch({control: form.control, name: 'cardinality'});
  const repeats = cardinality === 'many';

    // Auto-generate name when label changes
  useEffect(() => {
    if (autoGenerateName && label) {
      const generatedName = generateSnakeCaseName(label);
      form.setValue('name', generatedName);
    }
  }, [label, autoGenerateName, form]);

  const handleSubmit = async (data: AddSectionOutput) => {
    setLoading(true);

    const result = await createSection({
      projectId,
      templateId,
      name: data.name,
      label: data.label,
      description: data.description?.trim() || null,
      cardinality: data.cardinality,
      role: ROLE_BY_MODE[mode.kind],
      parentEntityTypeId: mode.kind === 'perModel' ? mode.parentId : null,
      // The schema already refused a blank noun on a repeating section.
      entryLabel: data.cardinality === 'many' ? data.entry_label?.trim() : undefined,
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
                      {t('extraction', 'sectionLabelHint')}
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
                      {t('extraction', 'sectionNameLabel')}
                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Switch
                            aria-label={t('extraction', 'autoNameAriaLabel')}
                            checked={autoGenerateName}
                            onCheckedChange={setAutoGenerateName}
                          />
                        </TooltipTrigger>
                        <TooltipContent>{t('extraction', 'autoNameTooltip')}</TooltipContent>
                      </Tooltip>
                      <span className="text-xs text-muted-foreground">
                        {t('extraction', 'autoNameLabel')}
                      </span>
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
                      {t('extraction', 'sectionNameHint')}{' '}
                      {autoGenerateName && t('extraction', 'sectionNameAutoGenerated')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

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

            {/* Entry label — every repeating section is created with its noun:
                what one entry is called in the prompts and on the run form.
                The placeholder is the fallback a legacy blank reads as. */}
            {repeats && (
              <FormField
                control={form.control}
                name="entry_label"
                render={({field}) => (
                  <FormItem>
                    <FormLabel>{t('templateConfig', 'entryLabelLabel')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={DEFAULT_ENTRY_NOUN}
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

            {/* Description — the section's AI instruction, in every mode */}
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
                    {t('templateConfig', 'sectionDescriptionHint')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                        {t('extraction', 'sectionRequiredHint')}
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
                size="sm"
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={loading}
              >
                  {t('common', 'cancel')}
              </Button>
              <Button size="sm" type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      {t('extraction', 'creating')}
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
