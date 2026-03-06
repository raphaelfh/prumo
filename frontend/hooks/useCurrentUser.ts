import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {t} from '@/lib/copy';

export function useCurrentUser() {
  const { user, loading } = useAuth();

  const requireUser = useCallback(() => {
    if (!user) {
        throw new Error(t('common', 'errors_userNotAuthenticated'));
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
