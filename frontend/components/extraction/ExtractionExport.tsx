/**
 * Component to export extracted data
 *
 * Export extracted data in different formats
 * (CSV, JSON, Excel) with filter and formatting options.
 */

import {useState} from 'react';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {AlertCircle, Database, Download, FileText, Settings} from 'lucide-react';
import {ExtractedValue, ExtractionInstance, ProjectExtractionTemplate} from '@/types/extraction';
import {t} from '@/lib/copy';

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
              <h4 className="font-medium mb-2">{t('extraction', 'exportNoTemplate')}</h4>
            <p className="text-sm text-muted-foreground">
                {t('extraction', 'exportNoTemplateHint')}
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
              <h4 className="font-medium mb-2">{t('extraction', 'exportNoData')}</h4>
            <p className="text-sm text-muted-foreground">
                {t('extraction', 'exportNoDataHint')}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const handleExport = async () => {
      // Placeholder for export logic
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
            <h3 className="text-lg font-semibold">{t('extraction', 'exportTitle')}</h3>
          <p className="text-sm text-muted-foreground">
              {t('extraction', 'exportSubtitle')}
          </p>
        </div>
        <Button onClick={handleExport}>
          <Download className="h-4 w-4 mr-2" />
            {t('extraction', 'exportButton')}
        </Button>
      </div>

        {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t('extraction', 'exportTemplate')}</CardTitle>
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
              <CardTitle className="text-sm font-medium">{t('extraction', 'exportInstances')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{instances.length}</div>
            <p className="text-xs text-muted-foreground">
                {t('extraction', 'exportInstancesCreated')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t('extraction', 'exportValues')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{values.length}</div>
            <p className="text-xs text-muted-foreground">
                {t('extraction', 'exportValuesExtracted')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t('extraction', 'exportCompleteness')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {instances.length > 0 ? Math.round((values.length / (instances.length * 5)) * 100) : 0}%
            </div>
            <p className="text-xs text-muted-foreground">
                {t('extraction', 'exportCompletenessOf')}
            </p>
          </CardContent>
        </Card>
      </div>

        {/* Export settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Settings className="h-5 w-5" />
              <span>{t('extraction', 'exportSettingsTitle')}</span>
          </CardTitle>
          <CardDescription>
              {t('extraction', 'exportSettingsDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Formato */}
          <div>
              <label className="text-sm font-medium mb-3 block">{t('extraction', 'exportFormatLabel')}</label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Button
                variant={exportFormat === 'csv' ? 'default' : 'outline'}
                onClick={() => setExportFormat('csv')}
                className="flex flex-col items-center space-y-2 h-auto p-4"
              >
                <FileText className="h-6 w-6" />
                <div className="text-center">
                    <div className="font-medium">{t('extraction', 'exportFormatCsv')}</div>
                    <div className="text-xs opacity-80">{t('extraction', 'exportFormatCsvDesc')}</div>
                </div>
              </Button>
              
              <Button
                variant={exportFormat === 'json' ? 'default' : 'outline'}
                onClick={() => setExportFormat('json')}
                className="flex flex-col items-center space-y-2 h-auto p-4"
              >
                <Database className="h-6 w-6" />
                <div className="text-center">
                    <div className="font-medium">{t('extraction', 'exportFormatJson')}</div>
                    <div className="text-xs opacity-80">{t('extraction', 'exportFormatJsonDesc')}</div>
                </div>
              </Button>
              
              <Button
                variant={exportFormat === 'excel' ? 'default' : 'outline'}
                onClick={() => setExportFormat('excel')}
                className="flex flex-col items-center space-y-2 h-auto p-4"
              >
                <Download className="h-6 w-6" />
                <div className="text-center">
                    <div className="font-medium">{t('extraction', 'exportFormatExcel')}</div>
                    <div className="text-xs opacity-80">{t('extraction', 'exportFormatExcelDesc')}</div>
                </div>
              </Button>
            </div>
          </div>

            {/* Options */}
          <div>
              <label className="text-sm font-medium mb-3 block">{t('extraction', 'exportIncludeOptions')}</label>
            <div className="space-y-3">
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={includeEvidence}
                  onChange={(e) => setIncludeEvidence(e.target.checked)}
                />
                  <span className="text-sm">{t('extraction', 'exportIncludeEvidence')}</span>
              </label>
              
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={includeMetadata}
                  onChange={(e) => setIncludeMetadata(e.target.checked)}
                />
                  <span className="text-sm">{t('extraction', 'exportIncludeMetadata')}</span>
              </label>
              
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={filterCompleted}
                  onChange={(e) => setFilterCompleted(e.target.checked)}
                />
                  <span className="text-sm">{t('extraction', 'exportOnlyComplete')}</span>
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

        {/* Data preview */}
      <Card>
        <CardHeader>
            <CardTitle>{t('extraction', 'dataPreviewTitle')}</CardTitle>
          <CardDescription>
              {t('extraction', 'dataPreviewDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
                <h4 className="font-medium mb-2">{t('extraction', 'instancesCardTitle')} ({instances.length})</h4>
              <div className="space-y-2">
                {instances.slice(0, 3).map((instance) => {
                  const instanceValues = values.filter(v => v.instance_id === instance.id);
                  return (
                    <div key={instance.id} className="flex items-center justify-between p-2 bg-muted rounded">
                      <span className="text-sm">{instance.label}</span>
                      <Badge variant="outline">
                          {instanceValues.length} {t('extraction', 'valuesLabelShort')}
                      </Badge>
                    </div>
                  );
                })}
                {instances.length > 3 && (
                  <div className="text-sm text-muted-foreground">
                      ... and {instances.length - 3} more instances
                  </div>
                )}
              </div>
            </div>

              {/* Values summary */}
            <div>
                <h4 className="font-medium mb-2">Values ({values.length})</h4>
              <div className="text-sm text-muted-foreground">
                  {values.length} extracted values from {new Set(values.map(v => v.instance_id)).size} instances
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

        {/* Actions */}
      <div className="flex justify-end space-x-2">
        <Button variant="outline">
          <Settings className="h-4 w-4 mr-2" />
            Advanced settings
        </Button>
        <Button onClick={handleExport}>
          <Download className="h-4 w-4 mr-2" />
          Exportar {exportFormat.toUpperCase()}
        </Button>
      </div>
    </div>
  );
}
