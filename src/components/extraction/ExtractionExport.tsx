/**
 * Componente para exportar dados extraídos
 * 
 * Permite exportar dados extraídos em diferentes formatos
 * (CSV, JSON, Excel) com opções de filtros e formatação.
 */

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Download, 
  FileText, 
  Database, 
  Settings,
  AlertCircle
} from 'lucide-react';
import { 
  ProjectExtractionTemplate, 
  ExtractionInstance, 
  ExtractedValue 
} from '@/types/extraction';

interface ExtractionExportProps {
  projectId: string;
  template: ProjectExtractionTemplate | null;
  instances: ExtractionInstance[];
  values: ExtractedValue[];
}

export function ExtractionExport({
  projectId: _projectId,
  template,
  instances,
  values
}: ExtractionExportProps) {
  const [exportFormat, setExportFormat] = useState<'csv' | 'json' | 'excel'>('csv');
  const [includeEvidence, setIncludeEvidence] = useState(true);
  const [includeMetadata, setIncludeMetadata] = useState(false);
  const [filterCompleted, setFilterCompleted] = useState(false);

  if (!template) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-8">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h4 className="font-medium mb-2">Nenhum template selecionado</h4>
            <p className="text-sm text-muted-foreground">
              Selecione um template de extração para exportar dados
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasData = instances.length > 0 || values.length > 0;

  if (!hasData) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-8">
            <Database className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h4 className="font-medium mb-2">Nenhum dado para exportar</h4>
            <p className="text-sm text-muted-foreground">
              Crie instâncias e preencha valores antes de exportar
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const handleExport = async () => {
    // Placeholder para lógica de exportação
    console.log('Exportando dados:', {
      format: exportFormat,
      includeEvidence,
      includeMetadata,
      filterCompleted,
      instances: instances.length,
      values: values.length
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Exportar Dados</h3>
          <p className="text-sm text-muted-foreground">
            Exporte dados extraídos em diferentes formatos
          </p>
        </div>
        <Button onClick={handleExport}>
          <Download className="h-4 w-4 mr-2" />
          Exportar
        </Button>
      </div>

      {/* Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Template</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">{template.name}</div>
            <p className="text-xs text-muted-foreground">
              {template.framework} v{template.version}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Instâncias</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{instances.length}</div>
            <p className="text-xs text-muted-foreground">
              instâncias criadas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Valores</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{values.length}</div>
            <p className="text-xs text-muted-foreground">
              valores extraídos
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Completude</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {instances.length > 0 ? Math.round((values.length / (instances.length * 5)) * 100) : 0}%
            </div>
            <p className="text-xs text-muted-foreground">
              de completude
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Configurações de Exportação */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Settings className="h-5 w-5" />
            <span>Configurações de Exportação</span>
          </CardTitle>
          <CardDescription>
            Configure como os dados devem ser exportados
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Formato */}
          <div>
            <label className="text-sm font-medium mb-3 block">Formato de Exportação</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Button
                variant={exportFormat === 'csv' ? 'default' : 'outline'}
                onClick={() => setExportFormat('csv')}
                className="flex flex-col items-center space-y-2 h-auto p-4"
              >
                <FileText className="h-6 w-6" />
                <div className="text-center">
                  <div className="font-medium">CSV</div>
                  <div className="text-xs opacity-80">Planilha compatível</div>
                </div>
              </Button>
              
              <Button
                variant={exportFormat === 'json' ? 'default' : 'outline'}
                onClick={() => setExportFormat('json')}
                className="flex flex-col items-center space-y-2 h-auto p-4"
              >
                <Database className="h-6 w-6" />
                <div className="text-center">
                  <div className="font-medium">JSON</div>
                  <div className="text-xs opacity-80">Dados estruturados</div>
                </div>
              </Button>
              
              <Button
                variant={exportFormat === 'excel' ? 'default' : 'outline'}
                onClick={() => setExportFormat('excel')}
                className="flex flex-col items-center space-y-2 h-auto p-4"
              >
                <Download className="h-6 w-6" />
                <div className="text-center">
                  <div className="font-medium">Excel</div>
                  <div className="text-xs opacity-80">Arquivo Excel</div>
                </div>
              </Button>
            </div>
          </div>

          {/* Opções */}
          <div>
            <label className="text-sm font-medium mb-3 block">Opções de Inclusão</label>
            <div className="space-y-3">
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={includeEvidence}
                  onChange={(e) => setIncludeEvidence(e.target.checked)}
                />
                <span className="text-sm">Incluir evidências (citações e referências)</span>
              </label>
              
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={includeMetadata}
                  onChange={(e) => setIncludeMetadata(e.target.checked)}
                />
                <span className="text-sm">Incluir metadados (datas, revisores, etc.)</span>
              </label>
              
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={filterCompleted}
                  onChange={(e) => setFilterCompleted(e.target.checked)}
                />
                <span className="text-sm">Exportar apenas instâncias completas</span>
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Preview dos Dados */}
      <Card>
        <CardHeader>
          <CardTitle>Preview dos Dados</CardTitle>
          <CardDescription>
            Visualização dos dados que serão exportados
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Resumo das instâncias */}
            <div>
              <h4 className="font-medium mb-2">Instâncias ({instances.length})</h4>
              <div className="space-y-2">
                {instances.slice(0, 3).map((instance) => {
                  const instanceValues = values.filter(v => v.instance_id === instance.id);
                  return (
                    <div key={instance.id} className="flex items-center justify-between p-2 bg-muted rounded">
                      <span className="text-sm">{instance.label}</span>
                      <Badge variant="outline">
                        {instanceValues.length} valores
                      </Badge>
                    </div>
                  );
                })}
                {instances.length > 3 && (
                  <div className="text-sm text-muted-foreground">
                    ... e mais {instances.length - 3} instâncias
                  </div>
                )}
              </div>
            </div>

            {/* Resumo dos valores */}
            <div>
              <h4 className="font-medium mb-2">Valores ({values.length})</h4>
              <div className="text-sm text-muted-foreground">
                {values.length} valores extraídos de {new Set(values.map(v => v.instance_id)).size} instâncias
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ações */}
      <div className="flex justify-end space-x-2">
        <Button variant="outline">
          <Settings className="h-4 w-4 mr-2" />
          Configurações Avançadas
        </Button>
        <Button onClick={handleExport}>
          <Download className="h-4 w-4 mr-2" />
          Exportar {exportFormat.toUpperCase()}
        </Button>
      </div>
    </div>
  );
}
