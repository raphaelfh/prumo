/**
 * User profile section: view and edit profile information.
 */

import {useEffect, useMemo, useState} from 'react';
import {useForm, useWatch} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {Button} from '@/components/ui/button';
import {Form, FormControl, FormField, FormItem, FormMessage} from '@/components/ui/form';
import {Input} from '@/components/ui/input';
import {Skeleton} from '@/components/ui/skeleton';
import {Avatar, AvatarFallback, AvatarImage} from '@/components/ui/avatar';
import {SettingsSection, SettingsCard, SettingsField} from '@/components/settings';
import {CheckCircle2, Loader2, User} from 'lucide-react';
import {fetchProfile, saveProfile} from '@/services/profileService';
import {toast} from 'sonner';
import {t} from '@/lib/copy';

type FormValues = { full_name: string };

const getInitials = (name: string) =>
    name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);

export function ProfileSection() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
    const [email, setEmail] = useState('');
    const [avatarUrl, setAvatarUrl] = useState('');

    const schema = useMemo(
        () =>
            z.object({
                full_name: z
                    .string()
                    .min(1, t('user', 'profileNameRequired'))
                    .max(100, t('user', 'profileNameMaxLength')),
            }),
        []
    );

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {full_name: ''},
  });

  const loadProfile = async () => {
    setLoading(true);
    const result = await fetchProfile();
    if (!result.ok) {
      console.error('Error loading profile:', result.error);
      toast.error(t('user', 'profileErrorLoading'));
    } else if (result.data === null) {
      toast.error(t('user', 'profileErrorNotAuthenticated'));
    } else {
      setEmail(result.data.email);
      setAvatarUrl(result.data.avatarUrl);
      form.reset({full_name: result.data.fullName});
    }
    setLoading(false);
  };

  useEffect(() => {
    // Microtask so the loader's setState calls run in an async callback.
    queueMicrotask(() => void loadProfile());
  }, []);

  const onSubmit = async (values: FormValues) => {
    setSaving(true);
    const result = await saveProfile({fullName: values.full_name, avatarUrl});
    if (result.ok) {
      toast.success(t('user', 'profileUpdated'));
    } else {
      console.error('Error saving profile:', result.error);
      toast.error(result.error.message || t('user', 'profileErrorSaving'));
    }
    setSaving(false);
  };

    // useWatch instead of form.watch — the latter is incompatible with the
    // React Compiler (react-hooks/incompatible-library).
    const fullName = useWatch({control: form.control, name: 'full_name'}) ?? '';

  if (loading) {
    return (
        <SettingsSection title={t('user', 'profileTitle')} description={t('user', 'profileDescription')}>
            <SettingsCard title={t('user', 'profileCardTitle')} description={t('user', 'profileCardDescription')}>
                <div className="space-y-4">
                    <div className="flex items-center gap-4">
                        <Skeleton className="h-16 w-16 rounded-full"/>
                        <div className="space-y-1">
                            <Skeleton className="h-[13px] w-24"/>
                            <Skeleton className="h-3 w-32"/>
                        </div>
                    </div>
                    <Skeleton className="h-9 w-full"/>
                    <Skeleton className="h-9 w-full"/>
                    <div className="flex justify-end pt-4 border-t border-border/40">
                        <Skeleton className="h-9 w-28"/>
                    </div>
          </div>
            </SettingsCard>
        </SettingsSection>
    );
  }

  return (
      <SettingsSection title={t('user', 'profileTitle')} description={t('user', 'profileDescription')}>
          <SettingsCard title={t('user', 'profileCardTitle')} description={t('user', 'profileCardDescription')}>
              <div className="space-y-4">
                  <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
                <AvatarImage src={avatarUrl} alt={fullName}/>
                <AvatarFallback className="text-base bg-primary/10 text-primary">
                    {fullName ? getInitials(fullName) : <User className="h-6 w-6"/>}
                </AvatarFallback>
            </Avatar>
            <div>
                <p className="text-[13px] font-medium">{t('user', 'profilePicture')}</p>
                <p className="text-[12px] text-muted-foreground">{t('user', 'profileUploadComingSoon')}</p>
            </div>
                  </div>

                  <SettingsField
                      label={t('user', 'profileEmailLabel')}
                      htmlFor="profile-email"
                      hint={t('user', 'profileEmailHint')}
                  >
                      <Input
                          id="profile-email"
                          type="email"
                          value={email}
                          disabled
                          className="h-9 text-[13px] bg-muted text-muted-foreground"
                          aria-label={t('user', 'profileEmailAria')}
                      />
                  </SettingsField>

                  <Form {...form}>
                      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                          <FormField
                              control={form.control}
                              name="full_name"
                              render={({field}) => (
                                  <FormItem>
                                      <SettingsField
                                          label={t('user', 'profileFullNameLabel')}
                                          htmlFor="profile-fullname"
                                          hint={t('user', 'profileFullNameHint')}
                                      >
                                          <FormControl>
                                              <Input
                                                  id="profile-fullname"
                                                  {...field}
                                                  placeholder={t('user', 'profileFullNamePlaceholder')}
                                                  className="h-9 text-[13px]"
                                              />
                                          </FormControl>
                                      </SettingsField>
                                      <FormMessage/>
                                  </FormItem>
                              )}
                          />

                          <div className="flex justify-end pt-4 border-t border-border/40">
                              <Button type="submit" disabled={saving}>
                                  {saving ? (
                                      <>
                                          <Loader2 className="mr-2 h-4 w-4 animate-spin" strokeWidth={1.5}/>
                                          {t('user', 'profileSaving')}
                                      </>
                                  ) : (
                                      <>
                                          <CheckCircle2 className="mr-2 h-4 w-4" strokeWidth={1.5}/>
                                          {t('user', 'profileSaveChanges')}
                                      </>
                                  )}
                              </Button>
                          </div>
                      </form>
          </Form>
              </div>
          </SettingsCard>
      </SettingsSection>
  );
}
