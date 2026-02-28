/**
 * Diálogo para Criar Novo Projeto
 * 
 * Interface moderna para criação de projetos com validação
 * e feedback visual apropriado.
 */

import {useState} from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Textarea} from "@/components/ui/textarea";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {BookOpen, Info, Loader2} from "lucide-react";

interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProjectCreate: (data: { name: string; description?: string }) => Promise<void>;
  isCreating?: boolean;
}

export function AddProjectDialog({ 
  open, 
  onOpenChange, 
  onProjectCreate,
  isCreating = false 
}: AddProjectDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<{ name?: string }>({});

  const validateForm = () => {
    const newErrors: { name?: string } = {};
    
    if (!name.trim()) {
      newErrors.name = "Nome do projeto é obrigatório";
    } else if (name.trim().length < 3) {
      newErrors.name = "Nome deve ter pelo menos 3 caracteres";
    } else if (name.trim().length > 100) {
      newErrors.name = "Nome muito longo (máximo 100 caracteres)";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;

    await onProjectCreate({
      name: name.trim(),
      description: description.trim() || undefined
    });

    // Resetar form após criação bem-sucedida
    setName("");
    setDescription("");
    setErrors({});
  };

  const handleCancel = () => {
    setName("");
    setDescription("");
    setErrors({});
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <BookOpen className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle>Criar Novo Projeto</DialogTitle>
              <DialogDescription className="mt-1">
                Configure seu projeto de revisão sistemática
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {/* Campo Nome */}
            <div className="space-y-2">
              <Label htmlFor="project-name" className="text-sm font-medium">
                Nome do Projeto <span className="text-destructive">*</span>
              </Label>
              <Input
                id="project-name"
                placeholder="Ex: Revisão Sistemática sobre Diabetes Tipo 2"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (errors.name) setErrors({ ...errors, name: undefined });
                }}
                className={errors.name ? "border-destructive" : ""}
                disabled={isCreating}
                autoFocus
                maxLength={100}
              />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name}</p>
              )}
            </div>

            {/* Campo Descrição */}
            <div className="space-y-2">
              <Label htmlFor="project-description" className="text-sm font-medium">
                Descrição <span className="text-muted-foreground text-xs">(opcional)</span>
              </Label>
              <Textarea
                id="project-description"
                placeholder="Breve descrição sobre o objetivo desta revisão..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                disabled={isCreating}
                className="resize-none"
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground">
                {description.length}/500 caracteres
              </p>
            </div>

            {/* Dica informativa */}
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-sm">
                Você poderá adicionar mais detalhes (membros da equipe, critérios de elegibilidade, etc.) 
                nas configurações do projeto após a criação.
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isCreating}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isCreating || !name.trim()}>
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Criando...
                </>
              ) : (
                "Criar Projeto"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

