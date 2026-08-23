/**
 * Hook to manage navigation state
 * Centralizes breadcrumbs, search and navigation logic
 */

import {useEffect, useState} from 'react';
import {useAuth} from '@/contexts/AuthContext';
import {t} from '@/lib/copy';
import type {UserProfile} from '@/types/navigation';
import {loadUserProfile as loadUserProfileSvc} from '@/services/projectSettingsService';



export const useUserProfile = () => {
    const {user: authUser} = useAuth();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadUserProfile = async () => {
    if (!authUser) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    setError(null);
    setIsLoading(true);
    const result = await loadUserProfileSvc(authUser.id);
    if (!result.ok) {
      console.error('Unexpected error loading profile:', result.error);
      setError(t('common', 'errors_loadProfileFailed'));
      setUser(null);
      setIsLoading(false);
      return;
    }
    const profile = result.data;
    if (!profile) {
      // Not found — fall back to auth metadata
      console.warn('Profile not found, using basic data');
      setUser({
        id: authUser.id,
        name: authUser.user_metadata?.full_name || 'User',
        email: authUser.email || '',
        initials: authUser.email?.charAt(0).toUpperCase() || 'U',
        role: 'Researcher',
      });
    } else {
      const initials = profile.full_name
        ? profile.full_name.split(' ').map((n: string) => n[0]).join('').toUpperCase()
        : authUser.email?.charAt(0).toUpperCase() || 'U';
      setUser({
        id: authUser.id,
        name: profile.full_name || 'User',
        email: authUser.email || '',
        avatar: profile.avatar_url || undefined,
        initials,
        role: 'Researcher',
        organization: 'Research Institute',
      });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    // Microtask so the loader's setState calls run in an async callback.
    queueMicrotask(() => void loadUserProfile());
  }, [loadUserProfile]);

  return {
    user,
    isLoading,
    error,
    refreshProfile: loadUserProfile,
  };
};
