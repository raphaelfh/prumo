/**
 * Seção de Perfil do Usuário
 * Exibir e editar informações do perfil
 */

import {useEffect, useState} from 'react';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage,} from '@/components/ui/form';
import {Input} from '@/components/ui/input';
import {Avatar, AvatarFallback, AvatarImage} from '@/components/ui/avatar';
import {CheckCircle2, Loader2, Mail, User} from 'lucide-react';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';

const schema = z.object({
    full_name: z
        .string()
        .min(1, 'Nome é obrigatório')
        .max(100, 'Nome muito longo (máximo 100 caracteres)'),
});

type FormValues = z.infer<typeof schema>;

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

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {full_name: ''},
  });

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    setLoading(true);
    try {
        const {data: {user}} = await supabase.auth.getUser();

      if (!user) {
        toast.error('Usuário não autenticado');
        return;
      }

        const {data: profileData, error} = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

        if (error) console.error('Erro ao carregar perfil:', error);

        setEmail(user.email ?? '');
        setAvatarUrl(profileData?.avatar_url ?? '');
        form.reset({full_name: profileData?.full_name ?? ''});
    } catch (err) {
        console.error('Erro ao carregar perfil:', err);
      toast.error('Erro ao carregar perfil');
    } finally {
      setLoading(false);
    }
  };

    const onSubmit = async (values: FormValues) => {
    setSaving(true);
    try {
        const {data: {user}} = await supabase.auth.getUser();

        if (!user) throw new Error('Usuário não autenticado');

        const {error} = await supabase
        .from('profiles')
            .update({full_name: values.full_name, avatar_url: avatarUrl})
        .eq('id', user.id);

      if (error) throw error;

      toast.success('Perfil atualizado com sucesso!');
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Erro ao salvar perfil';
        console.error('Erro ao salvar perfil:', err);
        toast.error(message);
    } finally {
      setSaving(false);
    }
  };

    const fullName = form.watch('full_name') ?? '';

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          Perfil
        </CardTitle>
          <CardDescription>Gerencie suas informações pessoais</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Avatar */}
        <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
                <AvatarImage src={avatarUrl} alt={fullName}/>
                <AvatarFallback className="text-base bg-primary/10 text-primary">
                    {fullName ? getInitials(fullName) : <User className="h-6 w-6"/>}
            </AvatarFallback>
          </Avatar>
            <div>
            <p className="text-sm font-medium">Foto de perfil</p>
                <p className="text-sm text-muted-foreground">Upload em breve disponível</p>
          </div>
        </div>

          <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  {/* Email (read-only) */}
                  <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-sm font-medium">
                          <Mail className="h-4 w-4 text-muted-foreground"/>
                          Email
                      </div>
                      <Input
                          type="email"
                          value={email}
                          disabled
                          className="bg-muted text-muted-foreground"
                          aria-label="Email (somente leitura)"
                      />
                      <p className="text-xs text-muted-foreground">
                          Gerenciado pelo sistema de autenticação — não pode ser alterado.
                      </p>
                  </div>

                  {/* Nome completo */}
                  <FormField
                      control={form.control}
                      name="full_name"
                      render={({field}) => (
                          <FormItem>
                              <FormLabel>Nome Completo</FormLabel>
                              <FormControl>
                                  <Input {...field} placeholder="Seu nome completo"/>
                              </FormControl>
                              <FormMessage/>
                          </FormItem>
                      )}
                  />

                  <div className="flex justify-end pt-4 border-t">
                      <Button type="submit" disabled={saving}>
                          {saving ? (
                              <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
                                  Salvando...
                              </>
                          ) : (
                              <>
                                  <CheckCircle2 className="mr-2 h-4 w-4"/>
                                  Salvar Alterações
                              </>
                          )}
                      </Button>
                  </div>
              </form>
          </Form>
      </CardContent>
    </Card>
  );
}
