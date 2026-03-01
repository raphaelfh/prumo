import {useEffect, useState} from "react";
import {useNavigate} from "react-router-dom";
import {supabase} from "@/integrations/supabase/client";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {AlertCircle, BookOpen, CheckCircle2, Eye, EyeOff, Loader2,} from "lucide-react";

// ─── Password helpers (mirrored from SecuritySection) ─────────────────────────

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

// ─── Main component ───────────────────────────────────────────────────────────

export default function ResetPassword() {
    const navigate = useNavigate();
    const [sessionReady, setSessionReady] = useState(false);
    const [sessionError, setSessionError] = useState(false);
    const [form, setForm] = useState({newPassword: "", confirmPassword: ""});
    const [show, setShow] = useState({newPassword: false, confirmPassword: false});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        const hasRecoveryParams =
            window.location.hash.includes("type=recovery") ||
            window.location.hash.includes("access_token");

        if (!hasRecoveryParams) {
            setSessionError(true);
            return;
        }

        const {
            data: {subscription},
        } = supabase.auth.onAuthStateChange((event, session) => {
            if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
                setSessionReady(true);
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    useEffect(() => {
        if (success) {
            const timer = setTimeout(() => navigate("/"), 2000);
            return () => clearTimeout(timer);
        }
    }, [success, navigate]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        const pwError = validatePassword(form.newPassword);
        if (pwError) {
            setError(pwError);
            return;
        }
        if (form.newPassword !== form.confirmPassword) {
            setError("As senhas não coincidem");
            return;
        }

        setLoading(true);
        try {
            const {error} = await supabase.auth.updateUser({password: form.newPassword});
            if (error) throw error;
            setSuccess(true);
        } catch (err: any) {
            setError(err.message || "Erro ao redefinir senha");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
            <div className="w-full max-w-md space-y-8">
                {/* Logo */}
                <div className="flex flex-col items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
                        <BookOpen className="h-6 w-6 text-primary-foreground"/>
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight">Review Hub</h1>
                </div>

                {/* Loading */}
                {!sessionReady && !sessionError && (
                    <div className="flex flex-col items-center gap-3 text-center">
                        <Loader2 className="h-8 w-8 animate-spin text-primary"/>
                        <p className="text-sm text-muted-foreground">Verificando link...</p>
                    </div>
                )}

                {/* Session error */}
                {sessionError && !sessionReady && (
                    <div className="space-y-5 text-center">
                        <div
                            className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900">
                            <AlertCircle className="h-7 w-7 text-red-600 dark:text-red-400"/>
                        </div>
                        <div>
                            <p className="font-semibold">Link inválido ou expirado</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Este link de recuperação não é válido ou já foi utilizado. Solicite um novo link.
                            </p>
                        </div>
                        <Button className="w-full" onClick={() => navigate("/auth")}>
                            Voltar ao login
                        </Button>
                    </div>
                )}

                {/* Success */}
                {success && (
                    <div className="space-y-5 text-center">
                        <div
                            className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
                            <CheckCircle2 className="h-7 w-7 text-green-600 dark:text-green-400"/>
                        </div>
                        <div>
                            <p className="font-semibold">Senha redefinida!</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Sua senha foi alterada com sucesso. Redirecionando...
                            </p>
                        </div>
                        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground"/>
                    </div>
                )}

                {/* Form */}
                {sessionReady && !success && (
                    <div className="space-y-2">
                        <div className="mb-6">
                            <h2 className="text-xl font-bold">Criar nova senha</h2>
                            <p className="text-sm text-muted-foreground mt-1">
                                Escolha uma senha forte para proteger sua conta.
                            </p>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            {error && (
                                <div
                                    className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
                                    <AlertCircle className="h-4 w-4 shrink-0"/>
                                    {error}
                                </div>
                            )}

                            <div className="space-y-1.5">
                                <Label htmlFor="new-password">Nova Senha</Label>
                                <div className="relative">
                                    <Input
                                        id="new-password"
                                        type={show.newPassword ? "text" : "password"}
                                        placeholder="Mínimo 8 caracteres"
                                        value={form.newPassword}
                                        onChange={(e) => setForm({...form, newPassword: e.target.value})}
                                        required
                                        autoComplete="new-password"
                                        className="pr-10"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShow((s) => ({...s, newPassword: !s.newPassword}))}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        tabIndex={-1}
                                    >
                                        {show.newPassword ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}
                                    </button>
                                </div>
                                <PasswordStrengthBar password={form.newPassword}/>
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="confirm-password">Confirmar Senha</Label>
                                <div className="relative">
                                    <Input
                                        id="confirm-password"
                                        type={show.confirmPassword ? "text" : "password"}
                                        placeholder="Repita a senha"
                                        value={form.confirmPassword}
                                        onChange={(e) => setForm({...form, confirmPassword: e.target.value})}
                                        required
                                        autoComplete="new-password"
                                        className="pr-10"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShow((s) => ({...s, confirmPassword: !s.confirmPassword}))}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        tabIndex={-1}
                                    >
                                        {show.confirmPassword ? <EyeOff className="h-4 w-4"/> :
                                            <Eye className="h-4 w-4"/>}
                                    </button>
                                </div>
                                <PasswordMatchIndicator password={form.newPassword} confirm={form.confirmPassword}/>
                            </div>

                            <Button type="submit" className="w-full" disabled={loading}>
                                {loading ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
                                        Redefinindo...
                                    </>
                                ) : (
                                    "Redefinir senha"
                                )}
                            </Button>
                        </form>
                    </div>
                )}
            </div>
        </div>
    );
}
