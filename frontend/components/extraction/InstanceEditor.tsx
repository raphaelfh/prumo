/**
 * Component to edit extraction instances
 *
 * Allows creating, editing and managing entity instances
 * for article data extraction.
 */

import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {AlertCircle, CheckCircle, Edit, FileText, Plus, Trash2} from 'lucide-react';
import {t} from '@/lib/copy';
import {ExtractionValueDisplay, ExtractionInstance, ProjectExtractionTemplate} from '@/types/extraction';

interface InstanceEditorProps {
    projectId?: string; // Kept for compatibility, not used currently
  template: ProjectExtractionTemplate | null;
  instances: ExtractionInstance[];
  values: ExtractionValueDisplay[];
  onInstanceCreate: (entityTypeId: string, label: string, parentInstanceId?: string) => Promise<ExtractionInstance | null>;
  onInstanceUpdate: (instanceId: string, updates: Partial<ExtractionInstance>) => Promise<ExtractionInstance | null>;
  onInstanceDelete: (instanceId: string) => Promise<boolean>;
  onValueSave: (instanceId: string, fieldId: string, value: any, source?: any, confidenceScore?: number, evidenceData?: any[]) => Promise<ExtractionValueDisplay | null>;
  onValueUpdate: (valueId: string, updates: Partial<ExtractionValueDisplay>) => Promise<ExtractionValueDisplay | null>;
  onValueDelete: (valueId: string) => Promise<boolean>;
  loading: boolean;
}

export function InstanceEditor({
  projectId: _projectId,
  template,
  instances,
  values,
  onInstanceCreate: _onInstanceCreate,
  onInstanceUpdate: _onInstanceUpdate,
  onInstanceDelete: _onInstanceDelete,
  onValueSave: _onValueSave,
  onValueUpdate: _onValueUpdate,
  onValueDelete: _onValueDelete,
  loading
}: InstanceEditorProps) {
  if (!template) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center py-8">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h4 className="font-medium mb-2">{t('extraction', 'noTemplateSelected')}</h4>
            <p className="text-sm text-muted-foreground">
                {t('extraction', 'selectTemplateToStart')}
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
            <h3 className="text-lg font-semibold">{t('extraction', 'instanceEditorTitle')}</h3>
          <p className="text-sm text-muted-foreground">
              {t('extraction', 'instanceEditorDesc').replace('{{name}}', template.name)}
          </p>
        </div>
        <Button disabled={loading}>
          <Plus className="h-4 w-4 mr-2" />
            {t('extraction', 'newInstance')}
        </Button>
      </div>

        {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t('extraction', 'totalInstances')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{instances.length}</div>
            <p className="text-xs text-muted-foreground">
                {t('extraction', 'instancesCreated')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t('extraction', 'valuesExtracted')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{values.length}</div>
            <p className="text-xs text-muted-foreground">
                {t('extraction', 'valuesFilled')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t('extraction', 'progressLabel')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {instances.length > 0 ? Math.round((values.length / (instances.length * 5)) * 100) : 0}%
            </div>
            <p className="text-xs text-muted-foreground">
                {t('extraction', 'completeness')}
            </p>
          </CardContent>
        </Card>
      </div>

        {/* Instance list */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <FileText className="h-5 w-5" />
              <span>{t('extraction', 'instancesCardTitle')}</span>
          </CardTitle>
          <CardDescription>
              {t('extraction', 'instancesCardDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto mb-2"></div>
                  <p className="text-sm text-muted-foreground">{t('extraction', 'loadingInstances')}</p>
              </div>
            </div>
          ) : instances.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h4 className="font-medium mb-2">{t('extraction', 'noInstancesCreated')}</h4>
              <p className="text-sm text-muted-foreground mb-4">
                  {t('extraction', 'createInstancesToStart')}
              </p>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                  {t('extraction', 'createFirstInstance')}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {instances.map((instance) => {
                const instanceValues = values.filter(v => v.instance_id === instance.id);
                const completionPercentage = Math.round((instanceValues.length / 5) * 100); // Placeholder

                return (
                  <div
                    key={instance.id}
                    className="p-4 border rounded-lg hover:border-primary/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="flex items-center space-x-2">
                          {completionPercentage === 100 ? (
                            <CheckCircle className="h-5 w-5 text-green-500" />
                          ) : (
                            <AlertCircle className="h-5 w-5 text-orange-500" />
                          )}
                          <div>
                            <h4 className="font-medium">{instance.label}</h4>
                            <p className="text-sm text-muted-foreground">
                                {instanceValues.length} {t('extraction', 'valuesFilledCount')}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge variant="outline">
                            {completionPercentage}% {t('extraction', 'complete')}
                        </Badge>
                        <Button size="sm" variant="outline">
                          <Edit className="h-4 w-4 mr-2" />
                            {t('common', 'edit')}
                        </Button>
                        <Button size="sm" variant="outline" className="text-destructive">
                          <Trash2 className="h-4 w-4 mr-2" />
                            {t('common', 'delete')}
                        </Button>
                      </div>
                    </div>
                    
                    {/* Progress bar */}
                    <div className="mt-3">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all"
                          style={{ width: `${completionPercentage}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

        {/* Placeholder for edit form */}
      <Card>
        <CardHeader>
            <CardTitle>{t('extraction', 'fieldEditorTitle')}</CardTitle>
          <CardDescription>
              {t('extraction', 'fieldEditorDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Edit className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h4 className="font-medium mb-2">{t('extraction', 'selectInstance')}</h4>
            <p className="text-sm text-muted-foreground">
                {t('extraction', 'clickInstanceToEdit')}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
