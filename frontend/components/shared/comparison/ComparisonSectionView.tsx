/**
 * Section comparison view
 *
 * Chooses strategy based on cardinality and renders:
 * - cardinality='one': SingleInstanceComparison
 * - cardinality='many': EntitySelectorComparison
 */

import {getComparisonStrategy} from '@/lib/comparison/orchestration';
import {SingleInstanceComparison} from './SingleInstanceComparison';
import {EntitySelectorComparison} from './EntitySelectorComparison';
import type {ExtractionEntityType, ExtractionInstance} from '@/types/extraction';
import type {OtherExtraction} from '@/hooks/extraction/colaboracao/useOtherExtractions';
import type {ComparisonUser} from './ComparisonTable';
import type {InstanceWithCreator} from '@/lib/comparison/grouping';

export interface ComparisonSectionViewProps {
  entityType: ExtractionEntityType;
    instances: ExtractionInstance[]; // My instances
  myValues: Record<string, any>;
  otherExtractions: OtherExtraction[];
    allUserInstances: InstanceWithCreator[]; // Instances from all users in DB
  currentUser: ComparisonUser;
  onValueUpdate?: (instanceId: string, fieldId: string, value: any) => void;
  editable?: boolean;
}

export function ComparisonSectionView(props: ComparisonSectionViewProps) {
  const strategy = getComparisonStrategy(props.entityType);
  
  if (strategy.type === 'entity-selector') {
    return <EntitySelectorComparison {...props} />;
  }
  
  return <SingleInstanceComparison {...props} />;
}
