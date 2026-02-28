/**
 * Dialog para remover seção do template
 * 
 * Features:
 * - Validações de impacto (campos, dados existentes)
 * - Confirmação dupla com nome da seção
 * - Feedback visual detalhado do que será removido
 * - Operação CASCADE segura
 * - Logs detalhados para auditoria
 * - Estados de loading apropriados
 * 
 * @component
 */

import {useEffect, useState} from 'react';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {z} from 'zod';
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
import {Alert, AlertDescription} from '@/components/ui/alert';
import {Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,} from '@/components/ui/form';
import {AlertTriangle, Database, FileText, Info, Loader2, Trash2, Users} from 'lucide-react';
import {supabase} from '@/integrations/supabase/client';
import {toast} from 'sonner';

// =================== SCHEMAS ===================

const RemoveSectionSchema = z.object({
  confirmationName: z.string()
    .min(1, 'Digite o nome da seção para confirmar'),  
});

type RemoveSectionInput = z.infer<typeof RemoveSectionSchema>;

// =================== INTERFACES ===================

interface SectionImpact {
  fieldsCount: number;
  instancesCount: number;
  dataCount: number;
  canDelete: boolean;
  warnings: string[];
}

interface RemoveSectionDialogProps {
  projectId: string;
  templateId: string;
  sectionId: string | null;
  sectionName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSectionRemoved: () => void;
}

// =================== COMPONENT ===================

export function RemoveSectionDialog({
  projectId,
  templateId,
  sectionId,
  sectionName,
  open,
  onOpenChange,
  onSectionRemoved,
}: RemoveSectionDialogProps) {
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [impact, setImpact] = useState<SectionImpact | null>(null);

  const form = useForm<RemoveSectionInput>({
    resolver: zodResolver(RemoveSectionSchema.refine(
      (data) => data.confirmationName === sectionName,
      {
        message: `Digite exatamente "${sectionName}" para confirmar`,
        path: ['confirmationName']
      }
    )),
    defaultValues: {
      confirmationName: '',
    },
  });

  // Analisar impacto quando dialog abre
  useEffect(() => {
    if (open && sectionId) {
      analyzeImpact();
    } else {
      setImpact(null);
      form.reset();
    }
  }, [open, sectionId]);

  const analyzeImpact = async () => {
    if (!sectionId) return;
    
    setAnalyzing(true);
    
    try {
      console.log('🔍 Analisando impacto da remoção:', { sectionId, sectionName });

      // sectionId agora é entity_type_id diretamente
      const entityTypeId = sectionId;

      // 2. Contar campos da seção
      const { count: fieldsCount, error: fieldsError } = await supabase
        .from('extraction_fields')
        .select('id', { count: 'exact', head: true })
        .eq('entity_type_id', entityTypeId);

      if (fieldsError) {
        console.error('Erro ao contar campos:', fieldsError);
        throw fieldsError;
      }

      // 3. Contar instâncias da seção (templates + por artigo)
      const { count: instancesCount, error: instancesError } = await supabase
        .from('extraction_instances')
        .select('id', { count: 'exact', head: true })
        .eq('entity_type_id', entityTypeId);

      if (instancesError) {
        console.error('Erro ao contar instâncias:', instancesError);
        throw instancesError;
      }

      // 4. Contar dados extraídos (via extracted_values)
      const { count: dataCount, error: dataError } = await supabase
        .from('extracted_values')
        .select('id', { count: 'exact', head: true })
        .eq('instance_id', entityTypeId);

      if (dataError) {
        console.error('Erro ao contar dados:', dataError);
        // Não falhar por isso, apenas logar
        console.warn('Não foi possível contar dados extraídos');
      }

      // 5. Gerar warnings
      const warnings: string[] = [];
      
      if ((fieldsCount || 0) > 0) {
        warnings.push(`${fieldsCount} campos serão removidos permanentemente`);
      }
      
      if ((instancesCount || 0) > 1) {
        warnings.push(`${instancesCount} instâncias da seção serão removidas`);
      }
      
      if ((dataCount || 0) > 0) {
        warnings.push(`${dataCount} dados extraídos serão perdidos`);
      }

      if (warnings.length === 0) {
        warnings.push('Seção vazia - remoção segura');
      }

      const impactData: SectionImpact = {
        fieldsCount: fieldsCount || 0,
        instancesCount: instancesCount || 0,
        dataCount: dataCount || 0,
        canDelete: true, // Por enquanto sempre permitir
        warnings
      };

      console.log('📊 Impacto analisado:', impactData);
      setImpact(impactData);

    } catch (error: any) {
      console.error('Erro ao analisar impacto:', error);
      toast.error(`Erro ao analisar impacto: ${error.message}`);
      
      // Impacto padrão em caso de erro
      setImpact({
        fieldsCount: 0,
        instancesCount: 0,
        dataCount: 0,
        canDelete: false,
        warnings: ['Erro ao analisar impacto - operação não recomendada']
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSubmit = async (data: RemoveSectionInput) => {
    if (!sectionId || !impact) return;
    
    setLoading(true);
    
    try {
      console.log('🗑️ Iniciando remoção da seção:', { sectionId, sectionName });

      // sectionId agora é entity_type_id diretamente
      const entityTypeId = sectionId;

      console.log('🎯 Entity type a ser removido:', entityTypeId);

      // Deletar entity type (CASCADE automático deleta fields, instances e values)
      const { error: entityError } = await supabase
        .from('extraction_entity_types')
        .delete()
        .eq('id', entityTypeId);

      if (entityError) {
        console.error('Erro ao remover entity type:', entityError);
        throw entityError;
      }

      console.log('✅ Entity type e todas as dependências removidos via CASCADE');

      toast.success(`Seção "${sectionName}" removida com sucesso!`);
      
      // Fechar dialog e recarregar dados
      onOpenChange(false);
      onSectionRemoved();

    } catch (error: any) {
      console.error('Erro ao remover seção:', error);
      toast.error(`Erro ao remover seção: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading && !analyzing) {
      form.reset();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Remover Seção
          </DialogTitle>
          <DialogDescription>
            Esta ação não pode ser desfeita. Todos os dados relacionados serão perdidos permanentemente.
          </DialogDescription>
        </DialogHeader>

        {analyzing && (
          <div className="flex items-center justify-center p-6">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span>Analisando impacto...</span>
          </div>
        )}

        {impact && !analyzing && (
          <div className="space-y-4">
            {/* Informações da seção */}
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                <div className="font-medium mb-2">Seção a ser removida:</div>
                <div className="font-mono text-sm bg-muted px-2 py-1 rounded">
                  {sectionName}
                </div>
              </AlertDescription>
            </Alert>

            {/* Impacto visual */}
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 bg-muted rounded-lg">
                <FileText className="h-6 w-6 mx-auto mb-1 text-blue-500" />
                <div className="font-bold text-lg">{impact.fieldsCount}</div>
                <div className="text-xs text-muted-foreground">Campos</div>
              </div>
              <div className="text-center p-3 bg-muted rounded-lg">
                <Users className="h-6 w-6 mx-auto mb-1 text-green-500" />
                <div className="font-bold text-lg">{impact.instancesCount}</div>
                <div className="text-xs text-muted-foreground">Instâncias</div>
              </div>
              <div className="text-center p-3 bg-muted rounded-lg">
                <Database className="h-6 w-6 mx-auto mb-1 text-purple-500" />
                <div className="font-bold text-lg">{impact.dataCount}</div>
                <div className="text-xs text-muted-foreground">Dados</div>
              </div>
            </div>

            {/* Warnings */}
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="font-medium mb-2">Impacto da remoção:</div>
                <ul className="list-disc list-inside space-y-1">
                  {impact.warnings.map((warning, index) => (
                    <li key={index} className="text-sm">{warning}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>

            {/* Formulário de confirmação */}
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="confirmationName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirmação *</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder={`Digite "${sectionName}" para confirmar`}
                          {...field}
                          disabled={loading}
                        />
                      </FormControl>
                      <FormDescription>
                        Para confirmar a remoção, digite exatamente o nome da seção acima.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleClose}
                    disabled={loading}
                  >
                    Cancelar
                  </Button>
                  <Button 
                    type="submit" 
                    variant="destructive"
                    disabled={loading || !impact.canDelete}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Removendo...
                      </>
                    ) : (
                      <>
                        <Trash2 className="h-4 w-4 mr-2" />
                        Remover Seção
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}