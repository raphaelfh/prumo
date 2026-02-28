/**
 * Seção de Segurança
 * Alterar senha e outras configurações de segurança
 */

import {useState} from 'react';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Alert, AlertDescription} from '@/components/ui/alert';
import {AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, Lock, Shield} from 'lucide-react';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';

export function SecuritySection() {
  const [loading, setLoading] = useState(false);
  const [showPasswords, setShowPasswords] = useState({
    new: false,
    confirm: false,
  });
  const [passwords, setPasswords] = useState({
    newPassword: '',
    confirmPassword: '',
  });

  const validatePassword = (password: string) => {
    if (password.length < 8) {
      return 'A senha deve ter no mínimo 8 caracteres';
    }
    if (!/[A-Z]/.test(password)) {
      return 'A senha deve conter pelo menos uma letra maiúscula';
    }
    if (!/[a-z]/.test(password)) {
      return 'A senha deve conter pelo menos uma letra minúscula';
    }
    if (!/[0-9]/.test(password)) {
      return 'A senha deve conter pelo menos um número';
    }
    return null;
  };

  const getPasswordStrength = (password: string) => {
    if (!password) return { strength: 0, label: '', color: '' };
    
    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;

    if (strength <= 2) return { strength, label: 'Fraca', color: 'bg-red-500' };
    if (strength <= 4) return { strength, label: 'Média', color: 'bg-yellow-500' };
    return { strength, label: 'Forte', color: 'bg-green-500' };
  };

  const handleChangePassword = async () => {
    // Validações
    if (!passwords.newPassword) {
      toast.error('Digite a nova senha');
      return;
    }

    const validationError = validatePassword(passwords.newPassword);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    if (passwords.newPassword !== passwords.confirmPassword) {
      toast.error('As senhas não coincidem');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: passwords.newPassword,
      });

      if (error) throw error;

      toast.success('Senha alterada com sucesso!');
      
      // Limpar campos
      setPasswords({
        newPassword: '',
        confirmPassword: '',
      });
    } catch (error: any) {
      console.error('Erro ao alterar senha:', error);
      toast.error(error.message || 'Erro ao alterar senha');
    } finally {
      setLoading(false);
    }
  };

  const passwordStrength = getPasswordStrength(passwords.newPassword);
  const passwordsMatch = passwords.newPassword === passwords.confirmPassword && passwords.confirmPassword !== '';

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

        {/* Nova senha */}
        <div className="space-y-2">
          <Label htmlFor="new-password">Nova Senha</Label>
          <div className="relative">
            <Input
              id="new-password"
              type={showPasswords.new ? 'text' : 'password'}
              value={passwords.newPassword}
              onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
              placeholder="Digite sua nova senha"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1 h-7"
              onClick={() => setShowPasswords({ ...showPasswords, new: !showPasswords.new })}
            >
              {showPasswords.new ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* Indicador de força da senha */}
          {passwords.newPassword && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Força da senha:</span>
                <span className={`font-medium ${
                  passwordStrength.label === 'Fraca' ? 'text-red-500' :
                  passwordStrength.label === 'Média' ? 'text-yellow-500' :
                  'text-green-500'
                }`}>
                  {passwordStrength.label}
                </span>
              </div>
              <div className="flex gap-1">
                {[...Array(6)].map((_, i) => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full ${
                      i < passwordStrength.strength ? passwordStrength.color : 'bg-muted'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Confirmar senha */}
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirmar Nova Senha</Label>
          <div className="relative">
            <Input
              id="confirm-password"
              type={showPasswords.confirm ? 'text' : 'password'}
              value={passwords.confirmPassword}
              onChange={(e) => setPasswords({ ...passwords, confirmPassword: e.target.value })}
              placeholder="Confirme sua nova senha"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1 h-7"
              onClick={() => setShowPasswords({ ...showPasswords, confirm: !showPasswords.confirm })}
            >
              {showPasswords.confirm ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* Indicador de senhas coincidindo */}
          {passwords.confirmPassword && (
            <div className="flex items-center gap-2 text-xs">
              {passwordsMatch ? (
                <>
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                  <span className="text-green-500">As senhas coincidem</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-3 w-3 text-red-500" />
                  <span className="text-red-500">As senhas não coincidem</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Botão alterar senha */}
        <div className="flex justify-end pt-4 border-t">
          <Button 
            onClick={handleChangePassword} 
            disabled={loading || !passwords.newPassword || !passwordsMatch}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Alterando...
              </>
            ) : (
              <>
                <Lock className="mr-2 h-4 w-4" />
                Alterar Senha
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

