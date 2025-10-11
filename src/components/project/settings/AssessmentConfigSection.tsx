/**
 * Seção de Configuração de Assessment em Project Settings
 * 
 * Permite configurar:
 * - Instrumento de assessment (PROBAST, ROB2, etc.)
 * - Escopo: Por Artigo ou Por Instância de Extraction
 * - Entity Type (se escopo = instância)
 * 
 * Inclui validações para evitar mudanças com assessments existentes.
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useProjectAssessmentConfig } from '@/hooks/assessment/useProjectAssessmentConfig';
import { useAssessmentInstruments } from '@/hooks/assessment/useAssessmentInstruments';
import { ExtractionEntityType } from '@/types/extraction';
import { AssessmentScope } from '@/types/assessment-config';

interface AssessmentConfigSectionProps {
  projectId: string;
}

export function AssessmentConfigSection({ projectId }: AssessmentConfigSectionProps) {
  const { config, loading, error, validateScopeChange, updateConfig, refresh } = 
    useProjectAssessmentConfig(projectId);
  const { instruments } = useAssessmentInstruments();
  
  const [entityTypesWithMany, setEntityTypesWithMany] = useState<ExtractionEntityType[]>([]);
  const [selectedInstrumentId, setSelectedInstrumentId] = useState<string>('');
  const [selectedScope, setSelectedScope] = useState<AssessmentScope>('article');
  const [selectedEntityTypeId, setSelectedEntityTypeId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Carregar entity types com cardinality='many' do template ativo
  useEffect(() => {
    loadEntityTypes();
  }, [projectId]);

  // Sincronizar estado local com config carregada
  useEffect(() => {
    if (config) {
      setSelectedScope(config.scope);
      setSelectedEntityTypeId(config.entityTypeId || '');
    }
  }, [config]);

  const loadEntityTypes = async () => {
    try {
      // Buscar template ativo do projeto
      const { data: templates, error: templatesError } = await supabase
        .from('project_extraction_templates')
        .select('id')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .limit(1)
        .single();

      if (templatesError || !templates) return;

      // Buscar entity types com cardinality='many'
      const { data: entityTypes, error: etError } = await supabase
        .from('extraction_entity_types')
        .select('*')
        .eq('project_template_id', templates.id)
        .eq('cardinality', 'many')
        .order('sort_order');

      if (etError) throw etError;

      setEntityTypesWithMany((entityTypes as ExtractionEntityType[]) || []);
    } catch (err: any) {
      console.error('Error loading entity types:', err);
    }
  };

  const handleSaveConfig = async () => {
    try {
      setSaving(true);

      // Validar mudança de scope
      const validation = await validateScopeChange(selectedScope);
      if (!validation.canChangeScope) {
        toast.error(validation.reason);
        return;
      }

      // Atualizar configuração
      await updateConfig(
        selectedScope,
        selectedScope === 'extraction_instance' ? selectedEntityTypeId : null
      );

      // Atualizar instrumento se selecionado
      if (selectedInstrumentId) {
        const { error: instrumentError } = await supabase
          .from('projects')
          .update({ risk_of_bias_instrument_id: selectedInstrumentId })
          .eq('id', projectId);

        if (instrumentError) throw instrumentError;
      }

      toast.success('Configuração de assessment atualizada com sucesso');
      refresh();
    } catch (err: any) {
      console.error('Error saving assessment config:', err);
      toast.error(`Erro ao salvar: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">
            Carregando configuração...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuração de Assessment</CardTitle>
        <CardDescription>
          Configure como os assessments de qualidade serão realizados neste projeto
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        
        {/* Seletor de Instrumento */}
        <div className="space-y-2">
          <Label>Instrumento de Avaliação</Label>
          <Select value={selectedInstrumentId} onValueChange={setSelectedInstrumentId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione um instrumento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Nenhum</SelectItem>
              {instruments.map(instrument => (
                <SelectItem key={instrument.id} value={instrument.id}>
                  {instrument.name} ({instrument.tool_type})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Escolha o instrumento de avaliação de qualidade (ex: PROBAST, ROB2)
          </p>
        </div>

        {/* Seletor de Escopo */}
        <div className="space-y-3">
          <Label>Escopo do Assessment</Label>
          <RadioGroup value={selectedScope} onValueChange={(value) => setSelectedScope(value as AssessmentScope)}>
            
            {/* Opção: Por Artigo */}
            <div className="flex items-start space-x-3 space-y-0 rounded-md border p-4">
              <RadioGroupItem value="article" id="scope-article" />
              <div className="flex-1">
                <Label htmlFor="scope-article" className="cursor-pointer font-medium">
                  Por Artigo Completo (padrão)
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Um assessment para cada artigo do projeto. Mais simples e rápido.
                </p>
              </div>
            </div>

            {/* Opção: Por Instância */}
            <div className="flex items-start space-x-3 space-y-0 rounded-md border p-4">
              <RadioGroupItem value="extraction_instance" id="scope-instance" />
              <div className="flex-1">
                <Label htmlFor="scope-instance" className="cursor-pointer font-medium">
                  Por Modelo Extraído
                </Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Um assessment para cada modelo dentro de cada artigo. Use quando artigos têm 
                  múltiplos modelos que precisam ser avaliados separadamente.
                </p>
                <Alert className="mt-3 bg-blue-50 border-blue-200">
                  <AlertCircle className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-xs text-blue-900">
                    Exemplo: Um artigo com 3 modelos = 3 assessments PROBAST por revisor
                  </AlertDescription>
                </Alert>
              </div>
            </div>
          </RadioGroup>
        </div>

        {/* Seletor de Entity Type (se scope = extraction_instance) */}
        {selectedScope === 'extraction_instance' && (
          <div className="space-y-2">
            <Label>Seção para Assessment</Label>
            <Select value={selectedEntityTypeId} onValueChange={setSelectedEntityTypeId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a seção" />
              </SelectTrigger>
              <SelectContent>
                {entityTypesWithMany.length === 0 ? (
                  <SelectItem value="" disabled>
                    Nenhuma seção com múltiplas instâncias encontrada
                  </SelectItem>
                ) : (
                  entityTypesWithMany.map(et => (
                    <SelectItem key={et.id} value={et.id}>
                      {et.label} (múltipla)
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Escolha a seção do template de extraction que aceita múltiplas instâncias
            </p>
          </div>
        )}

        {/* Alerta de validação */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Status atual */}
        {config && (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-sm text-green-900">
              Configuração atual: <strong>
                {config.scope === 'article' ? 'Por Artigo' : `Por ${config.entityType?.label || 'Instância'}`}
              </strong>
            </AlertDescription>
          </Alert>
        )}

        {/* Botão salvar */}
        <div className="flex justify-end">
          <Button onClick={handleSaveConfig} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar Configuração'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}


