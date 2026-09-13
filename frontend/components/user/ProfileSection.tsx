/**
 * User profile section: view and edit profile information.
 */

import {useEffect, useState} from 'react';
import {useForm, useWatch} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {Button} from '@/components/ui/button';
import {Form, FormControl, FormField, FormItem, FormMessage} from '@/components/ui/form';
import {Input} from '@/components/ui/input';
import {Skeleton} from '@/components/ui/skeleton';
import {Avatar, AvatarFallback, AvatarImage} from '@/components/ui/avatar';
import {SettingsActions, SettingsGroup, SettingsPage, SettingsRow} from '@/components/settings';
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

    const schema = z.object({
        full_name: z
            .string()
            .min(1, t('user', 'profileNameRequired'))
            .max(100, t('user', 'profileNameMaxLength')),
    });

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
      <SettingsPage>
        <SettingsGroup>
          <SettingsRow label={t('user', 'profilePicture')}>
            <Skeleton className="h-8 w-8 rounded-full"/>
          </SettingsRow>
          <SettingsRow label={t('user', 'profileEmailLabel')}>
            <Skeleton className="h-8 w-full"/>
          </SettingsRow>
          <SettingsRow label={t('user', 'profileFullNameLabel')}>
            <Skeleton className="h-8 w-full"/>
          </SettingsRow>
        </SettingsGroup>
      </SettingsPage>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <SettingsPage>
          <SettingsGroup>
            <SettingsRow label={t('user', 'profilePicture')}>
              <div className="flex items-center gap-2 px-2">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={avatarUrl} alt={fullName}/>
                  <AvatarFallback className="bg-primary/10 text-[13px] text-primary">
                    {fullName ? getInitials(fullName) : <User className="h-4 w-4"/>}
                  </AvatarFallback>
                </Avatar>
                <span className="text-[13px] text-muted-foreground">{t('user', 'profileUploadComingSoon')}</span>
              </div>
            </SettingsRow>

            {/* No control: the address is managed by auth, so it is text, not a disabled input. */}
            <SettingsRow label={t('user', 'profileEmailLabel')} hint={t('user', 'profileEmailHint')}>
              <p className="px-2 text-[13px]">{email}</p>
            </SettingsRow>

            <FormField
              control={form.control}
              name="full_name"
              render={({field}) => (
                <FormItem className="space-y-0">
                  <SettingsRow
                    label={t('user', 'profileFullNameLabel')}
                    htmlFor="profile-fullname"
                    hint={t('user', 'profileFullNameHint')}
                  >
                    {({describedBy}) => (
                      <>
                        <FormControl aria-describedby={describedBy}>
                          <Input
                            id="profile-fullname"
                            variant="quiet"
                            {...field}
                            placeholder={t('user', 'profileFullNamePlaceholder')}
                          />
                        </FormControl>
                        <FormMessage/>
                      </>
                    )}
                  </SettingsRow>
                </FormItem>
              )}
            />

            <SettingsActions>
              <Button type="submit" size="sm" disabled={saving}>
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
            </SettingsActions>
          </SettingsGroup>
        </SettingsPage>
      </form>
    </Form>
  );
}
