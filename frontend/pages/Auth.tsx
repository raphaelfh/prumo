import {useState} from "react";
import {useNavigate} from "react-router-dom";
import {supabase} from "@/integrations/supabase/client";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {toast} from "sonner";
import {
    AlertCircle,
    BarChart3,
    BookOpen,
    CheckCircle2,
    ClipboardCheck,
    Eye,
    EyeOff,
    FileText,
    Loader2,
} from "lucide-react";

// ─── Error mapping ────────────────────────────────────────────────────────────

const AUTH_ERRORS: Record<string, string> = {
    "Invalid login credentials": "Email ou senha incorretos",
    "Email not confirmed": "Por favor, confirme seu email antes de entrar",
    "User already registered": "Este email já está cadastrado",
    "Password should be at least 6 characters": "A senha deve ter pelo menos 6 caracteres",
    "rate limited": "Muitas tentativas. Aguarde alguns minutos",
};

const mapAuthError = (msg: string): string => {
    const key = Object.keys(AUTH_ERRORS).find((k) =>
        msg.toLowerCase().includes(k.toLowerCase())
    );
    return key ? AUTH_ERRORS[key] : msg;
};

// ─── Password helpers ─────────────────────────────────────────────────────────

function validatePassword(password: string): string | null {
    if (password.length < 8) return "A senha deve ter no mínimo 8 caracteres";
    if (!/[A-Z]/.test(password)) return "A senha deve conter pelo menos uma letra maiúscula";
    if (!/[a-z]/.test(password)) return "A senha deve conter pelo menos uma letra minúscula";
    if (!/[0-9]/.test(password)) return "A senha deve conter pelo menos um número";
    return null;
}

function getPasswordStrength(password: string) {
    if (!password) return {strength: 0, label: "", color: ""};
    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;
    if (strength <= 2) return {strength, label: "Fraca", color: "bg-red-500"};
    if (strength <= 4) return {strength, label: "Média", color: "bg-yellow-500"};
    return {strength, label: "Forte", color: "bg-green-500"};
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FeatureItem({icon: Icon, title, desc}: { icon: React.ElementType; title: string; desc: string }) {
    return (
        <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
                <Icon className="h-5 w-5 text-white"/>
            </div>
            <div>
                <p className="text-sm font-semibold text-white">{title}</p>
                <p className="text-xs text-indigo-200">{desc}</p>
            </div>
        </div>
    );
}

function LeftPanel() {
    return (
        <div
            className="hidden md:flex md:w-1/2 flex-col justify-between bg-gradient-to-br from-indigo-900 via-slate-900 to-indigo-800 p-10">
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
                    <BookOpen className="h-5 w-5 text-white"/>
                </div>
                <span className="text-lg font-bold text-white">Review Hub</span>
            </div>

            <div className="space-y-8">
                <div>
                    <h1 className="text-3xl font-bold leading-tight text-white">
                        Revisões Sistemáticas<br/>com precisão e eficiência
                    </h1>
                    <p className="mt-3 text-indigo-200 text-sm leading-relaxed">
                        Gerencie suas revisões científicas do início ao fim, com ferramentas colaborativas e
                        rastreamento completo.
                    </p>
                </div>
                <div className="space-y-4">
                    <FeatureItem
                        icon={FileText}
                        title="Gestão de Artigos"
                        desc="Importe, organize e rastreie todos os artigos do seu protocolo"
                    />
                    <FeatureItem
                        icon={ClipboardCheck}
                        title="Avaliação de Qualidade"
                        desc="Aplique instrumentos padronizados como PROBAST e CHARMS"
                    />
                    <FeatureItem
                        icon={BarChart3}
                        title="Extração de Dados"
                        desc="Extraia e harmonize dados com rastreabilidade completa"
                    />
                </div>
            </div>

            <p className="text-xs text-indigo-300">
                © {new Date().getFullYear()} Review Hub · Todos os direitos reservados
            </p>
        </div>
    );
}

function PasswordStrengthBar({password}: { password: string }) {
    const {strength, label, color} = getPasswordStrength(password);
    if (!password) return null;
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Força da senha:</span>
                <span className={`font-medium ${
                    label === "Fraca" ? "text-red-500" : label === "Média" ? "text-yellow-500" : "text-green-500"
                }`}>{label}</span>
            </div>
            <div className="flex gap-1">
                {[...Array(6)].map((_, i) => (
                    <div
                        key={i}
                        className={`h-1 flex-1 rounded-full ${i < strength ? color : "bg-muted"}`}
                    />
                ))}
            </div>
        </div>
    );
}

function PasswordMatchIndicator({password, confirm}: { password: string; confirm: string }) {
    if (!confirm) return null;
    const match = password === confirm;
    return (
        <div className="flex items-center gap-1.5 text-xs">
            {match ? (
                <>
                    <CheckCircle2 className="h-3 w-3 text-green-500"/>
                    <span className="text-green-500">As senhas coincidem</span>
                </>
            ) : (
                <>
                    <AlertCircle className="h-3 w-3 text-red-500"/>
                    <span className="text-red-500">As senhas não coincidem</span>
                </>
            )}
        </div>
    );
}

// ─── LoginForm ────────────────────────────────────────────────────────────────

function LoginForm({
                       onForgotPassword,
                       onSwitchToRegister,
                   }: {
    onForgotPassword: () => void;
    onSwitchToRegister: () => void;
}) {
  const navigate = useNavigate();
    const [form, setForm] = useState({email: "", password: ""});
    const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
        setError(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password,
      });
      if (error) throw error;
      toast.success("Login realizado com sucesso!");
      navigate("/");
    } catch (err: any) {
        setError(mapAuthError(err.message || "Erro ao fazer login"));
    } finally {
      setLoading(false);
    }
  };

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
                <div
                    className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
                    <AlertCircle className="h-4 w-4 shrink-0"/>
                    {error}
                </div>
            )}

            <div className="space-y-1.5">
                <Label htmlFor="login-email">Email</Label>
                <Input
                    id="login-email"
                    type="email"
                    placeholder="seu@email.com"
                    value={form.email}
                    onChange={(e) => setForm({...form, email: e.target.value})}
                    required
                    autoComplete="email"
                />
            </div>

            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <Label htmlFor="login-password">Senha</Label>
                    <button
                        type="button"
                        onClick={onForgotPassword}
                        className="text-xs text-primary hover:underline"
                    >
                        Esqueceu sua senha?
                    </button>
                </div>
                <div className="relative">
                    <Input
                        id="login-password"
                        type={showPassword ? "text" : "password"}
                        value={form.password}
                        onChange={(e) => setForm({...form, password: e.target.value})}
                        required
                        autoComplete="current-password"
                        className="pr-10"
                    />
                    <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        tabIndex={-1}
                    >
                        {showPassword ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}
                    </button>
                </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                    <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
                        Entrando...
                    </>
                ) : (
                    "Entrar"
                )}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
                Não tem uma conta?{" "}
                <button
                    type="button"
                    onClick={onSwitchToRegister}
                    className="font-medium text-primary hover:underline"
                >
                    Criar conta
                </button>
            </p>
        </form>
    );
}

// ─── RegisterForm ─────────────────────────────────────────────────────────────

function RegisterForm({onSwitchToLogin}: { onSwitchToLogin: () => void }) {
    const [form, setForm] = useState({
        fullName: "",
        email: "",
        password: "",
        confirmPassword: "",
    });
    const [show, setShow] = useState({password: false, confirm: false});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [emailSent, setEmailSent] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
        setError(null);

        const pwError = validatePassword(form.password);
        if (pwError) {
            setError(pwError);
            return;
        }
        if (form.password !== form.confirmPassword) {
            setError("As senhas não coincidem");
            return;
        }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
        options: {
            data: {full_name: form.fullName},
          emailRedirectTo: `${window.location.origin}/`,
        },
      });
      if (error) throw error;
        setEmailSent(true);
    } catch (err: any) {
        setError(mapAuthError(err.message || "Erro ao criar conta"));
    } finally {
      setLoading(false);
    }
  };

    if (emailSent) {
        return (
            <div className="space-y-4 text-center">
                <div
                    className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
                    <CheckCircle2 className="h-7 w-7 text-green-600 dark:text-green-400"/>
                </div>
                <div>
                    <p className="font-semibold">Verifique seu email</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Enviamos um link de confirmação para <strong>{form.email}</strong>.
                        Clique no link para ativar sua conta.
                    </p>
                </div>
                <Button variant="outline" className="w-full" onClick={onSwitchToLogin}>
                    Voltar ao login
                </Button>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
                <div
                    className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
                    <AlertCircle className="h-4 w-4 shrink-0"/>
                    {error}
                </div>
            )}

            <div className="space-y-1.5">
                <Label htmlFor="reg-name">Nome Completo</Label>
                <Input
                    id="reg-name"
                    type="text"
                    placeholder="Seu nome"
                    value={form.fullName}
                    onChange={(e) => setForm({...form, fullName: e.target.value})}
                    required
                    autoComplete="name"
                />
            </div>

            <div className="space-y-1.5">
                <Label htmlFor="reg-email">Email</Label>
                <Input
                    id="reg-email"
                    type="email"
                    placeholder="seu@email.com"
                    value={form.email}
                    onChange={(e) => setForm({...form, email: e.target.value})}
                    required
                    autoComplete="email"
                />
            </div>

            <div className="space-y-1.5">
                <Label htmlFor="reg-password">Senha</Label>
                <div className="relative">
                    <Input
                        id="reg-password"
                        type={show.password ? "text" : "password"}
                        placeholder="Mínimo 8 caracteres"
                        value={form.password}
                        onChange={(e) => setForm({...form, password: e.target.value})}
                        required
                        autoComplete="new-password"
                        className="pr-10"
                    />
                    <button
                        type="button"
                        onClick={() => setShow((s) => ({...s, password: !s.password}))}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        tabIndex={-1}
                    >
                        {show.password ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}
                    </button>
                </div>
                <PasswordStrengthBar password={form.password}/>
            </div>

            <div className="space-y-1.5">
                <Label htmlFor="reg-confirm">Confirmar Senha</Label>
                <div className="relative">
                    <Input
                        id="reg-confirm"
                        type={show.confirm ? "text" : "password"}
                        placeholder="Repita a senha"
                        value={form.confirmPassword}
                        onChange={(e) => setForm({...form, confirmPassword: e.target.value})}
                        required
                        autoComplete="new-password"
                        className="pr-10"
                    />
                    <button
                        type="button"
                        onClick={() => setShow((s) => ({...s, confirm: !s.confirm}))}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        tabIndex={-1}
                    >
                        {show.confirm ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}
                    </button>
                </div>
                <PasswordMatchIndicator password={form.password} confirm={form.confirmPassword}/>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                    <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
                        Criando conta...
                    </>
                ) : (
                    "Criar Conta"
                )}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
                Já tem uma conta?{" "}
                <button
                    type="button"
                    onClick={onSwitchToLogin}
                    className="font-medium text-primary hover:underline"
                >
                    Entrar
                </button>
            </p>
        </form>
    );
}

// ─── ForgotPasswordForm ───────────────────────────────────────────────────────

function ForgotPasswordForm({onBack}: { onBack: () => void }) {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            const {error} = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/auth/reset-password`,
            });
            if (error) throw error;
            setSent(true);
        } catch (err: any) {
            setError(mapAuthError(err.message || "Erro ao enviar email"));
        } finally {
            setLoading(false);
        }
    };

    if (sent) {
        return (
            <div className="space-y-4 text-center">
                <div
                    className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
                    <CheckCircle2 className="h-7 w-7 text-green-600 dark:text-green-400"/>
                </div>
                <div>
                    <p className="font-semibold">Email enviado!</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Verifique sua caixa de entrada em <strong>{email}</strong> e clique
                        no link para redefinir sua senha.
                    </p>
                </div>
                <Button variant="outline" className="w-full" onClick={onBack}>
                    Voltar ao login
                </Button>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
                <div
                    className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
                    <AlertCircle className="h-4 w-4 shrink-0"/>
                    {error}
                </div>
            )}

            <p className="text-sm text-muted-foreground">
                Digite seu email e enviaremos um link para redefinir sua senha.
            </p>

            <div className="space-y-1.5">
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                    id="forgot-email"
                    type="email"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                    <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
                        Enviando...
                    </>
                ) : (
                    "Enviar link de recuperação"
                )}
            </Button>

            <button
                type="button"
                onClick={onBack}
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
            >
                ← Voltar ao login
            </button>
        </form>
    );
}

// ─── View state headings ──────────────────────────────────────────────────────

const VIEW_HEADINGS = {
    login: {title: "Bem-vindo de volta", subtitle: "Entre com sua conta para continuar"},
    register: {title: "Criar conta", subtitle: "Cadastre-se para começar a usar o Review Hub"},
    forgotPassword: {title: "Redefinir senha", subtitle: "Informe seu email para recuperar o acesso"},
} as const;

type ViewState = "login" | "register" | "forgotPassword";

// ─── Main component ───────────────────────────────────────────────────────────

export default function Auth() {
    const [view, setView] = useState<ViewState>("login");
    const {title, subtitle} = VIEW_HEADINGS[view];

    return (
        <div className="flex min-h-screen">
            <LeftPanel/>

            {/* Right panel */}
            <div className="flex w-full flex-col items-center justify-center bg-background p-6 md:w-1/2">
                {/* Mobile logo — only when left panel is hidden */}
                <div className="mb-8 flex items-center gap-3 md:hidden">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
                        <BookOpen className="h-5 w-5 text-primary-foreground"/>
                    </div>
                    <span className="text-lg font-bold">Review Hub</span>
                </div>

                <div className="w-full max-w-md">
                    <div className="mb-7">
                        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
                    </div>

                    {view === "login" && (
                        <LoginForm
                            onForgotPassword={() => setView("forgotPassword")}
                            onSwitchToRegister={() => setView("register")}
                        />
                    )}
                    {view === "register" && (
                        <RegisterForm onSwitchToLogin={() => setView("login")}/>
                    )}
                    {view === "forgotPassword" && (
                        <ForgotPasswordForm onBack={() => setView("login")}/>
                    )}
                </div>
            </div>
    </div>
  );
}
