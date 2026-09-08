import {Fragment} from "react";
import {Navigate} from "react-router";
import {useAuth} from "@/contexts/AuthContext";
import {t} from "@/lib/copy";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4"></div>
            <p className="text-muted-foreground">{t('common', 'loading')}</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // The account is part of the subtree's identity, so a change of account
  // retires it. A mounted TanStack observer serves its own last result and
  // is never told its query left the cache, so emptying the cache alone does
  // not reach one: a sign-in for a different user with no sign-out in
  // between would leave the previous account's rows on screen for as long as
  // the tab stayed open. That is not exotic — auth-js opens a
  // BroadcastChannel on the storage key, so a second tab signing in relays
  // SIGNED_IN straight into this one, and `_recoverAndRefresh()` on
  // visibilitychange does the same. Remounting here retires those observers;
  // AuthContext empties the cache so the fresh ones cannot re-read it.
  return <Fragment key={user.id}>{children}</Fragment>;
}
