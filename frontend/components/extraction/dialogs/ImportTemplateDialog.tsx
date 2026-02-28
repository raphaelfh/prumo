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

import {useState} from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {RadioGroup, RadioGroupItem} from '@/components/ui/radio-group';
import {Label} from '@/components/ui/label';
import {Alert, AlertDescription} from '@/components/ui/alert';
import {AlertTriangle, CheckCircle2, Download, FileText, Layers, Loader2} from 'lucide-react';
import {useGlobalTemplates} from '@/hooks/extraction/useGlobalTemplates';
import {importGlobalTemplate} from '@/services/templateImportService';
import {toast} from 'sonner';

// =================== INTERFACES ===================

interface ImportTemplateDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTemplateImported: (templateId?: string) => void;
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

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);

  const handleImport = async () => {
    if (!selectedTemplate) {
      toast.error('Selecione um template para importar');
      return;
    }

    setImporting(true);

    try {
      console.log('📥 Importando template:', selectedTemplate.name);

      const result = await importGlobalTemplate(projectId, selectedTemplate.id);

      if (result.success) {
        toast.success(
          `Template "${selectedTemplate.name}" importado com sucesso! ${result.details?.entityTypesAdded} seções, ${result.details?.fieldsAdded} campos.`
        );
        onOpenChange(false);
        onTemplateImported(result.templateId);
      } else {
        throw new Error(result.error || 'Erro desconhecido');
      }

    } catch (error: any) {
      console.error('Erro ao importar template:', error);
      toast.error(`Erro ao importar template: ${error.message}`);
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    if (!importing) {
      setSelectedTemplateId(null);
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
                    className={`group cursor-pointer transition-all ${
                      selectedTemplateId === template.id 
                        ? 'ring-2 ring-primary' 
                        : 'hover:bg-primary'
                    }`}
                    onClick={() => setSelectedTemplateId(template.id)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <RadioGroupItem value={template.id} id={template.id} className="group-hover:text-white group-hover:border-white" />
                          <div>
                            <CardTitle className="text-base group-hover:text-white">
                              <Label htmlFor={template.id} className="cursor-pointer group-hover:text-white">
                                {template.name}
                              </Label>
                            </CardTitle>
                            <CardDescription className="text-xs mt-1 group-hover:text-white">
                              {template.description}
                            </CardDescription>
                          </div>
                        </div>
                        <Badge variant="outline" className="ml-2 group-hover:text-white group-hover:border-white">
                          {template.framework}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex items-center gap-4 text-sm text-muted-foreground group-hover:text-white">
                        <div className="flex items-center gap-1">
                          <Layers className="h-4 w-4 group-hover:text-white" />
                          <span>{template.entityTypesCount} seções</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <FileText className="h-4 w-4 group-hover:text-white" />
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
    </Dialog>
  );
}
