/**
 * Single instance comparison
 *
 * For cardinality='one':
 * - Renders ComparisonTable with all fields
 * - Compares values from all users side by side
 */

import {useCallback, useMemo} from 'react';
import {type ComparisonColumn, ComparisonTable, type ComparisonUser} from './ComparisonTable';
import {extractInstanceValuesForUser} from '@/lib/comparison/grouping';
import type {ComparisonSectionViewProps} from './ComparisonSectionView';
import {t} from '@/lib/copy';

export function SingleInstanceComparison(props: ComparisonSectionViewProps) {
  const instance = props.instances[0];

    // IMPORTANT: All hooks must be called BEFORE any early return
    // Prepare columns (each field is a row)
  const columns = useMemo<ComparisonColumn[]>(() => 
    props.entityType.fields.map(field => ({
      id: field.id,
      label: field.label,
      getValue: (fieldId: string, userData: Record<string, any>) => userData[fieldId],
      isRequired: field.is_required,
        field: field // Pass field to column
    })),
    [props.entityType.fields]
  );

    // Prepare data (userId -> fieldId -> value)
  const comparisonData = useMemo(() => {
    if (!instance) return {};
    
    const data: Record<string, Record<string, any>> = {};
    
    // Meus valores
    data[props.currentUser.userId] = extractInstanceValuesForUser(
      props.myValues, 
      instance.id
    );

      // Other users' values
    props.otherExtractions.forEach(ext => {
        // Find corresponding instanceId (same section)
        // For cardinality='one', there is always only 1 instance per user
      data[ext.userId] = extractInstanceValuesForUser(
        ext.values,
        instance.id // Assumindo mesmo ID (pode precisar ajuste)
      );
    });
    
    return data;
  }, [props.currentUser.userId, props.myValues, props.otherExtractions, instance]);

    // Prepare list of other users
  const otherUsers = useMemo<ComparisonUser[]>(() => 
    props.otherExtractions.map(ext => ({
      userId: ext.userId,
      userName: ext.userName,
      userAvatar: ext.userAvatar,
      isCurrentUser: false
    })),
    [props.otherExtractions]
  );

    // Edit handler
  const handleValueChange = useCallback((fieldId: string, newValue: any) => {
    if (props.onValueUpdate && instance) {
      props.onValueUpdate(instance.id, fieldId, newValue);
    }
  }, [instance, props.onValueUpdate]);
  
  // Early return APÓS todos os hooks
  if (!instance) {
    return (
      <div className="text-center py-4 text-muted-foreground text-sm">
          {t('shared', 'noInstanceForSection')}
      </div>
    );
  }
  
  return (
    <ComparisonTable
      columns={columns}
      rows={props.entityType.fields.map(f => f.id)}
      currentUser={props.currentUser}
      otherUsers={otherUsers}
      data={comparisonData}
      showConsensus
      editable={props.editable}
      onValueChange={handleValueChange}
      maxHeight="600px"
    />
  );
}
