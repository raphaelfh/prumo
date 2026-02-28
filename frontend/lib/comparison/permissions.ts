/**
 * Regras de permissão para comparação
 * 
 * Centraliza todas as regras de permissão relacionadas a comparação
 * de extrações/assessments entre usuários.
 * 
 * Garante consistência entre Assessment e Extraction.
 * 
 * @module comparison/permissions
 */

/**
 * Roles disponíveis para membros de projeto
 * Baseado no enum project_member_role do banco
 */
export type UserRole = 'manager' | 'reviewer' | 'viewer' | 'consensus';

/**
 * Conjunto completo de permissões de um usuário
 */
export interface PermissionRules {
  canSeeOthers: boolean;         // Ver extrações/assessments de outros
  canResolveConflicts: boolean;  // Resolver divergências e criar consenso
  canManageBlindMode: boolean;   // Ativar/desativar blind mode
  canExport: boolean;            // Exportar dados e relatórios
  canEditTemplate: boolean;      // Editar template de extração
}

/**
 * Determina se usuário pode ver extrações/assessments de outros
 * 
 * Regras de negócio:
 * 1. Se blind_mode = ON → Ninguém vê outros (nem manager)
 *    Rationale: Blind mode força independência total
 * 
 * 2. Se blind_mode = OFF → Apenas manager e consensus veem
 *    Rationale: Manager coordena, consensus resolve conflitos
 * 
 * 3. Reviewers e viewers NUNCA veem (mesmo sem blind mode)
 *    Rationale: Evita viés de confirmação
 * 
 * @param role - Role do usuário no projeto
 * @param isBlindMode - Se blind mode está ativo
 * @returns true se pode ver outros
 */
export function canUserSeeOthers(
  role: UserRole,
  isBlindMode: boolean
): boolean {
  // Blind mode bloqueia todos (regra 1)
  if (isBlindMode) return false;
  
  // Apenas manager e consensus (regra 2 e 3)
  return role === 'manager' || role === 'consensus';
}

/**
 * Retorna todas as permissões baseadas no role
 * 
 * Matriz de permissões completa:
 * 
 * | Permissão           | Manager | Consensus | Reviewer | Viewer |
 * |---------------------|---------|-----------|----------|--------|
 * | canSeeOthers        | Sim*    | Sim*      | Não      | Não    |
 * | canResolveConflicts | Sim     | Sim       | Não      | Não    |
 * | canManageBlindMode  | Sim     | Não       | Não      | Não    |
 * | canExport           | Sim     | Sim       | Não      | Não    |
 * | canEditTemplate     | Sim     | Não       | Não      | Não    |
 * 
 * * Somente se blind_mode = OFF
 * 
 * @param role - Role do usuário
 * @param isBlindMode - Estado do blind mode
 * @returns Objeto com todas as permissões
 */
export function getRolePermissions(
  role: UserRole,
  isBlindMode: boolean
): PermissionRules {
  const basePermissions: Record<UserRole, PermissionRules> = {
    manager: {
      canSeeOthers: !isBlindMode,
      canResolveConflicts: true,
      canManageBlindMode: true,
      canExport: true,
      canEditTemplate: true
    },
    consensus: {
      canSeeOthers: !isBlindMode,
      canResolveConflicts: true,
      canManageBlindMode: false,
      canExport: true,
      canEditTemplate: false
    },
    reviewer: {
      canSeeOthers: false,  // Nunca vê outros (evita viés)
      canResolveConflicts: false,
      canManageBlindMode: false,
      canExport: false,
      canEditTemplate: false
    },
    viewer: {
      canSeeOthers: false,
      canResolveConflicts: false,
      canManageBlindMode: false,
      canExport: false,
      canEditTemplate: false
    }
  };

  return basePermissions[role];
}

/**
 * Valida se role é válido
 * Type guard para runtime validation
 * 
 * @param role - String a ser validada
 * @returns true se é UserRole válido
 */
export function isValidUserRole(role: string): role is UserRole {
  return ['manager', 'reviewer', 'viewer', 'consensus'].includes(role);
}

/**
 * Retorna label legível para role
 * 
 * @param role - Role do usuário
 * @returns Label em português com emoji
 */
export function getRoleLabel(role: UserRole): string {
  const labels: Record<UserRole, string> = {
    manager: '👑 Gerente',
    consensus: '⚖️ Consenso',
    reviewer: '✍️ Revisor',
    viewer: '👁️ Visualizador'
  };
  return labels[role];
}

