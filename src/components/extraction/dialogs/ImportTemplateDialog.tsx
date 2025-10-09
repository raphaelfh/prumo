/**
 * Dialog para importar template global para o projeto
 * 
 * Features:
 * - Lista templates globais disponíveis
 * - Preview de seções e campos do template
 * - Importação com feedback visual
 * - Validação antes de importar
 * - Loading states apropriados
 * 
 * @component
 */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Download, 
  Loader2, 
  CheckCircle2,
  FileText,
  Layers,
  AlertTriangle
} from 'lucide-react';
import { useGlobalTemplates, GlobalTemplate } from '@/hooks/extraction/useGlobalTemplates';
import { 
  importTemplateWithConflictDetection,
  mergeTemplates,
  replaceTemplate,
  cloneTemplateToProject
} from '@/services/templateImportService';
import { toast } from 'sonner';
import { TemplateConflictDialog } from './TemplateConflictDialog';

// =================== INTERFACES ===================

interface ImportTemplateDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTemplateImported: () => void;
}

// =================== COMPONENT ===================

export function ImportTemplateDialog({
  projectId,
  open,
  onOpenChange,
  onTemplateImported,
}: ImportTemplateDialogProps) {
  const { templates, loading: loadingTemplates } = useGlobalTemplates();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  
  // Estados para conflito
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [conflictInfo, setConflictInfo] = useState<any>(null);

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);

  const handleImport = async () => {
    if (!selectedTemplate) {
      toast.error('Selecione um template para importar');
      return;
    }

    setImporting(true);

    try {
      console.log('📥 Importando template:', selectedTemplate.name);

      // Usar nova lógica com detecção de conflito
      const importResult = await importTemplateWithConflictDetection(
        projectId,
        selectedTemplate.id
      );

      if (importResult.needsUserDecision) {
        // Tem conflito, mostrar dialog para usuário decidir
        setConflictInfo({
          ...importResult.conflictInfo,
          newTemplate: {
            name: selectedTemplate.name,
            framework: selectedTemplate.framework,
            description: selectedTemplate.description
          }
        });
        setShowConflictDialog(true);
        setImporting(false);
        return;
      }

      // Sem conflito, processar resultado
      if (importResult.result?.success) {
        toast.success(
          `Template "${selectedTemplate.name}" importado com sucesso!`
        );
        onOpenChange(false);
        onTemplateImported();
      } else {
        throw new Error(importResult.result?.error || 'Erro desconhecido');
      }

    } catch (error: any) {
      console.error('Erro ao importar template:', error);
      toast.error(`Erro ao importar template: ${error.message}`);
    } finally {
      setImporting(false);
    }
  };

  const handleConflictAction = async (action: 'merge' | 'replace' | 'cancel') => {
    if (action === 'cancel') {
      setShowConflictDialog(false);
      setConflictInfo(null);
      return;
    }

    if (!selectedTemplate || !conflictInfo?.existingTemplate) return;

    setImporting(true);

    try {
      if (action === 'merge') {
        console.log('🔀 Mesclando templates...');
        const result = await mergeTemplates(
          projectId,
          conflictInfo.existingTemplate.id,
          selectedTemplate.id
        );

        if (result.success) {
          toast.success(
            `Template mesclado! +${result.sectionsAdded} seções, +${result.fieldsAdded} campos`
          );
          setShowConflictDialog(false);
          onOpenChange(false);
          onTemplateImported();
        } else {
          throw new Error(result.error || 'Erro ao mesclar');
        }
      } else if (action === 'replace') {
        console.log('🔄 Substituindo template...');
        const result = await replaceTemplate(
          projectId,
          conflictInfo.existingTemplate.id,
          selectedTemplate.id
        );

        if (result.success) {
          toast.success('Template substituído com sucesso!');
          setShowConflictDialog(false);
          onOpenChange(false);
          onTemplateImported();
        } else {
          throw new Error(result.error || 'Erro ao substituir');
        }
      }
    } catch (error: any) {
      console.error('Erro na ação de conflito:', error);
      toast.error(`Erro: ${error.message}`);
    } finally {
      setImporting(false);
      setConflictInfo(null);
    }
  };

  const handleClose = () => {
    if (!importing) {
      setSelectedTemplateId(null);
      setShowConflictDialog(false);
      setConflictInfo(null);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Importar Template Global
          </DialogTitle>
          <DialogDescription>
            Selecione um template padronizado para usar no seu projeto.
          </DialogDescription>
        </DialogHeader>

        {loadingTemplates ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span>Carregando templates...</span>
          </div>
        ) : templates.length === 0 ? (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Nenhum template global disponível no momento.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            {/* Lista de templates */}
            <RadioGroup value={selectedTemplateId || ''} onValueChange={setSelectedTemplateId}>
              <div className="space-y-3">
                {templates.map((template) => (
                  <Card 
                    key={template.id}
                    className={`cursor-pointer transition-all ${
                      selectedTemplateId === template.id 
                        ? 'ring-2 ring-primary' 
                        : 'hover:bg-accent'
                    }`}
                    onClick={() => setSelectedTemplateId(template.id)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <RadioGroupItem value={template.id} id={template.id} />
                          <div>
                            <CardTitle className="text-base">
                              <Label htmlFor={template.id} className="cursor-pointer">
                                {template.name}
                              </Label>
                            </CardTitle>
                            <CardDescription className="text-xs mt-1">
                              {template.description}
                            </CardDescription>
                          </div>
                        </div>
                        <Badge variant="outline" className="ml-2">
                          {template.framework}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Layers className="h-4 w-4" />
                          <span>{template.entityTypesCount} seções</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <FileText className="h-4 w-4" />
                          <span>v{template.version}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </RadioGroup>

            {/* Preview do template selecionado */}
            {selectedTemplate && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  <div className="font-medium mb-1">Template selecionado:</div>
                  <div className="text-sm">
                    <strong>{selectedTemplate.name}</strong> com {selectedTemplate.entityTypesCount} seções pré-configuradas.
                    Todas as seções e campos serão importados para o seu projeto.
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={importing}
          >
            Cancelar
          </Button>
          <Button 
            onClick={handleImport}
            disabled={!selectedTemplateId || importing || loadingTemplates}
          >
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Importando...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Importar Template
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Dialog de Conflito de Template */}
      {conflictInfo && (
        <TemplateConflictDialog
          open={showConflictDialog}
          onClose={() => {
            setShowConflictDialog(false);
            setConflictInfo(null);
          }}
          existingTemplate={conflictInfo.existingTemplate}
          newTemplate={conflictInfo.newTemplate}
          onAction={handleConflictAction}
          loading={importing}
        />
      )}
    </Dialog>
  );
}
