/**
 * Hook to manage entity and instance hierarchy
 *
 * Builds hierarchical tree of entity_types and their instances,
 * supporting recursive parent-child relationships.
 *
 * Returns:
 * - tree: Hierarchical tree for recursive rendering
 * - flatMap: Map for fast instance lookup by ID
 * - parentMap: Map of instance_id → parent_instance_id
 * - childrenMap: Map of parent_id → children[]
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  ExtractionEntityType,
  ExtractionInstance,
  EntityNode,
  ExtractionHierarchyContext
} from '@/types/extraction';

interface UseEntityHierarchyReturn extends ExtractionHierarchyContext {
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getChildren: (instanceId: string) => ExtractionInstance[];
  getParent: (instanceId: string) => ExtractionInstance | undefined;
}

export function useEntityHierarchy(
  projectId: string,
  templateId: string,
  articleId: string
): UseEntityHierarchyReturn {
  const [tree, setTree] = useState<EntityNode[]>([]);
  const [flatMap, setFlatMap] = useState<Map<string, ExtractionInstance>>(new Map());
  const [parentMap, setParentMap] = useState<Map<string, string>>(new Map());
  const [childrenMap, setChildrenMap] = useState<Map<string, ExtractionInstance[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (projectId && templateId && articleId) {
      loadHierarchy();
    }
  }, [projectId, templateId, articleId]);

  const loadHierarchy = async () => {
    try {
      setLoading(true);
      setError(null);

        // 1. Load entity_types with hierarchy
      const { data: entityTypes, error: etError } = await supabase
        .from('extraction_entity_types')
        .select('*')
        .eq('project_template_id', templateId)
        .order('sort_order');

      if (etError) throw etError;

        // 2. Load all article instances
      const { data: instances, error: instancesError } = await supabase
        .from('extraction_instances')
        .select('*')
        .eq('article_id', articleId)
        .order('sort_order');

      if (instancesError) throw instancesError;

        // 3. Build maps
      const newFlatMap = new Map<string, ExtractionInstance>();
      const newParentMap = new Map<string, string>();
      const newChildrenMap = new Map<string, ExtractionInstance[]>();

      (instances || []).forEach(instance => {
        const inst = instance as ExtractionInstance;
        newFlatMap.set(inst.id, inst);
        
        if (inst.parent_instance_id) {
          newParentMap.set(inst.id, inst.parent_instance_id);
          
          if (!newChildrenMap.has(inst.parent_instance_id)) {
            newChildrenMap.set(inst.parent_instance_id, []);
          }
          newChildrenMap.get(inst.parent_instance_id)!.push(inst);
        }
      });

        // 4. Build tree
      const treeNodes = buildTree(
        entityTypes as ExtractionEntityType[],
        instances as ExtractionInstance[],
        null
      );

      setTree(treeNodes);
      setFlatMap(newFlatMap);
      setParentMap(newParentMap);
      setChildrenMap(newChildrenMap);

    } catch (err: any) {
      console.error('Error loading entity hierarchy:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Builds recursive tree of entity_types and instances
   */
  const buildTree = (
    entityTypes: ExtractionEntityType[],
    instances: ExtractionInstance[],
    parentEntityTypeId: string | null
  ): EntityNode[] => {
      // Fetch child entity_types of this parent
    const childTypes = entityTypes.filter(
      et => et.parent_entity_type_id === parentEntityTypeId
    );

    return childTypes.map(entityType => {
        // Fetch instances of this entity_type (top-level or correct parent)
      const typeInstances = instances.filter(
        i => i.entity_type_id === entityType.id
      );

        // Recursion: For entity_types that are children, we need to
        // build nodes for each parent instance
      let children: EntityNode[] = [];

        // Fetch entity_types that are children of this one
      const childEntityTypes = entityTypes.filter(
        et => et.parent_entity_type_id === entityType.id
      );

      if (childEntityTypes.length > 0 && typeInstances.length > 0) {
        // Para cada instance parent, construir children
        children = typeInstances.flatMap(parentInstance => 
          childEntityTypes.map(childType => ({
            entityType: childType,
            instances: instances.filter(
              i => i.entity_type_id === childType.id 
                && i.parent_instance_id === parentInstance.id
            ),
              children: [] // For simplicity we do not support 3+ levels yet
          }))
        );
      }

      return {
        entityType,
        instances: typeInstances,
        children
      };
    });
  };

  const getChildren = useCallback((instanceId: string): ExtractionInstance[] => {
    return childrenMap.get(instanceId) || [];
  }, [childrenMap]);

  const getParent = useCallback((instanceId: string): ExtractionInstance | undefined => {
    const parentId = parentMap.get(instanceId);
    return parentId ? flatMap.get(parentId) : undefined;
  }, [parentMap, flatMap]);

  const refresh = useCallback(() => {
    return loadHierarchy();
  }, [projectId, templateId, articleId]);

  return {
    tree,
    flatMap,
    parentMap,
    childrenMap,
    loading,
    error,
    refresh,
    getChildren,
    getParent
  };
}


