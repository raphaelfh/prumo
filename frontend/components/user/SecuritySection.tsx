/**
 * Security section: change password and security settings.
 */

import {useState} from 'react';
import {useForm, useWatch} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {Button} from '@/components/ui/button';
import {Form, FormControl, FormField, FormItem, FormMessage} from '@/components/ui/form';
import {Input} from '@/components/ui/input';
import {IconButton} from '@/components/patterns/IconButton';
import {SettingsActions, SettingsGroup, SettingsPage, SettingsRow} from '@/components/settings';
import {AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, Lock} from 'lucide-react';
import {toast} from 'sonner';
import {updateUserPassword} from '@/services/authService';
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

    const schema = z
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
        });

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {newPassword: '', confirmPassword: ''},
    });

    // useWatch instead of form.watch — the latter is incompatible with the
    // React Compiler (react-hooks/incompatible-library).
    const newPassword = useWatch({control: form.control, name: 'newPassword'}) ?? '';
    const confirmPassword = useWatch({control: form.control, name: 'confirmPassword'}) ?? '';
    const passwordStrength = getPasswordStrength(newPassword);
    const passwordsMatch = newPassword === confirmPassword && confirmPassword !== '';

    const onSubmit = async (values: FormValues) => {
    setLoading(true);
    const result = await updateUserPassword(values.newPassword);
    setLoading(false);
    if (!result.ok) {
        console.error('Error changing password:', result.error);
        toast.error(result.error.message || t('user', 'securityErrorChanging'));
        return;
    }
    toast.success(t('user', 'securityPasswordChanged'));
    form.reset();
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <SettingsPage intro={t('user', 'securityAlertDescription')}>
          <SettingsGroup>
            <FormField
              control={form.control}
              name="newPassword"
              render={({field}) => (
                <FormItem className="space-y-0">
                  <SettingsRow label={t('user', 'securityNewPasswordLabel')} htmlFor="security-new-password" align="start">
                    <div className="flex items-center gap-1">
                      <FormControl>
                        <Input
                          id="security-new-password"
                          variant="quiet"
                          {...field}
                          type={showPasswords.new ? 'text' : 'password'}
                          placeholder={t('user', 'securityNewPasswordPlaceholder')}
                        />
                      </FormControl>
                      <IconButton
                        label={showPasswords.new ? t('user', 'securityAriaHidePassword') : t('user', 'securityAriaShowPassword')}
                        icon={showPasswords.new ? <EyeOff className="h-4 w-4" strokeWidth={1.5}/> : <Eye className="h-4 w-4" strokeWidth={1.5}/>}
                        onClick={() => setShowPasswords({...showPasswords, new: !showPasswords.new})}
                      />
                    </div>
                    {newPassword && (
                      <div className="space-y-1.5 px-2 pt-1">
                        <div className="flex items-center justify-between text-[12px]">
                          <span className="text-muted-foreground">{t('user', 'securityPasswordStrength')}</span>
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
                                i < passwordStrength.strength ? passwordStrength.colorClass : 'bg-muted',
                              )}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    <FormMessage/>
                  </SettingsRow>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirmPassword"
              render={({field}) => (
                <FormItem className="space-y-0">
                  <SettingsRow label={t('user', 'securityConfirmLabel')} htmlFor="security-confirm-password" align="start">
                    <div className="flex items-center gap-1">
                      <FormControl>
                        <Input
                          id="security-confirm-password"
                          variant="quiet"
                          {...field}
                          type={showPasswords.confirm ? 'text' : 'password'}
                          placeholder={t('user', 'securityConfirmPlaceholder')}
                        />
                      </FormControl>
                      <IconButton
                        label={showPasswords.confirm ? t('user', 'securityAriaHideConfirm') : t('user', 'securityAriaShowConfirm')}
                        icon={showPasswords.confirm ? <EyeOff className="h-4 w-4" strokeWidth={1.5}/> : <Eye className="h-4 w-4" strokeWidth={1.5}/>}
                        onClick={() => setShowPasswords({...showPasswords, confirm: !showPasswords.confirm})}
                      />
                    </div>
                    {confirmPassword && (
                      <div className="flex items-center gap-1.5 px-2 pt-0.5 text-[12px]">
                        {passwordsMatch ? (
                          <>
                            <CheckCircle2 className="h-3 w-3 text-success" strokeWidth={1.5}/>
                            <span className="text-success">{t('user', 'securityPasswordsMatch')}</span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="h-3 w-3 text-destructive" strokeWidth={1.5}/>
                            <span className="text-destructive">{t('user', 'securityPasswordsDoNotMatch')}</span>
                          </>
                        )}
                      </div>
                    )}
                    <FormMessage/>
                  </SettingsRow>
                </FormItem>
              )}
            />

            <SettingsActions>
              <Button type="submit" size="sm" disabled={loading}>
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
            </SettingsActions>
          </SettingsGroup>
        </SettingsPage>
      </form>
    </Form>
  );
}
