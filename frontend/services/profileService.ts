// frontend/services/profileService.ts
/**
 * Profile service — IO for the user profile settings section.
 *
 * Service-layer contract (zero-bailouts spec): exported functions never
 * throw across the boundary; they return ErrorResult<T>. Supabase calls
 * relocated verbatim from ProfileSection (no new reads).
 */
import {supabase} from '@/integrations/supabase/client';
import {logger} from '@/lib/logger';
import {normalizeError, toResult, type ErrorResult} from '@/lib/error-utils';

export interface ProfileData {
  email: string;
  avatarUrl: string;
  fullName: string;
}

/** Resolves to null when no user is signed in (caller decides messaging). */
export function fetchProfile(): Promise<ErrorResult<ProfileData | null>> {
  return toResult(async () => {
    const {data: {user}} = await supabase.auth.getUser();
    if (!user) return null;

    const {data: profileData, error} = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    // Non-fatal in the original handler: fall back to auth-user fields.
    if (error) logger.error('❌ [profileService.fetchProfile] Error:', normalizeError(error));

    return {
      email: user.email ?? '',
      avatarUrl: profileData?.avatar_url ?? '',
      fullName: profileData?.full_name ?? '',
    };
  }, 'profileService.fetchProfile');
}

/** Persists profile fields for the signed-in user. */
export function saveProfile(
  values: {fullName: string; avatarUrl: string},
): Promise<ErrorResult<void>> {
  return toResult(async () => {
    const {data: {user}} = await supabase.auth.getUser();
    // NOTE: thrown messages surface in the caller's toast via result.error.message —
    // keep them terse; user-facing copy belongs to the component's copy keys.
    if (!user) throw new Error('User not authenticated');

    const {error} = await supabase
      .from('profiles')
      .update({full_name: values.fullName, avatar_url: values.avatarUrl})
      .eq('id', user.id);
    if (error) throw error;
  }, 'profileService.saveProfile');
}
