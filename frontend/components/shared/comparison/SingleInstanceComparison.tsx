/**
 * Single instance comparison
 *
 * For cardinality='one':
 * - Renders ComparisonTable with all fields
 * - Compares values from all users side by side
 */

import {type ComparisonColumn, ComparisonTable, type ComparisonUser} from './ComparisonTable';
import {extractInstanceValuesForUser} from '@/lib/comparison/grouping';
import type {ComparisonSectionViewProps} from './ComparisonSectionView';
import type {ExtractionField} from '@/types/extraction';
import {t} from '@/lib/copy';

export function SingleInstanceComparison(props: ComparisonSectionViewProps) {
    // Destructure all used props so manual memo dep lists reference locals
    // (the React Compiler infers `props` — less specific — from `props.x.y`
    // accesses, which prevents it from preserving the manual memoization).
  const {
    instances,
    entityType,
    currentUser,
    myValues,
    otherExtractions,
    onValueUpdate,
    editable,
  } = props;
  const currentUserId = currentUser.userId;
  const instance = instances[0];

    // IMPORTANT: All hooks must be called BEFORE any early return
    // Prepare columns (each field is a row)
  const columns: ComparisonColumn[] = entityType.fields.map((field: ExtractionField) => ({
    id: field.id,
    label: field.label,
    getValue: (fieldId: string, userData: Record<string, any>) => userData[fieldId],
    isRequired: field.is_required,
      field: field // Pass field to column
  }));

    // Prepare data (userId -> fieldId -> value)
  const comparisonData = (() => {
    if (!instance) return {};

    const data: Record<string, Record<string, any>> = {};

    // Meus valores
    data[currentUserId] = extractInstanceValuesForUser(
      myValues,
      instance.id
    );

      // Other users' values
    otherExtractions.forEach(ext => {
        // Find corresponding instanceId (same section)
        // For cardinality='one', there is always only 1 instance per user
      data[ext.userId] = extractInstanceValuesForUser(
        ext.values,
        instance.id // Assumindo mesmo ID (pode precisar ajuste)
      );
    });

    return data;
  })();

    // Prepare list of other users
  const otherUsers: ComparisonUser[] = otherExtractions.map(ext => ({
    userId: ext.userId,
    userName: ext.userName,
    userAvatar: ext.userAvatar,
    isCurrentUser: false,
  }));

    // Edit handler
  const handleValueChange = (fieldId: string, newValue: any) => {
    if (onValueUpdate && instance) {
      onValueUpdate(instance.id, fieldId, newValue);
    }
  };
  
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
      rows={entityType.fields.map((f: ExtractionField) => f.id)}
      currentUser={currentUser}
      otherUsers={otherUsers}
      data={comparisonData}
      showConsensus
      editable={editable}
      onValueChange={handleValueChange}
      maxHeight="600px"
    />
  );
}
