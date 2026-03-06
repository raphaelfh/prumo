/**
 * Security section: change password and security settings.
 */

import {useMemo, useState} from 'react';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {Button} from '@/components/ui/button';
import {Alert, AlertDescription} from '@/components/ui/alert';
import {Form, FormControl, FormField, FormItem, FormMessage} from '@/components/ui/form';
import {Input} from '@/components/ui/input';
import {SettingsSection, SettingsCard, SettingsField} from '@/components/settings';
import {AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, Lock} from 'lucide-react';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';
import {cn} from '@/lib/utils';
import {t} from '@/lib/copy';

type FormValues = { newPassword: string; confirmPassword: string };

const getPasswordStrength = (password: string) => {
    if (!password) return {strength: 0, labelKey: '' as const, colorClass: '', textClass: ''};
    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;
    if (strength <= 2) return {
        strength,
        labelKey: 'securityStrengthWeak' as const,
        colorClass: 'bg-destructive',
        textClass: 'text-destructive'
    };
    if (strength <= 4) return {
        strength,
        labelKey: 'securityStrengthMedium' as const,
        colorClass: 'bg-warning',
        textClass: 'text-warning'
    };
    return {strength, labelKey: 'securityStrengthStrong' as const, colorClass: 'bg-success', textClass: 'text-success'};
};

export function SecuritySection() {
    const [loading, setLoading] = useState(false);
    const [showPasswords, setShowPasswords] = useState({new: false, confirm: false});

    const schema = useMemo(
        () =>
            z
                .object({
                    newPassword: z
                        .string()
                        .min(8, t('user', 'securitySchemaMin'))
                        .regex(/[A-Z]/, t('user', 'securitySchemaUppercase'))
                        .regex(/[a-z]/, t('user', 'securitySchemaLowercase'))
                        .regex(/[0-9]/, t('user', 'securitySchemaNumber')),
                    confirmPassword: z.string().min(1, t('user', 'securitySchemaConfirm')),
                })
                .refine((data) => data.newPassword === data.confirmPassword, {
                    message: t('user', 'securitySchemaMismatch'),
                    path: ['confirmPassword'],
                }),
        []
    );

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {newPassword: '', confirmPassword: ''},
    });

    const newPassword = form.watch('newPassword') ?? '';
    const confirmPassword = form.watch('confirmPassword') ?? '';
    const passwordStrength = getPasswordStrength(newPassword);
    const passwordsMatch = newPassword === confirmPassword && confirmPassword !== '';

    const onSubmit = async (values: FormValues) => {
    setLoading(true);
    try {
        const {error} = await supabase.auth.updateUser({password: values.newPassword});
      if (error) throw error;

        toast.success(t('user', 'securityPasswordChanged'));
        form.reset();
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('user', 'securityErrorChanging');
        console.error('Error changing password:', err);
        toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
      <SettingsSection title={t('user', 'securityTitle')} description={t('user', 'securityDescription')}>
          <SettingsCard title={t('user', 'securityCardTitle')} description={t('user', 'securityCardDescription')}>
              <Alert className="border-border/40">
                  <Lock className="h-4 w-4" strokeWidth={1.5}/>
                  <AlertDescription className="text-[13px]">
                      {t('user', 'securityAlertDescription')}
          </AlertDescription>
        </Alert>

              <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                      <FormField
                          control={form.control}
                          name="newPassword"
                          render={({field}) => (
                              <FormItem>
                                  <SettingsField
                                      label={t('user', 'securityNewPasswordLabel')}
                                      htmlFor="security-new-password"
                                      hint={t('user', 'securityNewPasswordHint')}
                                  >
                                      <FormControl>
                                          <div className="relative">
                                              <Input
                                                  id="security-new-password"
                                                  {...field}
                                                  type={showPasswords.new ? 'text' : 'password'}
                                                  placeholder={t('user', 'securityNewPasswordPlaceholder')}
                                                  className="h-9 text-[13px]"
                                              />
                                              <Button
                                                  type="button"
                                                  variant="ghost"
                                                  size="sm"
                                                  className="absolute right-1 top-1 h-7"
                                                  aria-label={showPasswords.new ? t('user', 'securityAriaHidePassword') : t('user', 'securityAriaShowPassword')}
                                                  onClick={() => setShowPasswords({
                                                      ...showPasswords,
                                                      new: !showPasswords.new
                                                  })}
                                              >
                                                  {showPasswords.new ? (
                                                      <EyeOff className="h-4 w-4" strokeWidth={1.5}/>
                                                  ) : (
                                                      <Eye className="h-4 w-4" strokeWidth={1.5}/>
                                                  )}
                                              </Button>
                                          </div>
                                      </FormControl>
                                  </SettingsField>
                                  {newPassword && (
                                      <div className="space-y-1.5 pt-1">
                                          <div className="flex items-center justify-between text-[12px]">
                                              <span
                                                  className="text-muted-foreground">{t('user', 'securityPasswordStrength')}</span>
                                              <span className={cn('font-medium', passwordStrength.textClass)}>
                          {passwordStrength.labelKey ? t('user', passwordStrength.labelKey) : ''}
                        </span>
                                          </div>
                                          <div className="flex gap-1">
                                              {[...Array(6)].map((_, i) => (
                                                  <div
                                                      key={i}
                                                      className={cn(
                                                          'h-1 flex-1 rounded-full transition-colors duration-150',
                                                          i < passwordStrength.strength ? passwordStrength.colorClass : 'bg-muted'
                                                      )}
                                                  />
                                              ))}
                                          </div>
                                      </div>
                                  )}
                                  <FormMessage/>
                              </FormItem>
                          )}
                      />

                      <FormField
                          control={form.control}
                          name="confirmPassword"
                          render={({field}) => (
                              <FormItem>
                                  <SettingsField
                                      label={t('user', 'securityConfirmLabel')}
                                      htmlFor="security-confirm-password"
                                      hint={t('user', 'securityConfirmHint')}
                                  >
                                      <FormControl>
                                          <div className="relative">
                                              <Input
                                                  id="security-confirm-password"
                                                  {...field}
                                                  type={showPasswords.confirm ? 'text' : 'password'}
                                                  placeholder={t('user', 'securityConfirmPlaceholder')}
                                                  className="h-9 text-[13px]"
                                              />
                                              <Button
                                                  type="button"
                                                  variant="ghost"
                                                  size="sm"
                                                  className="absolute right-1 top-1 h-7"
                                                  aria-label={showPasswords.confirm ? t('user', 'securityAriaHideConfirm') : t('user', 'securityAriaShowConfirm')}
                                                  onClick={() =>
                                                      setShowPasswords({
                                                          ...showPasswords,
                                                          confirm: !showPasswords.confirm
                                                      })
                                                  }
                                              >
                                                  {showPasswords.confirm ? (
                                                      <EyeOff className="h-4 w-4" strokeWidth={1.5}/>
                                                  ) : (
                                                      <Eye className="h-4 w-4" strokeWidth={1.5}/>
                                                  )}
                                              </Button>
                                          </div>
                                      </FormControl>
                                  </SettingsField>
                                  {confirmPassword && (
                                      <div className="flex items-center gap-1.5 text-[12px] pt-0.5">
                                          {passwordsMatch ? (
                                              <>
                                                  <CheckCircle2 className="h-3 w-3 text-success" strokeWidth={1.5}/>
                                                  <span
                                                      className="text-success">{t('user', 'securityPasswordsMatch')}</span>
                                              </>
                                          ) : (
                                              <>
                                                  <AlertCircle className="h-3 w-3 text-destructive" strokeWidth={1.5}/>
                                                  <span
                                                      className="text-destructive">{t('user', 'securityPasswordsDoNotMatch')}</span>
                                              </>
                                          )}
                                      </div>
                                  )}
                                  <FormMessage/>
                              </FormItem>
                          )}
                      />

                      <div className="flex justify-end pt-4 border-t border-border/40">
                          <Button type="submit" disabled={loading}>
                              {loading ? (
                                  <>
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.5}/>
                                      {t('user', 'securityUpdating')}
                                  </>
                              ) : (
                                  <>
                                      <Lock className="mr-2 h-4 w-4" strokeWidth={1.5}/>
                                      {t('user', 'securityChangePassword')}
                                  </>
                              )}
                          </Button>
                      </div>
                  </form>
              </Form>
          </SettingsCard>
      </SettingsSection>
  );
}
