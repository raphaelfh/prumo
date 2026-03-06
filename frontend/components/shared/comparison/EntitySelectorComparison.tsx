/**
 * Entity selector comparison
 *
 * For cardinality='many':
 * - Groups instances by label (e.g. "model A", "model B")
 * - Selector to choose which entity to compare
 * - Table comparing that entity across ALL users
 *
 * UX example:
 * [Selector: model A ▼] <- Can choose model A, model B, etc
 *
 * Table comparing "model A":
 * | Field              | You     | User 2  | User 3  |
 * |--------------------|---------|---------|---------|
 * | Type of predictors | Clinical| Imaging | Clinical|
 * | Number of preds    | 5       | 3       | 5       |
 */

import {useCallback, useEffect, useMemo, useState} from 'react';
import {Label} from '@/components/ui/label';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select';
import {Card, CardContent} from '@/components/ui/card';
import {Badge} from '@/components/ui/badge';
import {Alert, AlertDescription} from '@/components/ui/alert';
import {Info} from 'lucide-react';
import {type ComparisonColumn, ComparisonTable, type ComparisonUser} from './ComparisonTable';
import {extractInstanceValuesForUser, groupInstancesByLabel} from '@/lib/comparison/grouping';
import {t} from '@/lib/copy';
import type {ComparisonSectionViewProps} from './ComparisonSectionView';

export function EntitySelectorComparison(props: ComparisonSectionViewProps) {
    // Group instances by label (use real DB instances)
  const groupedEntities = useMemo(() => 
    groupInstancesByLabel(
      props.instances,
      props.currentUser.userId,
        props.allUserInstances,
      props.entityType.id
    ),
    [props.instances, props.currentUser.userId, props.allUserInstances, props.entityType.id]
  );

    // State: selected entity
  const [selectedEntityLabel, setSelectedEntityLabel] = useState<string | null>(null);

    // Auto-select first entity
  useEffect(() => {
    if (groupedEntities.length > 0 && !selectedEntityLabel) {
      setSelectedEntityLabel(groupedEntities[0].label);
    }
  }, [groupedEntities, selectedEntityLabel]);

    // Active entity
  const activeEntity = useMemo(() => 
    groupedEntities.find(e => e.label === selectedEntityLabel),
    [groupedEntities, selectedEntityLabel]
  );

    // Prepare columns
  const columns = useMemo<ComparisonColumn[]>(() => 
    props.entityType.fields.map(field => ({
      id: field.id,
      label: field.label,
      getValue: (fieldId: string, userData: Record<string, any>) => userData[fieldId],
      isRequired: field.is_required,
        field: field
    })),
    [props.entityType.fields]
  );

    // Prepare data for selected entity
  const comparisonData = useMemo(() => {
    if (!activeEntity) return {};
    
    const data: Record<string, Record<string, any>> = {};

      // For each user that has this entity, extract values
    activeEntity.instancesByUser.forEach((instanceId, userId) => {
      if (userId === props.currentUser.userId) {
        data[userId] = extractInstanceValuesForUser(props.myValues, instanceId);
      } else {
        const ext = props.otherExtractions.find(e => e.userId === userId);
        if (ext) {
          data[userId] = extractInstanceValuesForUser(ext.values, instanceId);
        }
      }
    });
    
    return data;
  }, [activeEntity, props.currentUser.userId, props.myValues, props.otherExtractions]);

    // Prepare user list (only those who have this entity)
  const usersWithEntity = useMemo<ComparisonUser[]>(() => {
    if (!activeEntity) return [];
    
    const users: ComparisonUser[] = [];
    
    activeEntity.instancesByUser.forEach((instanceId, userId) => {
      if (userId === props.currentUser.userId) {
        users.push(props.currentUser);
      } else {
        const ext = props.otherExtractions.find(e => e.userId === userId);
        if (ext) {
          users.push({
            userId: ext.userId,
            userName: ext.userName,
            userAvatar: ext.userAvatar,
            isCurrentUser: false
          });
        }
      }
    });
    
    return users;
  }, [activeEntity, props.currentUser, props.otherExtractions]);

    // Edit handler
  const handleValueChange = useCallback((fieldId: string, newValue: any) => {
    if (activeEntity && props.onValueUpdate) {
      const myInstanceId = activeEntity.instancesByUser.get(props.currentUser.userId);
      if (myInstanceId) {
        props.onValueUpdate(myInstanceId, fieldId, newValue);
      }
    }
  }, [activeEntity, props.currentUser.userId, props.onValueUpdate]);

    // Validations
  if (props.instances.length === 0) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
            {t('shared', 'youHaveNoInstancesOf').replace('{{entity}}', props.entityType.label)}
        </AlertDescription>
      </Alert>
    );
  }
  
  if (groupedEntities.length === 0) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
            {t('shared', 'noEntityFoundForComparison')}
        </AlertDescription>
      </Alert>
    );
  }
  
  return (
    <div className="space-y-4">
      {/* Card de Seletor */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-end gap-4">
            <div className="flex-1 space-y-2">
              <Label className="text-sm font-medium">
                  {t('shared', 'selectEntityToCompare').replace('{{entity}}', props.entityType.label.toLowerCase())}
              </Label>
              <Select 
                value={selectedEntityLabel || ''} 
                onValueChange={setSelectedEntityLabel}
              >
                <SelectTrigger>
                    <SelectValue
                        placeholder={t('shared', 'selectEntityPlaceholder').replace('{{entity}}', props.entityType.label.toLowerCase())}/>
                </SelectTrigger>
                <SelectContent>
                  {groupedEntities.map(entity => {
                    const userCount = entity.instancesByUser.size;
                    return (
                      <SelectItem key={entity.label} value={entity.label}>
                          {entity.label} ({userCount} {userCount !== 1 ? t('shared', 'users') : t('shared', 'user')})
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                  {groupedEntities.length} {groupedEntities.length !== 1 ? t('shared', 'entities') : t('shared', 'entity')} {t('shared', 'available')}
              </p>
            </div>
            
            {activeEntity && (
              <Badge variant="secondary" className="mb-1">
                  {activeEntity.instancesByUser.size} {activeEntity.instancesByUser.size !== 1 ? t('shared', 'reviewers') : t('shared', 'reviewer')}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

        {/* Comparison table */}
      {activeEntity && (
        <ComparisonTable
          columns={columns}
          rows={props.entityType.fields.map(f => f.id)}
          currentUser={props.currentUser}
          otherUsers={usersWithEntity.filter(u => !u.isCurrentUser)}
          data={comparisonData}
          showConsensus
          editable={props.editable}
          onValueChange={handleValueChange}
          maxHeight="600px"
        />
      )}
    </div>
  );
}
