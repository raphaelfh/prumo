/**
 * Hook unificado de permissões para comparação
 * 
 * Centraliza toda a lógica de permissões relacionadas a comparação
 * de extrações/assessments entre usuários.
 * 
 * Usado em:
 * - ExtractionFullScreen
 * - AssessmentFullScreen
 * 
 * Elimina duplicação de código e garante consistência.
 * 
 * @hook
 */

import {useCallback, useEffect, useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {getRolePermissions, isValidUserRole, type PermissionRules, type UserRole} from '@/lib/comparison/permissions';

/**
 * Estado completo de permissões
 */
export interface ComparisonPermissions extends PermissionRules {
  userRole: UserRole;
  isBlindMode: boolean;
  loading: boolean;
  error: string | null;
}

/**
 * Hook para carregar e gerenciar permissões de comparação
 * 
 * Faz 2 queries otimizadas:
 * 1. Buscar role do membro no projeto
 * 2. Buscar configuração de blind_mode
 * 
 * @param projectId - ID do projeto
 * @param userId - ID do usuário
 * @returns Permissões completas com estado de loading
 * 
 * @example
 * const permissions = useComparisonPermissions(projectId, userId);
 * 
 * if (permissions.loading) return <Loader />;
 * if (!permissions.canSeeOthers) return null;
 * 
 * return <ComparisonView ... />;
 */
export function useComparisonPermissions(
  projectId: string,
  userId: string
): ComparisonPermissions {
  const [permissions, setPermissions] = useState<ComparisonPermissions>({
    userRole: 'reviewer',
    isBlindMode: false,
    canSeeOthers: false,
    canResolveConflicts: false,
    canManageBlindMode: false,
    canExport: false,
    canEditTemplate: false,
    loading: true,
    error: null
  });

  const loadPermissions = useCallback(async () => {
    try {
      setPermissions(prev => ({ ...prev, loading: true, error: null }));

      // Query 1: Buscar role do membro
      const { data: member, error: memberError } = await supabase
        .from('project_members')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .single();

      if (memberError) throw memberError;

      if (!member) {
        throw new Error('Usuário não é membro do projeto');
      }

      // Query 2: Buscar configuração do projeto
      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('settings')
        .eq('id', projectId)
        .single();

      if (projectError) throw projectError;

      // Validar role
      const role = member.role;
      if (!isValidUserRole(role)) {
        throw new Error(`Role inválido: ${role}`);
      }

      // Extrair blind_mode (com fallback seguro)
      const isBlindMode = project?.settings?.blind_mode === true;

      // Calcular permissões usando regras centralizadas
      const rolePermissions = getRolePermissions(role, isBlindMode);

      setPermissions({
        userRole: role,
        isBlindMode,
        ...rolePermissions,
        loading: false,
        error: null
      });

    } catch (err: any) {
      console.error('❌ Erro ao carregar permissões de comparação:', err);
      
      // Estado de erro: assume permissões mínimas (seguro)
      setPermissions({
        userRole: 'reviewer',
        isBlindMode: true, // Assumir blind mode em caso de erro (mais seguro)
        canSeeOthers: false,
        canResolveConflicts: false,
        canManageBlindMode: false,
        canExport: false,
        canEditTemplate: false,
        loading: false,
        error: err.message || 'Erro ao carregar permissões'
      });
    }
  }, [projectId, userId]);

  useEffect(() => {
    if (!projectId || !userId) {
      setPermissions(prev => ({ ...prev, loading: false }));
      return;
    }

    loadPermissions();
  }, [projectId, userId, loadPermissions]);

  // Retornar função de refresh para recarregar permissões
  return {
    ...permissions,
    refresh: loadPermissions
  } as ComparisonPermissions & { refresh: () => Promise<void> };
}

