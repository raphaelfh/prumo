import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export function useCurrentUser() {
  const { user, loading } = useAuth();

  const requireUser = useCallback(() => {
    if (!user) {
      throw new Error('Usuário não autenticado');
    }
    return user;
  }, [user]);

  return {
    user,
    userId: user?.id ?? null,
    loading,
    requireUser,
  };
}
