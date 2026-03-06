/**
 * Dialog to add a new extraction field
 *
 * Features:
 * - Form with react-hook-form + zod
 * - Auto-generated name (snake_case) from label
 * - Real-time validation
 * - Conditional fields (unit for number, allowed_values for select)
 * - Visual error feedback
 *
 * @component
 */

import {useEffect, useState} from 'react';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
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
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {Switch} from '@/components/ui/switch';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue,} from '@/components/ui/select';
import {Info, Loader2} from 'lucide-react';
import {Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,} from '@/components/ui/form';
import {ExtractionField, ExtractionFieldInput, ExtractionFieldSchema,} from '@/types/extraction';
import {AllowedValuesList} from './AllowedValuesList';
import {AllowedUnitsList} from './AllowedUnitsList';
import {t} from '@/lib/copy';

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
 * Generate snake_case name from a label
 */
function generateSnakeCaseName(label: string): string {
  return label
    .toLowerCase()
      .normalize('NFD') // Normalize to decompose accents
      .replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/[^a-z0-9]+/g, '_') // Replace non-alphanumeric with _
      .replace(/^_+|_+$/g, '') // Remove leading/trailing _
      .replace(/_+/g, '_'); // Collapse consecutive _
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

    // Auto-generate name when label changes
  useEffect(() => {
    if (autoGenerateName && label) {
      const generatedName = generateSnakeCaseName(label);
      form.setValue('name', generatedName);
    }
  }, [label, autoGenerateName, form]);

  const handleSubmit = async (data: ExtractionFieldInput) => {
    setLoading(true);
    try {
        // Configure "Other (specify)" support via dedicated flags
      const finalData = { 
        ...data,
        allow_other: (fieldType === 'select' || fieldType === 'multiselect') ? allowOther : false,
          other_label: (fieldType === 'select' || fieldType === 'multiselect') && allowOther ? (data as any).other_label || t('extraction', 'otherSpecifyDefault') : null,
        other_placeholder: (fieldType === 'select' || fieldType === 'multiselect') && allowOther ? (data as any).other_placeholder || null : null,
      } as any;

      const result = await onSave(finalData);
      if (result) {
          // Don't create/remove auxiliary fields; "Other" is inline
          // Reset form and close
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
            <DialogTitle>{t('extraction', 'addFieldTitle')}</DialogTitle>
          <DialogDescription>
            {sectionName ? (
                <>{t('extraction', 'addFieldDescInSection')} <strong>{sectionName}</strong></>
            ) : (
                t('extraction', 'addFieldDescDefault')
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
                      placeholder={t('extraction', 'placeholderLabelExample')}
                      disabled={loading}
                    />
                  </FormControl>
                  <FormDescription>
                      Name shown to reviewers when extracting data
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
                      Technical name <span className="text-destructive">*</span>
                  </FormLabel>
                  <div className="flex items-center gap-2">
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={t('extraction', 'placeholderNameExample')}
                        className="font-mono text-sm"
                        disabled={loading}
                        onChange={(e) => {
                          field.onChange(e);
                            // Disable auto-generation if user edits manually
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
                      Internal field name (snake_case). Auto-generated from label.
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
                    <FormLabel>{t('extraction', 'editFieldTypeLabel')}</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={loading}
                  >
                    <FormControl>
                      <SelectTrigger>
                          <SelectValue placeholder={t('extraction', 'selectTypePlaceholder')}/>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                        <SelectItem value="text">{t('extraction', 'fieldTypeText')}</SelectItem>
                        <SelectItem value="number">{t('extraction', 'fieldTypeNumber')}</SelectItem>
                        <SelectItem value="date">{t('extraction', 'fieldTypeDate')}</SelectItem>
                        <SelectItem value="select">{t('extraction', 'fieldTypeSelect')}</SelectItem>
                        <SelectItem value="multiselect">{t('extraction', 'fieldTypeMultiselect')}</SelectItem>
                        <SelectItem value="boolean">{t('extraction', 'fieldTypeBoolean')}</SelectItem>
                    </SelectContent>
                  </Select>
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
                    <FormLabel>{t('extraction', 'editFieldDescription')}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value || ''}
                      placeholder={t('extraction', 'fieldDescriptionPlaceholder')}
                      rows={3}
                      disabled={loading}
                    />
                  </FormControl>
                  <FormDescription>
                      {t('extraction', 'editFieldDescriptionHint')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

              {/* AI instruction */}
            <FormField
              control={form.control}
              name="llm_description"
              render={({ field }) => (
                <FormItem>
                    <FormLabel>{t('extraction', 'editFieldLLMInstruction')}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value || ''}
                      placeholder={t('extraction', 'examplePlaceholder')}
                      rows={3}
                      disabled={loading}
                    />
                  </FormControl>
                  <FormDescription>
                      {t('extraction', 'editFieldLLMInstructionDesc')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

              {/* Available units (conditional - numbers only) */}
            {fieldType === 'number' && (
              <FormField
                control={form.control}
                name="allowed_units"
                render={({ field }) => (
                  <FormItem>
                      <FormLabel>{t('extraction', 'editFieldUnitsAvailable')}</FormLabel>
                    <AllowedUnitsList
                      values={Array.isArray(field.value) ? field.value : []}
                      onChange={(newUnits) => {
                        field.onChange(newUnits.length > 0 ? newUnits : null);
                          // Sync unit with first unit
                        if (newUnits.length > 0) {
                          form.setValue('unit', newUnits[0]);
                        } else {
                          form.setValue('unit', null);
                        }
                      }}
                      disabled={loading}
                    />
                    <FormDescription>
                        {t('extraction', 'configureUnitsDesc')} {t('extraction', 'firstUnitDefault')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

              {/* Allowed values (conditional - for select/multiselect) */}
            {(fieldType === 'select' || fieldType === 'multiselect') && (
              <>
                <FormField
                  control={form.control}
                  name="allowed_values"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                          {t('extraction', 'allowedValuesLabel')} <span className="text-destructive">*</span>
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

                  {/* Option: Allow "Other (specify)" */}
                <div className="space-y-3 rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <div>
                        <Label className="font-medium">{t('extraction', 'allowOtherSpecifyLabel')}</Label>
                        <p className="text-xs text-muted-foreground mt-1">{t('extraction', 'otherOptionInlineHint')}</p>
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
                              <FormLabel>{t('extraction', 'otherLabelLabel')}</FormLabel>
                            <FormControl>
                                <Input {...field} placeholder={t('extraction', 'otherSpecifyDefault')}
                                       disabled={loading}/>
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
                              <FormLabel>{t('extraction', 'placeholderLabel')}</FormLabel>
                            <FormControl>
                                <Input {...field} placeholder={t('extraction', 'placeholderTypeHere')}
                                       disabled={loading}/>
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

              {/* Required field */}
            <FormField
              control={form.control}
              name="is_required"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                      <FormLabel className="text-base">{t('extraction', 'editFieldRequired')}</FormLabel>
                    <FormDescription>
                        {t('extraction', 'editFieldRequiredDesc')}
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
                    <p className="font-medium">{t('extraction', 'addFieldTipsTitle')}</p>
                  <ul className="mt-1 list-disc list-inside space-y-1 text-xs">
                      <li>{t('extraction', 'addFieldTipName')}</li>
                      <li>{t('extraction', 'unitsAvailableHint')}</li>
                      <li>{t('extraction', 'addFieldTipUnitsEmpty')}</li>
                      <li>{t('extraction', 'addFieldTipSelectOptions')}</li>
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
                  {t('common', 'cancel')}
              </Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t('extraction', 'addFieldButtonLabel')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

