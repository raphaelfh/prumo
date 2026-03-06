/**
 * Dialog to add a new item to the assessment instrument
 *
 * Follows AddSectionDialog (Extraction) pattern:
 * - react-hook-form + zodResolver for validation
 * - shadcn Form components
 * - Loading state during submit
 * - form.reset() on close
 * - toast.success() / toast.error() for feedback
 *
 * Reuses AllowedValuesList from Extraction module for
 * allowedLevels field (multi-value string[]).
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
import {t} from '@/lib/copy';

// =================== CONSTANTS ===================

const NEW_DOMAIN_SENTINEL = '__novo_dominio__';

// =================== SCHEMAS ===================

const AddItemSchema = z.object({
    domain: z.string().min(1, 'Domain is required'),
  customDomain: z.string().optional(),
  itemCode: z
    .string()
      .min(1, 'Code is required')
      .max(50, 'Code must be at most 50 characters'),
  question: z
    .string()
      .min(1, 'Question is required')
      .max(2000, 'Question must be at most 2000 characters'),
  description: z
    .string()
      .max(2000, 'Description must be at most 2000 characters')
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
      message: 'New domain name is required',
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
        toast.error(t('assessment', 'addItemAddOneLevel'));
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

        toast.success(t('assessment', 'addItemSuccess'));

      form.reset();
      setAllowedLevels(defaultAllowedLevels);
      onOpenChange(false);
      onItemAdded();
    } catch (error: any) {
        console.error('Error adding item:', error);
        toast.error(`${t('assessment', 'addItemError')}: ${error.message || t('assessment', 'addItemErrorUnknown')}`);
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
              {t('assessment', 'addItemTitle')}
          </DialogTitle>
          <DialogDescription>
              {t('assessment', 'addItemDesc')}
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
                    <FormLabel>{t('assessment', 'addItemDomainLabel')}</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                          <SelectValue placeholder={t('assessment', 'addItemDomainPlaceholder')}/>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {existingDomains.map((domain) => (
                        <SelectItem key={domain} value={domain}>
                          {domain}
                        </SelectItem>
                      ))}
                      <SelectItem value={NEW_DOMAIN_SENTINEL}>
                          {t('assessment', 'addItemNewDomainOption')}
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
                      <FormLabel>{t('assessment', 'addItemNewDomainLabel')}</FormLabel>
                    <FormControl>
                      <Input
                          placeholder={t('assessment', 'addItemNewDomainPlaceholder')}
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
                    <FormLabel>{t('assessment', 'addItemCodeLabel')}</FormLabel>
                  <FormControl>
                    <Input
                        placeholder={t('assessment', 'addItemCodePlaceholder')}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                      {t('assessment', 'addItemCodeDesc')}
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
                    <FormLabel>{t('assessment', 'addItemQuestionLabel')}</FormLabel>
                  <FormControl>
                    <Textarea
                        placeholder={t('assessment', 'addItemQuestionPlaceholder')}
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
                    <FormLabel>{t('assessment', 'addItemDescriptionLabel')}</FormLabel>
                  <FormControl>
                    <Textarea
                        placeholder={t('assessment', 'addItemDescriptionPlaceholder')}
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
                <FormLabel>{t('assessment', 'addItemAllowedLevelsLabel')}</FormLabel>
              <AllowedValuesList
                values={allowedLevels}
                onChange={setAllowedLevels}
                disabled={loading}
              />
              {allowedLevels.length === 0 && (
                <p className="text-xs text-destructive">
                    {t('assessment', 'addItemAddOneLevel')}
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
                      <FormLabel className="text-base">{t('assessment', 'addItemRequiredLabel')}</FormLabel>
                    <FormDescription>
                        {t('assessment', 'addItemRequiredDesc')}
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
                      {t('assessment', 'addItemAdding')}
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                      {t('assessment', 'addItemSubmit')}
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
