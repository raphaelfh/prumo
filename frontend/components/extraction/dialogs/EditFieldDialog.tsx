/**
 * Dialog to edit an existing extraction field
 *
 * Features:
 * - Full edit of all attributes
 * - Type change validation (disallow if field has extracted data)
 * - Unit editor with suggestions
 * - allowed_values editor with drag-drop
 * - Real-time validation
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
import {Textarea} from '@/components/ui/textarea';
import {Switch} from '@/components/ui/switch';
import {Label} from '@/components/ui/label';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue,} from '@/components/ui/select';
import {AlertTriangle, Info, Loader2} from 'lucide-react';
import {Alert, AlertDescription} from '@/components/ui/alert';
import {Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,} from '@/components/ui/form';
import {
    ExtractionField,
    ExtractionFieldSchema,
    ExtractionFieldUpdate,
    FieldValidationResult,
} from '@/types/extraction';
import {AllowedValuesList} from './AllowedValuesList';
import {AllowedUnitsList} from './AllowedUnitsList';
import {t} from '@/lib/copy';

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
      llm_description: null,
      validation_schema: {},
    },
  });

  const fieldType = form.watch('field_type');

    // Load field data when opening
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
        llm_description: field.llm_description || '',
        validation_schema: field.validation_schema || {},
        allow_other: field.allow_other || false,
        other_label: field.other_label || null,
        other_placeholder: field.other_placeholder || null,
      });

        // Fetch field validation
      loadValidation();
    }
  }, [field, open, form]);

  const loadValidation = async () => {
    if (!field) return;
    
    try {
      const result = await onValidate(field.id);
      setValidation(result);
    } catch (err) {
        console.error('Error validating field:', err);
    }
  };

  const handleTypeChange = async (newType: string) => {
    if (!field || !validation) return;

      // If changing type and field has extracted data
    if (newType !== field.field_type && !validation.canChangeType) {
      setValidatingType(true);
        // Revalidate to be sure
      const freshValidation = await onValidate(field.id);
      setValidation(freshValidation);
      setValidatingType(false);

      if (!freshValidation.canChangeType) {
          form.setValue('field_type', field.field_type); // Revert
        return;
      }
    }

    form.setValue('field_type', newType as any);

      // Clear allowed_values if not select/multiselect
    if (newType !== 'select' && newType !== 'multiselect') {
      form.setValue('allowed_values', null);
    }

      // Clear unit and allowed_units if not number
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
            <DialogTitle>{t('extraction', 'editFieldTitle')}</DialogTitle>
          <DialogDescription>
            {sectionName ? (
                <>{t('extraction', 'editFieldDescInSection').replace('{{label}}', field.label).replace('{{section}}', sectionName)}</>
            ) : (
                <>{t('extraction', 'editFieldDescDefault').replace('{{label}}', field.label)}</>
            )}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left column - Basic info */}
              <div className="space-y-4">
                <div>
                    <h3 className="text-lg font-medium mb-4">{t('extraction', 'editFieldBasicInfo')}</h3>
                  
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

                  {/* Name (readonly, for reference) */}
                <div>
                    <Label>{t('extraction', 'editFieldTechnicalName')}</Label>
                  <Input
                    value={field.name}
                    disabled
                    className="font-mono text-sm bg-muted"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                      {t('extraction', 'editFieldTechnicalNameHint')}
                  </p>
                </div>

                {/* Tipo */}
                <FormField
                  control={form.control}
                  name="field_type"
                  render={({ field: formField }) => (
                    <FormItem>
                        <FormLabel>{t('extraction', 'editFieldTypeLabel')}</FormLabel>
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
                            <SelectItem value="text">{t('extraction', 'fieldTypeText')}</SelectItem>
                            <SelectItem value="number">{t('extraction', 'fieldTypeNumber')}</SelectItem>
                            <SelectItem value="date">{t('extraction', 'fieldTypeDate')}</SelectItem>
                            <SelectItem value="select">{t('extraction', 'fieldTypeSelect')}</SelectItem>
                            <SelectItem value="multiselect">{t('extraction', 'fieldTypeMultiselect')}</SelectItem>
                            <SelectItem value="boolean">{t('extraction', 'fieldTypeBoolean')}</SelectItem>
                        </SelectContent>
                      </Select>
                      {validation && !validation.canChangeType && (
                        <Alert className="mt-2">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription>
                              {t('extraction', 'cannotChangeTypeValues').replace('{{count}}', String(validation.extractedValuesCount))}
                          </AlertDescription>
                        </Alert>
                      )}
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
                          rows={4}
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
                          checked={field.value || false}
                          onCheckedChange={field.onChange}
                          disabled={loading}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

                {/* Right column - Specific settings */}
              <div className="space-y-4">
                <div>
                    <h3 className="text-lg font-medium mb-4">{t('extraction', 'editFieldSpecificSettings')}</h3>

                    {/* Available units (conditional - for numbers) */}
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
                              {t('extraction', 'configureUnitsDesc')} {t('extraction', 'firstUnitDefaultShort')}
                            {validation && validation.extractedValuesCount > 0 && (
                              <span className="block mt-1 text-amber-600">
                                ⚠️ {t('extraction', 'changesAffectNewOnly').replace('{{count}}', String(validation.extractedValuesCount))}
                              </span>
                            )}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                    {/* Allowed values (conditional - for select) */}
                  {(fieldType === 'select' || fieldType === 'multiselect') && (
                    <>
                    <FormField
                      control={form.control}
                      name="allowed_values"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                              Allowed values <span className="text-destructive">*</span>
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

                        {/* Option: Allow "Other (specify)" */}
                      <div className="space-y-3 rounded-lg border p-4">
                        <div className="flex items-center justify-between">
                          <div>
                              <Label className="font-medium">{t('extraction', 'allowOtherSpecifyLabel')}</Label>
                              <p className="text-xs text-muted-foreground mt-1">{t('extraction', 'otherOptionInlineHint')}</p>
                          </div>
                          <FormField
                            control={form.control}
                            name="allow_other"
                            render={({ field }) => (
                              <FormControl>
                                <Switch
                                  checked={field.value || false}
                                  onCheckedChange={field.onChange}
                                  disabled={loading}
                                />
                              </FormControl>
                            )}
                          />
                        </div>

                        {form.watch('allow_other') && (
                          <div className="grid grid-cols-2 gap-3">
                            <FormField
                              control={form.control}
                              name="other_label"
                              render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('extraction', 'otherLabelLabel')}</FormLabel>
                                  <FormControl>
                                    <Input 
                                      {...field} 
                                      value={field.value || ''}
                                      placeholder={t('extraction', 'otherSpecifyDefault')} 
                                      disabled={loading} 
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name="other_placeholder"
                              render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t('extraction', 'placeholderLabel')}</FormLabel>
                                  <FormControl>
                                    <Input 
                                      {...field} 
                                      value={field.value || ''}
                                      placeholder={t('extraction', 'placeholderTypeHere')} 
                                      disabled={loading} 
                                    />
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
                </div>
              </div>
            </div>

              {/* Info about impact (if field has extracted data) */}
            {validation && validation.extractedValuesCount > 0 && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                    {t('extraction', 'editFieldWarningExtracted')
                        .replace('{{count}}', String(validation.extractedValuesCount))
                        .replace('{{n}}', String(validation.affectedArticles.length))}
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
                  {t('extraction', 'editFieldCancel')}
              </Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t('extraction', 'editFieldSaveChanges')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
