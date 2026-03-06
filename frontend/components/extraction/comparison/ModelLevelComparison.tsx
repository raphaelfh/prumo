/**
 * Predictive model comparison (1:1)
 *
 * Lets the user select:
 * 1. Which of YOUR models to compare
 * 2. With which OTHER USER to compare
 * 3. Which MODEL of that user to compare
 *
 * Renders side-by-side grid using generic ComparisonTable.
 *
 * Features:
 * - Cascade selectors (own model → user → user's model)
 * - Smart auto-selection (first available model)
 * - State validation (must have models)
 * - 1:1 comparison grid
 *
 * @component
 */

import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info } from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import { ComparisonTable, type ComparisonColumn, type ComparisonUser } from '@/components/shared/comparison';
import type { ExtractionEntityType, ExtractionField, ExtractionInstance } from '@/types/extraction';
import type { OtherExtraction } from '@/hooks/extraction/colaboracao/useOtherExtractions';
import {t} from '@/lib/copy';

// =================== INTERFACES ===================

interface ModelLevelComparisonProps {
  modelParentType: ExtractionEntityType;
  entityTypes: ExtractionEntityType[];
  myInstances: Record<string, ExtractionInstance[]>; // entityTypeId -> instances
  myValues: Record<string, any>;
  otherExtractions: OtherExtraction[];
  currentUser: ComparisonUser;
}

// =================== COMPONENT ===================

export function ModelLevelComparison(props: ModelLevelComparisonProps) {
  const {
    modelParentType,
    entityTypes,
    myInstances,
    myValues,
    otherExtractions,
    currentUser
  } = props;

  const [mySelectedModelId, setMySelectedModelId] = useState<string | null>(null);
  const [otherSelectedUserId, setOtherSelectedUserId] = useState<string | null>(null);
  const [otherSelectedModelId, setOtherSelectedModelId] = useState<string | null>(null);

    // My models (instances of type prediction_models)
  const myModels = myInstances[modelParentType.id] || [];

    // Auto-select first model of current user
  useEffect(() => {
    if (myModels.length > 0 && !mySelectedModelId) {
      setMySelectedModelId(myModels[0].id);
    }
  }, [myModels, mySelectedModelId]);

    // Extract models from other users
    // NOTE: otherExtractions.values contains flat extracted_values data
    // We infer which instances exist from the keys
  const modelsByUser = useMemo(() => {
    const grouped = new Map<string, Array<{ id: string; label: string }>>();

    otherExtractions.forEach(ext => {
      const userModels: Array<{ id: string; label: string }> = [];

        // Parse keys to find unique instanceIds
        // Expected format: `${instanceId}_${fieldId}`
      const instanceIds = new Set<string>();

      Object.keys(ext.values).forEach(key => {
        const parts = key.split('_');
        if (parts.length >= 2) {
            // First part is instanceId (UUID format)
          const potentialInstanceId = parts[0];
          if (potentialInstanceId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
            instanceIds.add(potentialInstanceId);
          }
        }
      });

        // For each instanceId, create entry (we use instanceId as label for now)
        // TODO: Fetch real label from DB or metadata
      instanceIds.forEach(instanceId => {
        userModels.push({
          id: instanceId,
            label: t('shared', 'modelFallbackLabel').replace('{{n}}', String(userModels.length + 1)),
        });
      });

      if (userModels.length > 0) {
        grouped.set(ext.userId, userModels);
      }
    });

    return grouped;
  }, [otherExtractions]);

    // Reset selected model when user changes
  useEffect(() => {
    if (otherSelectedUserId) {
      const userModels = modelsByUser.get(otherSelectedUserId);
      if (userModels && userModels.length > 0) {
        setOtherSelectedModelId(userModels[0].id);
      } else {
        setOtherSelectedModelId(null);
      }
    }
  }, [otherSelectedUserId, modelsByUser]);

    // Get child entity types of model (Candidate Predictors, Performance, etc)
  const modelChildTypes = useMemo(() => 
    entityTypes.filter(et => et.parent_entity_type_id === modelParentType.id),
    [entityTypes, modelParentType.id]
  );

    // Prepare columns for model-level (fields of child types)
  const modelColumns = useMemo<ComparisonColumn[]>(() => {
    const columns: ComparisonColumn[] = [];

    modelChildTypes.forEach(childType => {
        // Get fields of this child type (if loaded)
      const fields = (childType as any).fields || [];

      fields.forEach((field: ExtractionField) => {
        columns.push({
          id: field.id,
          label: `${childType.label} > ${field.label}`,
          getValue: (fieldId: string, userData: Record<string, any>) => {
              // For model-level we need instanceId
              // Use selected models
              // Key: `${instanceId}_${fieldId}`
              return userData[fieldId]; // Will be adjusted with instanceId when rendering
          },
          isRequired: field.is_required
        });
      });
    });

    return columns;
  }, [modelChildTypes]);

    // Prepare data for the 2 selected models
  const modelComparisonData = useMemo(() => {
    if (!mySelectedModelId || !otherSelectedModelId || !otherSelectedUserId) {
      return {};
    }

    const data: Record<string, Record<string, any>> = {};

      // My selected model data
    const myModelData: Record<string, any> = {};
    modelColumns.forEach(column => {
      const key = `${mySelectedModelId}_${column.id}`;
      myModelData[column.id] = myValues[key];
    });
    data[currentUser.userId] = myModelData;

      // Other user's model data
    const otherUserData: Record<string, any> = {};
    const otherExtraction = otherExtractions.find(e => e.userId === otherSelectedUserId);
    if (otherExtraction) {
      modelColumns.forEach(column => {
        const key = `${otherSelectedModelId}_${column.id}`;
        otherUserData[column.id] = otherExtraction.values[key];
      });
    }
    data[otherSelectedUserId] = otherUserData;

    return data;
  }, [mySelectedModelId, otherSelectedModelId, otherSelectedUserId, myValues, otherExtractions, modelColumns, currentUser.userId]);

    // Validation
  if (myModels.length === 0) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
            {t('shared', 'youHaveNoModels')} {t('shared', 'youHaveNoModelsDesc')}
        </AlertDescription>
      </Alert>
    );
  }

  if (modelsByUser.size === 0) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
            {t('shared', 'noOtherReviewersCreatedModels')} {t('shared', 'noOtherReviewersCreatedModelsDesc')}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
        {/* Model selectors */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left column: My model */}
            <div className="space-y-2">
                <Label className="text-sm font-medium">{t('shared', 'yourModel')}</Label>
              <Select 
                value={mySelectedModelId || ''} 
                onValueChange={setMySelectedModelId}
              >
                <SelectTrigger>
                    <SelectValue placeholder={t('shared', 'selectYourModel')}/>
                </SelectTrigger>
                <SelectContent>
                  {myModels.map(model => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                  {t('shared', 'modelsCreatedCount').replace('{{n}}', String(myModels.length))}
              </p>
            </div>

              {/* Right column: Other user's model */}
            <div className="space-y-2">
                <Label className="text-sm font-medium">{t('shared', 'compareWith')}</Label>
              
              <Select 
                value={otherSelectedUserId || ''} 
                onValueChange={setOtherSelectedUserId}
              >
                <SelectTrigger>
                    <SelectValue placeholder={t('shared', 'selectOtherReviewer')}/>
                </SelectTrigger>
                <SelectContent>
                  {Array.from(modelsByUser.entries()).map(([userId, models]) => {
                    const user = otherExtractions.find(e => e.userId === userId);
                    return (
                      <SelectItem key={userId} value={userId}>
                          {user?.userName} ({t('shared', 'modelsCreatedCount').replace('{{n}}', String(models.length))})
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>

                {/* Model selector (cascade) */}
              {otherSelectedUserId && modelsByUser.get(otherSelectedUserId) && (
                <Select 
                  value={otherSelectedModelId || ''} 
                  onValueChange={setOtherSelectedModelId}
                >
                  <SelectTrigger>
                      <SelectValue placeholder={t('shared', 'selectModel')}/>
                  </SelectTrigger>
                  <SelectContent>
                    {modelsByUser.get(otherSelectedUserId)!.map(model => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {otherSelectedUserId && !otherSelectedModelId && (
                <p className="text-xs text-muted-foreground">
                    {t('shared', 'selectModelAbove')}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

        {/* 1:1 comparison grid */}
      {mySelectedModelId && otherSelectedModelId && otherSelectedUserId && (
        <>
            {/* Info about models being compared */}
          <div className="flex items-center justify-between bg-muted/50 rounded-lg p-3 text-sm">
            <div className="flex items-center gap-2">
                <Badge variant="secondary">{t('shared', 'yourModel')}</Badge>
              <span className="font-medium">
                {myModels.find(m => m.id === mySelectedModelId)?.label}
              </span>
            </div>
            <span className="text-muted-foreground">vs</span>
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                {otherExtractions.find(e => e.userId === otherSelectedUserId)?.userName}
              </Badge>
              <span className="font-medium">
                {modelsByUser.get(otherSelectedUserId)?.find(m => m.id === otherSelectedModelId)?.label}
              </span>
            </div>
          </div>

            {/* Comparison table */}
          <ComparisonTable
            columns={modelColumns}
            rows={modelColumns.map(c => c.id)}
            currentUser={currentUser}
            otherUsers={[
              otherExtractions.find(e => e.userId === otherSelectedUserId)!
            ].map(ext => ({
              userId: ext.userId,
              userName: ext.userName,
              userAvatar: ext.userAvatar,
              isCurrentUser: false
            }))}
            data={modelComparisonData}
            showConsensus={false} // Not meaningful for 1:1 comparison
            maxHeight="500px"
          />
        </>
      )}
    </div>
  );
}

