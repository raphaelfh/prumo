/**
 * Componente para gerenciar sugestões de IA
 * 
 * Exibe sugestões geradas pela IA para valores de extração
 * e permite aceitar, editar ou rejeitar as sugestões.
 */

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Brain, 
  Play, 
  CheckCircle, 
  XCircle, 
  Clock,
  AlertCircle
} from 'lucide-react';
import { 
  ProjectExtractionTemplate, 
  ExtractionInstance, 
  ExtractedValue 
} from '@/types/extraction';

interface AISuggestionsPanelProps {
  projectId: string;
  articleId: string | null;
  template: ProjectExtractionTemplate | null;
  instances: ExtractionInstance[];
  values: ExtractedValue[];
}

export function AISuggestionsPanel({
  projectId,
  articleId,
  template,
  instances,
  values
}: AISuggestionsPanelProps) {
  if (!template) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-8">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h4 className="font-medium mb-2">Nenhum template selecionado</h4>
            <p className="text-sm text-muted-foreground">
              Selecione um template de extração para usar sugestões de IA
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!articleId) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-8">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h4 className="font-medium mb-2">Nenhum artigo selecionado</h4>
            <p className="text-sm text-muted-foreground">
              Selecione um artigo para gerar sugestões de IA
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Sugestões de IA</h3>
          <p className="text-sm text-muted-foreground">
            Use inteligência artificial para acelerar a extração de dados
          </p>
        </div>
        <Button>
          <Play className="h-4 w-4 mr-2" />
          Executar IA
        </Button>
      </div>

      {/* Status da IA */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Status da IA</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Não executada</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Execute a IA para gerar sugestões
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Sugestões Geradas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">
              sugestões pendentes
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Taxa de Aceitação</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">-</div>
            <p className="text-xs text-muted-foreground">
              sugestões aceitas
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Configurações de IA */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Brain className="h-5 w-5" />
            <span>Configurações</span>
          </CardTitle>
          <CardDescription>
            Configure como a IA deve processar os artigos
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Modelo de IA</label>
                <select className="w-full mt-1 p-2 border rounded-md">
                  <option value="gemini-2.5-flash">Google Gemini 2.5 Flash</option>
                  <option value="gpt-4">OpenAI GPT-4</option>
                  <option value="claude-3">Anthropic Claude 3</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Confiança Mínima</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  defaultValue="0.7"
                  className="w-full mt-1"
                />
                <div className="text-xs text-muted-foreground mt-1">70%</div>
              </div>
            </div>
            
            <div>
              <label className="text-sm font-medium">Campos para Extração</label>
              <div className="mt-2 space-y-2">
                <label className="flex items-center space-x-2">
                  <input type="checkbox" defaultChecked />
                  <span className="text-sm">Informações básicas do estudo</span>
                </label>
                <label className="flex items-center space-x-2">
                  <input type="checkbox" defaultChecked />
                  <span className="text-sm">Características dos participantes</span>
                </label>
                <label className="flex items-center space-x-2">
                  <input type="checkbox" defaultChecked />
                  <span className="text-sm">Métodos estatísticos</span>
                </label>
                <label className="flex items-center space-x-2">
                  <input type="checkbox" />
                  <span className="text-sm">Resultados e métricas</span>
                </label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Histórico de Execuções */}
      <Card>
        <CardHeader>
          <CardTitle>Histórico de Execuções</CardTitle>
          <CardDescription>
            Execuções anteriores da IA para este artigo
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h4 className="font-medium mb-2">Nenhuma execução encontrada</h4>
            <p className="text-sm text-muted-foreground">
              Execute a IA pela primeira vez para gerar sugestões
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Sugestões (placeholder) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <CheckCircle className="h-5 w-5" />
            <span>Sugestões</span>
          </CardTitle>
          <CardDescription>
            Sugestões geradas pela IA para revisão
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <XCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h4 className="font-medium mb-2">Nenhuma sugestão disponível</h4>
            <p className="text-sm text-muted-foreground mb-4">
              Execute a IA para gerar sugestões de valores
            </p>
            <Button>
              <Play className="h-4 w-4 mr-2" />
              Executar IA
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Ações em lote */}
      <Card>
        <CardHeader>
          <CardTitle>Ações em Lote</CardTitle>
          <CardDescription>
            Ações rápidas para múltiplas sugestões
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex space-x-2">
            <Button variant="outline" disabled>
              <CheckCircle className="h-4 w-4 mr-2" />
              Aceitar Todas
            </Button>
            <Button variant="outline" disabled>
              <XCircle className="h-4 w-4 mr-2" />
              Rejeitar Todas
            </Button>
            <Button variant="outline" disabled>
              <Brain className="h-4 w-4 mr-2" />
              Reprocessar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
