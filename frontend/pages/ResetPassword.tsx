import {useEffect, useState} from "react";
import {useNavigate} from "react-router-dom";
import {supabase} from "@/integrations/supabase/client";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {t} from "@/lib/copy";
import {AlertCircle, BookOpen, CheckCircle2, Eye, EyeOff, Loader2,} from "lucide-react";

// ─── Password helpers (shared with Auth, use auth copy) ───────────────────────

function validatePassword(password: string): string | null {
    if (password.length < 8) return t("auth", "passwordMinLength");
    if (!/[A-Z]/.test(password)) return t("auth", "passwordUppercase");
    if (!/[a-z]/.test(password)) return t("auth", "passwordLowercase");
    if (!/[0-9]/.test(password)) return t("auth", "passwordNumber");
    return null;
}

type StrengthKey = "strengthWeak" | "strengthMedium" | "strengthStrong";

function getPasswordStrength(password: string): { strength: number; labelKey: StrengthKey; color: string } {
    if (!password) return {strength: 0, labelKey: "strengthWeak", color: ""};
    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;
    if (strength <= 2) return {strength, labelKey: "strengthWeak", color: "bg-red-500"};
    if (strength <= 4) return {strength, labelKey: "strengthMedium", color: "bg-yellow-500"};
    return {strength, labelKey: "strengthStrong", color: "bg-green-500"};
}

function PasswordStrengthBar({password}: { password: string }) {
    const {strength, labelKey, color} = getPasswordStrength(password);
    if (!password) return null;
    const label = t("auth", labelKey);
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t("auth", "passwordStrengthLabel")}</span>
                <span className={`font-medium ${
                    labelKey === "strengthWeak" ? "text-red-500" : labelKey === "strengthMedium" ? "text-yellow-500" : "text-green-500"
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
                    <span className="text-green-500">{t("auth", "passwordsMatch")}</span>
                </>
            ) : (
                <>
                    <AlertCircle className="h-3 w-3 text-red-500"/>
                    <span className="text-red-500">{t("auth", "passwordsDoNotMatch")}</span>
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
        let settled = false;

        const settle = (ready: boolean) => {
            if (!settled) {
                settled = true;
                ready ? setSessionReady(true) : setSessionError(true);
            }
        };

        // 1. Subscribe FIRST so we don't miss events fired during code exchange
        const {
            data: {subscription},
        } = supabase.auth.onAuthStateChange((event, session) => {
            if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
                settle(true);
            }
        });

        // 2. Detect recovery URL — PKCE uses ?code=, implicit flow uses #access_token
        const hasCode = new URLSearchParams(window.location.search).has("code");
        const hasHash =
            window.location.hash.includes("type=recovery") ||
            window.location.hash.includes("access_token");
        const hasRecoveryUrl = hasCode || hasHash;

        // 3. Check for an existing session (PKCE may have exchanged the code before mount)
        supabase.auth.getSession().then(({data: {session}}) => {
            if (session) {
                settle(true);
            } else if (!hasRecoveryUrl) {
                // No recovery params and no session → show error immediately
                settle(false);
            }
            // hasRecoveryUrl but no session yet → wait for onAuthStateChange
        });

        // 4. Safety timeout in case PKCE exchange takes too long or fails silently
        let timeout: ReturnType<typeof setTimeout> | undefined;
        if (hasRecoveryUrl) {
            timeout = setTimeout(() => settle(false), 10_000);
        }

        return () => {
            subscription.unsubscribe();
            if (timeout) clearTimeout(timeout);
        };
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
            setError(t("auth", "passwordsDoNotMatch"));
            return;
        }

        setLoading(true);
        try {
            const {error} = await supabase.auth.updateUser({password: form.newPassword});
            if (error) throw error;
            setSuccess(true);
        } catch (err: any) {
            setError(err.message || t("auth", "errorResetPassword"));
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
                        <p className="text-sm text-muted-foreground">{t("auth", "checkingLink")}</p>
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
                            <p className="font-semibold">{t("auth", "invalidLinkTitle")}</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {t("auth", "invalidLinkDesc")}
                            </p>
                        </div>
                        <Button className="w-full" onClick={() => navigate("/auth")}>
                            {t("auth", "backToLogin")}
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
                            <p className="font-semibold">{t("auth", "passwordResetSuccessTitle")}</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {t("auth", "passwordResetSuccessDesc")}
                            </p>
                        </div>
                        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground"/>
                    </div>
                )}

                {/* Form */}
                {sessionReady && !success && (
                    <div className="space-y-2">
                        <div className="mb-6">
                            <h2 className="text-xl font-bold">{t("auth", "newPasswordTitle")}</h2>
                            <p className="text-sm text-muted-foreground mt-1">
                                {t("auth", "newPasswordDesc")}
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
                                <Label htmlFor="new-password">{t("auth", "newPasswordLabel")}</Label>
                                <div className="relative">
                                    <Input
                                        id="new-password"
                                        type={show.newPassword ? "text" : "password"}
                                        placeholder={t("auth", "passwordPlaceholder")}
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
                                <Label htmlFor="confirm-password">{t("auth", "confirmPassword")}</Label>
                                <div className="relative">
                                    <Input
                                        id="confirm-password"
                                        type={show.confirmPassword ? "text" : "password"}
                                        placeholder={t("auth", "confirmPasswordPlaceholder")}
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
                                        {t("auth", "resetting")}
                                    </>
                                ) : (
                                    t("auth", "resetPasswordButton")
                                )}
                            </Button>
                        </form>
                    </div>
                )}
            </div>
        </div>
    );
}
