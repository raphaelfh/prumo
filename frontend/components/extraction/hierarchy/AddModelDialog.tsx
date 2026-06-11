/**
 * Add Model Dialog
 *
 * Dialog to add a new prediction model.
 * Lets the user name the model and optionally specify the modelling method.
 *
 * Features:
 * - Name validation (non-empty, no duplicates)
 * - Optional field for modelling method
 * - Loading state during creation
 * - Clear error messages
 *
 * @component
 */

import {useState} from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {t} from '@/lib/copy';
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

    // Reset on close — adjusted during render instead of via effect.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      setModelName('');
      setModellingMethod('');
      setError(null);
      setLoading(false);
    }
  }

    // Validation
  const validate = (): boolean => {
    // Nome vazio
    if (!modelName.trim()) {
        setError(t('extraction', 'modelNameEmpty'));
      return false;
    }

      // Name too short
    if (modelName.trim().length < 3) {
        setError(t('extraction', 'modelNameMinLength'));
      return false;
    }

    // Nome duplicado (case-insensitive)
    const isDuplicate = existingModels.some(
      existing => existing.toLowerCase() === modelName.trim().toLowerCase()
    );

    if (isDuplicate) {
        setError(t('extraction', 'modelNameDuplicate'));
      return false;
    }

    setError(null);
    return true;
  };

    // Submit handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) return;

    setLoading(true);
    setError(null);

    try {
      await onConfirm(modelName.trim(), modellingMethod.trim());
        // Dialog will be closed by parent component
    } catch (err: any) {
        console.error('Error creating model:', err);
        setError(err.message || t('extraction', 'modelCreateError'));
      setLoading(false);
    }
  };

    // Enter key handler
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
                {t('extraction', 'addNewModel')}
            </DialogTitle>
            <DialogDescription>
                {t('extraction', 'addNewModelDesc')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Campo: Model Name */}
            <div className="space-y-2">
              <Label htmlFor="model-name" className="flex items-center gap-1">
                  {t('extraction', 'modelNameLabel')}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                id="model-name"
                placeholder={t('extraction', 'modelNamePlaceholder')}
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
                autoFocus
                className={error ? 'border-destructive' : ''}
              />
              <p className="text-xs text-muted-foreground">
                  {t('extraction', 'modelNameHint')}
              </p>
            </div>

            {/* Campo: Modelling Method (Opcional) */}
            <div className="space-y-2">
              <Label htmlFor="modelling-method">
                  {t('extraction', 'modellingMethodLabel')}
                  <span
                      className="text-xs text-muted-foreground ml-1">{t('extraction', 'modellingMethodOptional')}</span>
              </Label>
              <Input
                id="modelling-method"
                placeholder={t('extraction', 'modelDescriptionPlaceholder')}
                value={modellingMethod}
                onChange={(e) => setModellingMethod(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                  {t('extraction', 'modellingMethodHint')}
              </p>
            </div>

            {/* Erro */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

              {/* Info about existing models */}
            {existingModels.length > 0 && (
              <div className="bg-muted/40 rounded-lg p-3 border border-border/40">
                <p className="text-xs text-muted-foreground font-medium mb-2">
                    {t('extraction', 'modelsAlreadyAdded')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {existingModels.map((name, index) => (
                    <span
                      key={index}
                      className="text-xs bg-card px-2 py-1 rounded border border-border/60 text-foreground"
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
                {t('common', 'cancel')}
            </Button>
            <Button type="submit" disabled={loading || !modelName.trim()}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('extraction', 'creating')}
                </>
              ) : (
                  t('extraction', 'createModel')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

