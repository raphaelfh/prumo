/**
 * Seção de Segurança
 * Alterar senha e outras configurações de segurança
 */

import {useState} from 'react';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Alert, AlertDescription} from '@/components/ui/alert';
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage,} from '@/components/ui/form';
import {Input} from '@/components/ui/input';
import {AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, Lock, Shield} from 'lucide-react';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';
import {cn} from '@/lib/utils';

const schema = z
    .object({
        newPassword: z
            .string()
            .min(8, 'A senha deve ter no mínimo 8 caracteres')
            .regex(/[A-Z]/, 'A senha deve conter pelo menos uma letra maiúscula')
            .regex(/[a-z]/, 'A senha deve conter pelo menos uma letra minúscula')
            .regex(/[0-9]/, 'A senha deve conter pelo menos um número'),
        confirmPassword: z.string().min(1, 'Confirme a nova senha'),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
        message: 'As senhas não coincidem',
        path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof schema>;

const getPasswordStrength = (password: string) => {
    if (!password) return {strength: 0, label: '', colorClass: '', textClass: ''};

    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;

    if (strength <= 2) return {strength, label: 'Fraca', colorClass: 'bg-destructive', textClass: 'text-destructive'};
    if (strength <= 4) return {strength, label: 'Média', colorClass: 'bg-warning', textClass: 'text-warning'};
    return {strength, label: 'Forte', colorClass: 'bg-success', textClass: 'text-success'};
};

export function SecuritySection() {
    const [loading, setLoading] = useState(false);
    const [showPasswords, setShowPasswords] = useState({new: false, confirm: false});

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

      toast.success('Senha alterada com sucesso!');
        form.reset();
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Erro ao alterar senha';
        console.error('Erro ao alterar senha:', err);
        toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Segurança
        </CardTitle>
        <CardDescription>
          Gerencie sua senha e configurações de segurança
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertDescription>
              Escolha uma senha forte com no mínimo 8 caracteres, incluindo letras maiúsculas,
            minúsculas e números.
          </AlertDescription>
        </Alert>

          <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  {/* Nova senha */}
                  <FormField
                      control={form.control}
                      name="newPassword"
                      render={({field}) => (
                          <FormItem>
                              <FormLabel>Nova Senha</FormLabel>
                              <FormControl>
                                  <div className="relative">
                                      <Input
                                          {...field}
                                          type={showPasswords.new ? 'text' : 'password'}
                                          placeholder="Digite sua nova senha"
                                      />
                                      <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="absolute right-1 top-1 h-7"
                                          aria-label={showPasswords.new ? 'Ocultar senha' : 'Mostrar senha'}
                                          onClick={() => setShowPasswords({...showPasswords, new: !showPasswords.new})}
                                      >
                                          {showPasswords.new ? <EyeOff className="h-4 w-4"/> :
                                              <Eye className="h-4 w-4"/>}
                                      </Button>
                                  </div>
                              </FormControl>

                              {/* Indicador de força */}
                              {newPassword && (
                                  <div className="space-y-1.5 pt-1">
                                      <div className="flex items-center justify-between text-xs">
                                          <span className="text-muted-foreground">Força da senha:</span>
                                          <span className={cn('font-medium', passwordStrength.textClass)}>
                          {passwordStrength.label}
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

                  {/* Confirmar senha */}
                  <FormField
                      control={form.control}
                      name="confirmPassword"
                      render={({field}) => (
                          <FormItem>
                              <FormLabel>Confirmar Nova Senha</FormLabel>
                              <FormControl>
                                  <div className="relative">
                                      <Input
                                          {...field}
                                          type={showPasswords.confirm ? 'text' : 'password'}
                                          placeholder="Confirme sua nova senha"
                                      />
                                      <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          className="absolute right-1 top-1 h-7"
                                          aria-label={showPasswords.confirm ? 'Ocultar confirmação' : 'Mostrar confirmação'}
                                          onClick={() => setShowPasswords({
                                              ...showPasswords,
                                              confirm: !showPasswords.confirm
                                          })}
                                      >
                                          {showPasswords.confirm ? <EyeOff className="h-4 w-4"/> :
                                              <Eye className="h-4 w-4"/>}
                                      </Button>
                                  </div>
                              </FormControl>

                              {/* Indicador de coincidência */}
                              {confirmPassword && (
                                  <div className="flex items-center gap-1.5 text-xs pt-0.5">
                                      {passwordsMatch ? (
                                          <>
                                              <CheckCircle2 className="h-3 w-3 text-success"/>
                                              <span className="text-success">As senhas coincidem</span>
                                          </>
                                      ) : (
                                          <>
                                              <AlertCircle className="h-3 w-3 text-destructive"/>
                                              <span className="text-destructive">As senhas não coincidem</span>
                                          </>
                                      )}
                                  </div>
                              )}

                              <FormMessage/>
                          </FormItem>
                      )}
                  />

                  <div className="flex justify-end pt-4 border-t">
                      <Button type="submit" disabled={loading}>
                          {loading ? (
                              <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
                                  Alterando...
                              </>
                          ) : (
                              <>
                                  <Lock className="mr-2 h-4 w-4"/>
                                  Alterar Senha
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
