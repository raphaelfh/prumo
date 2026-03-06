/**
 * Component to manage AI suggestions
 *
 * Displays AI-generated suggestions for extraction values
 * and allows accepting, editing or rejecting suggestions.
 */

import React from 'react';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {AlertCircle, Brain, CheckCircle, Clock, Play, XCircle} from 'lucide-react';
import {ExtractedValue, ExtractionInstance, ProjectExtractionTemplate} from '@/types/extraction';
import {t} from '@/lib/copy';

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
              <h4 className="font-medium mb-2">{t('extraction', 'aiPanelNoTemplate')}</h4>
            <p className="text-sm text-muted-foreground">
                {t('extraction', 'aiPanelNoTemplateDesc')}
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
              <h4 className="font-medium mb-2">{t('extraction', 'aiPanelNoArticle')}</h4>
            <p className="text-sm text-muted-foreground">
                {t('extraction', 'aiPanelNoArticleDesc')}
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
            <h3 className="text-lg font-semibold">{t('extraction', 'aiPanelTitle')}</h3>
          <p className="text-sm text-muted-foreground">
              {t('extraction', 'aiPanelSubtitle')}
          </p>
        </div>
        <Button>
          <Play className="h-4 w-4 mr-2" />
            {t('extraction', 'aiPanelRunAI')}
        </Button>
      </div>

      {/* Status da IA */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t('extraction', 'aiPanelStatusTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{t('extraction', 'aiPanelStatusNotRun')}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
                {t('extraction', 'aiPanelStatusNotRunDesc')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t('extraction', 'aiPanelSuggestionsGenerated')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">
                {t('extraction', 'aiPanelSuggestionsPending')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t('extraction', 'aiPanelAcceptanceRate')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">-</div>
            <p className="text-xs text-muted-foreground">
                {t('extraction', 'aiPanelSuggestionsAccepted')}
            </p>
          </CardContent>
        </Card>
      </div>

        {/* AI settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Brain className="h-5 w-5" />
              <span>{t('extraction', 'aiPanelSettingsTitle')}</span>
          </CardTitle>
          <CardDescription>
              {t('extraction', 'aiPanelConfigureDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                  <label className="text-sm font-medium">{t('extraction', 'aiPanelAIModelLabel')}</label>
                <select className="w-full mt-1 p-2 border rounded-md">
                  <option value="gemini-2.5-flash">Google Gemini 2.5 Flash</option>
                  <option value="gpt-4">OpenAI GPT-4</option>
                  <option value="claude-3">Anthropic Claude 3</option>
                </select>
              </div>
              <div>
                  <label className="text-sm font-medium">{t('extraction', 'aiPanelMinConfidenceLabel')}</label>
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
                <label className="text-sm font-medium">{t('extraction', 'aiPanelFieldsForExtractionLabel')}</label>
              <div className="mt-2 space-y-2">
                <label className="flex items-center space-x-2">
                  <input type="checkbox" defaultChecked />
                    <span className="text-sm">{t('extraction', 'aiPanelStudyInfo')}</span>
                </label>
                <label className="flex items-center space-x-2">
                  <input type="checkbox" defaultChecked />
                    <span className="text-sm">{t('extraction', 'aiPanelParticipantChars')}</span>
                </label>
                <label className="flex items-center space-x-2">
                  <input type="checkbox" defaultChecked />
                    <span className="text-sm">{t('extraction', 'aiPanelStatisticalMethods')}</span>
                </label>
                <label className="flex items-center space-x-2">
                  <input type="checkbox" />
                    <span className="text-sm">{t('extraction', 'aiPanelResultsMetrics')}</span>
                </label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

        {/* Run history */}
      <Card>
        <CardHeader>
            <CardTitle>{t('extraction', 'aiPanelHistoryTitle')}</CardTitle>
          <CardDescription>
              {t('extraction', 'aiPanelHistoryDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h4 className="font-medium mb-2">{t('extraction', 'aiPanelNoRunsFound')}</h4>
            <p className="text-sm text-muted-foreground">
                {t('extraction', 'aiPanelNoRunsDesc')}
            </p>
          </div>
        </CardContent>
      </Card>

        {/* Suggestions (placeholder) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <CheckCircle className="h-5 w-5" />
              <span>{t('extraction', 'aiPanelSuggestionsCardTitle')}</span>
          </CardTitle>
          <CardDescription>
              {t('extraction', 'aiPanelSuggestionsCardDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <XCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h4 className="font-medium mb-2">{t('extraction', 'aiPanelNoSuggestionsAvailable')}</h4>
            <p className="text-sm text-muted-foreground mb-4">
                {t('extraction', 'aiPanelNoSuggestionsDesc')}
            </p>
            <Button>
              <Play className="h-4 w-4 mr-2" />
                {t('extraction', 'aiPanelRunAI')}
            </Button>
          </div>
        </CardContent>
      </Card>

        {/* Batch actions */}
      <Card>
        <CardHeader>
            <CardTitle>{t('extraction', 'aiPanelBatchActionsTitle')}</CardTitle>
          <CardDescription>
              {t('extraction', 'aiPanelBatchActionsDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex space-x-2">
            <Button variant="outline" disabled>
              <CheckCircle className="h-4 w-4 mr-2" />
                {t('extraction', 'aiPanelAcceptAll')}
            </Button>
            <Button variant="outline" disabled>
              <XCircle className="h-4 w-4 mr-2" />
                {t('extraction', 'aiPanelRejectAll')}
            </Button>
            <Button variant="outline" disabled>
              <Brain className="h-4 w-4 mr-2" />
                {t('extraction', 'aiPanelReprocess')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
