import {createContext, ReactNode, useContext, useEffect, useRef, useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {Session, User} from "@supabase/supabase-js";
import {supabase} from "@/integrations/supabase/client";
import {IS_LOCAL_SUPABASE, SUPABASE_ENV, SUPABASE_EXPECTED_ISSUER, SUPABASE_STORAGE_KEY,} from "@/config/supabase-env";
import {useNavigate} from "react-router";
import {RESET_PASSWORD_PATH} from "@/lib/routes";

const ALLOWED_ALGS = IS_LOCAL_SUPABASE
  ? new Set(["HS256", "RS256", "ES256"])
  : new Set(["RS256", "ES256"]);

const decodeBase64Url = (value: string): string => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
};

const parseJwt = (token: string) => {
  const [headerPart, payloadPart] = token.split(".");
  if (!headerPart || !payloadPart) {
    throw new Error("Invalid JWT structure");
  }
  const header = JSON.parse(decodeBase64Url(headerPart));
  const payload = JSON.parse(decodeBase64Url(payloadPart));
  return { header, payload };
};

type EnvCheckResult = {
  valid: boolean;
  header?: { alg?: string };
  payload?: { iss?: string };
  error?: unknown;
};

const validateSessionForEnv = (session: Session | null): EnvCheckResult => {
  if (!session?.access_token) {
    return { valid: true };
  }

  try {
    const { header, payload } = parseJwt(session.access_token);
    const algOk = typeof header?.alg === "string" && ALLOWED_ALGS.has(header.alg);
    const issuerOk = SUPABASE_EXPECTED_ISSUER
      ? payload?.iss === SUPABASE_EXPECTED_ISSUER
      : true;

    return { valid: algOk && issuerOk, header, payload };
  } catch (error) {
    return { valid: false, error };
  }
};

const clearStoredSession = () => {
  if (SUPABASE_STORAGE_KEY) {
    localStorage.removeItem(SUPABASE_STORAGE_KEY);
  }
};

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // The account the query cache currently holds data for; null while signed
  // out, which is also how the tab starts.
  const cachedIdentity = useRef<string | null>(null);

  useEffect(() => {
    /**
     * Drop the whole query cache whenever the identity behind it changes.
     *
     * One QueryClient is built at module scope (App.tsx) and lives for as
     * long as the tab is open, while sign-out is a client-side navigate()
     * that tears down no state. TanStack serves a cache hit synchronously
     * during render, and every query here carries a staleTime (5 min by
     * default), so the next account in the same tab paints the previous
     * account's rows and no refetch corrects them until that time is up.
     * Scoping a key by user id fixes one family; this fixes the cause.
     *
     * It runs inside the auth notification rather than in an effect that
     * watches `user`, because the clear has to land before React renders
     * anything under the new identity — an effect fires only after that
     * render has already read the cache.
     *
     * Adopting an account is not a change of account, so it must not clear:
     * getSession() and the listener report the same session from two paths,
     * and auth-js re-emits for the same user on every refresh, on
     * visibilitychange and on every broadcast from another tab. Clearing on
     * any of those would drop rows the signed-in user is still reading. A
     * tab that boots straight into a session does clear once, before
     * setUser, on a cache no observer has reached yet.
     */
    const adoptIdentity = (userId: string | null) => {
      const previous = cachedIdentity.current;
      cachedIdentity.current = userId;
      if (previous === userId) return;
      queryClient.clear();
    };

    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // Se a sessão é inválida (erro 403), limpar localStorage e fazer logout
        if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
          clearStoredSession();
        }

        const envCheck = validateSessionForEnv(session);
        if (!envCheck.valid) {
          console.warn("[Supabase] Session does not match environment", {
            supabaseEnv: SUPABASE_ENV,
            expectedIssuer: SUPABASE_EXPECTED_ISSUER,
            alg: envCheck.header?.alg,
            iss: envCheck.payload?.iss,
            event,
          });
          clearStoredSession();
          void supabase.auth.signOut();
          adoptIdentity(null);
          setSession(null);
          setUser(null);
          setLoading(false);
          return;
        }

        adoptIdentity(session?.user?.id ?? null);
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);

        // A recovery link must reach the password form even when GoTrue sent
        // the user elsewhere. GoTrue honours `redirect_to` only when it
        // matches the Redirect URLs allow list and silently falls back to the
        // Site URL otherwise, but the PKCE exchange still succeeds: auth-js
        // reads the recovery type from the verifier it stored locally, not
        // from the URL. Without this the user is signed in on whatever page
        // they landed on and never asked for a new password.
        if (event === "PASSWORD_RECOVERY") {
          navigate(RESET_PASSWORD_PATH, {replace: true});
        }
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      const envCheck = validateSessionForEnv(session);
      // Se houver erro ao obter sessão (ex: usuário não existe mais), limpar
      if (error || !session || !envCheck.valid) {
        if (!envCheck.valid) {
          console.warn("[Supabase] Session does not match environment", {
            supabaseEnv: SUPABASE_ENV,
            expectedIssuer: SUPABASE_EXPECTED_ISSUER,
            alg: envCheck.header?.alg,
            iss: envCheck.payload?.iss,
            event: "getSession",
          });
        }
        clearStoredSession();
        supabase.auth.signOut();
      }
      adoptIdentity(envCheck.valid ? session?.user?.id ?? null : null);
      setSession(envCheck.valid ? session : null);
      setUser(envCheck.valid ? session?.user ?? null : null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
