/**
 * Add Model Dialog
 * 
 * Dialog para adicionar um novo modelo de predição.
 * Permite ao usuário nomear o modelo e opcionalmente especificar o método de modelagem.
 * 
 * Features:
 * - Validação de nome (não vazio, não duplicado)
 * - Campo opcional para modelling method
 * - Loading state durante criação
 * - Mensagens de erro claras
 * 
 * @component
 */

import {useEffect, useState} from 'react';
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
import {Alert, AlertDescription} from '@/components/ui/alert';
import {AlertCircle, Loader2, Sparkles} from 'lucide-react';

// =================== INTERFACES ===================

interface AddModelDialogProps {
  open: boolean;
  onConfirm: (modelName: string, modellingMethod: string) => Promise<void>;
  onCancel: () => void;
  existingModels: string[];
}

// =================== COMPONENT ===================

export function AddModelDialog({
  open,
  onConfirm,
  onCancel,
  existingModels
}: AddModelDialogProps) {
  const [modelName, setModelName] = useState('');
  const [modellingMethod, setModellingMethod] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Reset ao abrir/fechar
  useEffect(() => {
    if (!open) {
      setModelName('');
      setModellingMethod('');
      setError(null);
      setLoading(false);
    }
  }, [open]);

  // Validação
  const validate = (): boolean => {
    // Nome vazio
    if (!modelName.trim()) {
      setError('O nome do modelo não pode estar vazio');
      return false;
    }

    // Nome muito curto
    if (modelName.trim().length < 3) {
      setError('O nome do modelo deve ter pelo menos 3 caracteres');
      return false;
    }

    // Nome duplicado (case-insensitive)
    const isDuplicate = existingModels.some(
      existing => existing.toLowerCase() === modelName.trim().toLowerCase()
    );

    if (isDuplicate) {
      setError('Já existe um modelo com este nome');
      return false;
    }

    setError(null);
    return true;
  };

  // Handler de submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) return;

    setLoading(true);
    setError(null);

    try {
      await onConfirm(modelName.trim(), modellingMethod.trim());
      // Dialog será fechado pelo parent component
    } catch (err: any) {
      console.error('Erro ao criar modelo:', err);
      setError(err.message || 'Erro ao criar modelo');
      setLoading(false);
    }
  };

  // Handler de tecla Enter
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && !loading && onCancel()}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Adicionar Novo Modelo
            </DialogTitle>
            <DialogDescription>
              Crie um novo modelo de predição para extrair seus dados.
              Você poderá adicionar quantos modelos quiser.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Campo: Model Name */}
            <div className="space-y-2">
              <Label htmlFor="model-name" className="flex items-center gap-1">
                Nome do Modelo
                <span className="text-destructive">*</span>
              </Label>
              <Input
                id="model-name"
                placeholder="Ex: Logistic Regression, Random Forest, XGBoost..."
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
                autoFocus
                className={error ? 'border-destructive' : ''}
              />
              <p className="text-xs text-muted-foreground">
                Escolha um nome descritivo para identificar este modelo
              </p>
            </div>

            {/* Campo: Modelling Method (Opcional) */}
            <div className="space-y-2">
              <Label htmlFor="modelling-method">
                Método de Modelagem
                <span className="text-xs text-muted-foreground ml-1">(opcional)</span>
              </Label>
              <Input
                id="modelling-method"
                placeholder="Ex: Supervised learning, Neural network..."
                value={modellingMethod}
                onChange={(e) => setModellingMethod(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Você pode preencher este campo depois na extração
              </p>
            </div>

            {/* Erro */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Info sobre modelos existentes */}
            {existingModels.length > 0 && (
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                <p className="text-xs text-slate-600 font-medium mb-2">
                  Modelos já adicionados:
                </p>
                <div className="flex flex-wrap gap-2">
                  {existingModels.map((name, index) => (
                    <span
                      key={index}
                      className="text-xs bg-white px-2 py-1 rounded border border-slate-200"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={loading || !modelName.trim()}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Criando...
                </>
              ) : (
                'Criar Modelo'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

