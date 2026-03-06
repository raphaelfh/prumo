/**
 * Extraction comparison view
 * 
 * Renderiza seções no modo comparação usando ComparisonSectionView.
 * Cada seção decide automaticamente sua estratégia (simple vs entity-selector).
 */

import {t} from '@/lib/copy';
import type {ComparisonUser} from '@/components/shared/comparison';
import {ComparisonSectionView} from '@/components/shared/comparison';
import {Separator} from '@/components/ui/separator';
import {useAllUserInstances} from '@/hooks/extraction/colaboracao/useAllUserInstances';
import type {ExtractionEntityType, ExtractionInstance} from '@/types/extraction';
import type {OtherExtraction} from '@/hooks/extraction/colaboracao/useOtherExtractions';

export interface ExtractionCompareViewProps {
  studyLevelSections: ExtractionEntityType[];
  modelParentEntityType: ExtractionEntityType | undefined;
  modelChildSections: ExtractionEntityType[];
  instances: ExtractionInstance[];
  values: Record<string, any>;
  updateValue: (instanceId: string, fieldId: string, value: any) => void;
  otherExtractions: OtherExtraction[];
  currentUser: ComparisonUser;
  editable: boolean;
}

export function ExtractionCompareView(props: ExtractionCompareViewProps) {
    // Fetch instances for ALL users
  const { instances: allUserInstances, loading: instancesLoading } = useAllUserInstances({
    articleId: props.instances[0]?.article_id || '',
    enabled: props.instances.length > 0
  });

  if (instancesLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-muted-foreground">{t('extraction', 'loadingComparison')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Study-level sections */}
      {props.studyLevelSections.map(entityType => {
        const typeInstances = props.instances.filter(
          i => i.entity_type_id === entityType.id
        );
        
        return (
          <div key={entityType.id} className="space-y-3">
            <h3 className="text-lg font-semibold">{entityType.label}</h3>
            
            <ComparisonSectionView
              entityType={entityType}
              instances={typeInstances}
              myValues={props.values}
              otherExtractions={props.otherExtractions}
              allUserInstances={allUserInstances} // Instances from all users
              currentUser={props.currentUser}
              onValueUpdate={props.updateValue}
              editable={props.editable}
            />
          </div>
        );
      })}
      
      {/* Model sections */}
      {props.modelParentEntityType && (
        <>
          <Separator />
          
          {/* Model parent (prediction_models) */}
          <div className="space-y-3">
            <h3 className="text-lg font-semibold">{props.modelParentEntityType.label}</h3>
            
            <ComparisonSectionView
              entityType={props.modelParentEntityType}
              instances={props.instances.filter(
                i => i.entity_type_id === props.modelParentEntityType!.id
              )}
              myValues={props.values}
              otherExtractions={props.otherExtractions}
              allUserInstances={allUserInstances} // Instances from all users
              currentUser={props.currentUser}
              onValueUpdate={props.updateValue}
              editable={props.editable}
            />
          </div>
          
          {/* Model child sections */}
          {props.modelChildSections.map(childType => {
            const childInstances = props.instances.filter(
              i => i.entity_type_id === childType.id
            );
            
            return (
              <div key={childType.id} className="space-y-3">
                <h3 className="text-lg font-semibold">{childType.label}</h3>
                
                <ComparisonSectionView
                  entityType={childType}
                  instances={childInstances}
                  myValues={props.values}
                  otherExtractions={props.otherExtractions}
                  allUserInstances={allUserInstances} // Instances from all users
                  currentUser={props.currentUser}
                  onValueUpdate={props.updateValue}
                  editable={props.editable}
                />
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
