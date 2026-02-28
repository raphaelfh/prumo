import {createContext, ReactNode, useContext, useEffect, useState} from "react";
import {Session, User} from "@supabase/supabase-js";
import {supabase} from "@/integrations/supabase/client";
import {IS_LOCAL_SUPABASE, SUPABASE_ENV, SUPABASE_EXPECTED_ISSUER, SUPABASE_STORAGE_KEY,} from "@/config/supabase-env";
import {useNavigate} from "react-router-dom";

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

  useEffect(() => {
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
          setSession(null);
          setUser(null);
          setLoading(false);
          return;
        }

        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
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
