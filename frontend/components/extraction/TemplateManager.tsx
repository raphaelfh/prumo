/**
 * Component to manage extraction templates
 *
 * Clone global templates, create custom templates
 * e gerenciar templates ativos do projeto.
 */

import React, {useState} from 'react';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {AlertCircle, CheckCircle, Copy, Database, Plus, Settings} from 'lucide-react';
import {toast} from 'sonner';
import {t} from '@/lib/copy';
import {ProjectExtractionTemplate} from '@/types/extraction';
import {useGlobalTemplates} from '@/hooks/extraction/useGlobalTemplates';

interface TemplateManagerProps {
  projectId: string;
  templates: ProjectExtractionTemplate[];
  activeTemplate: ProjectExtractionTemplate | null;
  onTemplateSelect: (template: ProjectExtractionTemplate) => void;
  onTemplateClone: (globalTemplateId: string, customName?: string) => Promise<ProjectExtractionTemplate | null>;
  onTemplateCreate: (name: string, description: string, framework: 'CHARMS' | 'PICOS' | 'CUSTOM') => Promise<ProjectExtractionTemplate | null>;
  loading: boolean;
}

export function TemplateManager({
                                    projectId: _projectId,
  templates,
  activeTemplate,
  onTemplateSelect,
  onTemplateClone,
  onTemplateCreate,
  loading
}: TemplateManagerProps) {
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const {
    templates: globalTemplates,
    loading: loadingGlobalTemplates,
    error: globalTemplatesError,
    refresh: refreshGlobalTemplates
  } = useGlobalTemplates();

  const handleCloneTemplate = async (globalTemplateId: string, customName?: string) => {
    const result = await onTemplateClone(globalTemplateId, customName);
    if (result) {
      setShowCloneDialog(false);
      onTemplateSelect(result);
    } else {
        toast.error(t('extraction', 'cloneError'));
    }
  };

    const _handleCreateTemplate = async (name: string, description: string, framework: 'CHARMS' | 'PICOS' | 'CUSTOM') => {
    const result = await onTemplateCreate(name, description, framework);
    if (result) {
      setShowCreateDialog(false);
      onTemplateSelect(result);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
            <h3 className="text-lg font-semibold">{t('extraction', 'templateManageTitle')}</h3>
          <p className="text-sm text-muted-foreground">
              {t('extraction', 'templateManageDesc')}
          </p>
        </div>
        <div className="flex space-x-2">
          <Button
            onClick={() => setShowCloneDialog(true)}
            variant="outline"
            size="sm"
          >
            <Copy className="h-4 w-4 mr-2" />
              {t('extraction', 'templateCloneButton')}
          </Button>
          <Button
            onClick={() => setShowCreateDialog(true)}
            size="sm"
          >
            <Plus className="h-4 w-4 mr-2" />
              {t('extraction', 'templateCreateButton')}
          </Button>
        </div>
      </div>

      {/* Templates do Projeto */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Database className="h-5 w-5" />
              <span>{t('extraction', 'templateProjectTemplates')}</span>
          </CardTitle>
          <CardDescription>
              {t('extraction', 'templateProjectDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto mb-2"></div>
                  <p className="text-sm text-muted-foreground">{t('extraction', 'loadingTemplates')}</p>
              </div>
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-8">
              <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h4 className="font-medium mb-2">{t('extraction', 'templateNoneFound')}</h4>
              <p className="text-sm text-muted-foreground mb-4">
                  {t('extraction', 'templateNoneHint')}
              </p>
              <div className="flex justify-center space-x-2">
                <Button
                  onClick={() => setShowCloneDialog(true)}
                  variant="outline"
                  size="sm"
                >
                  <Copy className="h-4 w-4 mr-2" />
                    {t('extraction', 'templateCloneButton')}
                </Button>
                <Button
                  onClick={() => setShowCreateDialog(true)}
                  size="sm"
                >
                  <Plus className="h-4 w-4 mr-2" />
                    {t('extraction', 'templateCreateButton')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                    activeTemplate?.id === template.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                  }`}
                  onClick={() => onTemplateSelect(template)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      {activeTemplate?.id === template.id && (
                        <CheckCircle className="h-5 w-5 text-primary" />
                      )}
                      <div>
                        <h4 className="font-medium">{template.name}</h4>
                        <p className="text-sm text-muted-foreground">
                            {template.description || t('extraction', 'noDescription')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge variant="outline">{template.framework}</Badge>
                      <Badge variant="secondary">v{template.version}</Badge>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                      {t('extraction', 'templateCreatedAt')} {new Date(template.created_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

        {/* Available global templates */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Settings className="h-5 w-5" />
            <span>Templates Globais</span>
          </CardTitle>
          <CardDescription>
              Default templates available for cloning
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingGlobalTemplates ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto mb-2"></div>
                <p className="text-sm text-muted-foreground">
                    {t('extraction', 'loadingGlobalTemplates')}
                </p>
              </div>
            </div>
          ) : globalTemplatesError ? (
            <div className="text-center py-8">
              <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h4 className="font-medium mb-2">{t('extraction', 'errorLoadTemplates')}</h4>
              <p className="text-sm text-muted-foreground mb-4">
                {globalTemplatesError}
              </p>
              <Button
                onClick={refreshGlobalTemplates}
                variant="outline"
                size="sm"
              >
                  {t('common', 'tryAgain')}
              </Button>
            </div>
          ) : globalTemplates.length === 0 ? (
            <div className="text-center py-8">
              <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h4 className="font-medium mb-2">{t('extraction', 'configNoGlobalTemplates')}</h4>
              <p className="text-sm text-muted-foreground mb-2">
                  {t('extraction', 'runMigrationsHint')}
              </p>
              <Button
                onClick={refreshGlobalTemplates}
                variant="outline"
                size="sm"
              >
                  {t('extraction', 'updateList')}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {globalTemplates.map((template) => (
                <div
                  key={template.id}
                  className="p-4 border rounded-lg"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-medium">{template.name}</h4>
                      <p className="text-sm text-muted-foreground">
                          {template.description || t('extraction', 'noDescription')}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                          {template.entityTypesCount} {t('extraction', 'sectionsConfigured')} · v{template.version}
                      </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge variant="outline">{template.framework}</Badge>
                      <Button
                        onClick={() => handleCloneTemplate(template.id)}
                        size="sm"
                        variant="outline"
                      >
                        <Copy className="h-4 w-4 mr-2" />
                          {t('extraction', 'cloneButton')}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

        {/* Dialogs placeholder - to be implemented later */}
      {showCloneDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
                <CardTitle>{t('extraction', 'cloneTemplateTitle')}</CardTitle>
              <CardDescription>
                  {t('extraction', 'chooseTemplateToClone')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                  {t('extraction', 'comingSoon')}
              </p>
              <div className="flex justify-end space-x-2">
                <Button
                  onClick={() => setShowCloneDialog(false)}
                  variant="outline"
                >
                    {t('common', 'cancel')}
                </Button>
                <Button onClick={() => setShowCloneDialog(false)}>
                    {t('extraction', 'cloneButton')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {showCreateDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
                <CardTitle>{t('extraction', 'createCustomTemplateTitle')}</CardTitle>
              <CardDescription>
                  {t('extraction', 'createCustomTemplateDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                  {t('extraction', 'comingSoon')}
              </p>
              <div className="flex justify-end space-x-2">
                <Button
                  onClick={() => setShowCreateDialog(false)}
                  variant="outline"
                >
                    {t('common', 'cancel')}
                </Button>
                <Button onClick={() => setShowCreateDialog(false)}>
                    {t('extraction', 'createButton')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
