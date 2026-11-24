import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  AtSign,
  BookOpen,
  Camera,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  Moon,
  Phone,
  ShieldCheck,
  Sparkles,
  Sun,
  User,
  Volume2,
  VolumeX,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Logo } from "@/components/Logo";
import { ReadingActions } from "@/components/ReadingActions";
import { TripleTapExit } from "@/components/TripleTapExit";
import { WaterGlowButton } from "@/components/WaterGlowButton";
import {
  AccountChoiceRequiredError,
  confirmEmailPasswordReset,
  initialsOf,
  loginAccount,
  registerAccount,
  resetPasswordWithOtp,
  sendOtp,
  sendPasswordReset,
  setSoundEnabled,
  signInWithGoogle,
  useChat,
  type AccountChoiceOption,
  type LoginMode,
} from "@/lib/chat-store";
import { resolveWaterButtonVariant, type SecretThemeId } from "@/lib/secret-themes";
import { dedupeUsersById } from "@/lib/social-logic";
import { cn } from "@/lib/utils";
import { playWaterSound } from "@/lib/water-sound";

export const Route = createFileRoute("/auth")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { next?: string; mode?: "login" | "register" | "forgot" } => ({
    ...(typeof search["next"] === "string" ? { next: search["next"] } : {}),
    ...(search["mode"] === "login" || search["mode"] === "register" || search["mode"] === "forgot"
      ? { mode: search["mode"] }
      : {}),
  }),
  head: () => ({
    meta: [
      { title: "Sign in — Reading Corner" },
      {
        name: "description",
        content:
          "Sign in or create your Reading Corner account using Gmail, Phone Number, or Username.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

type AuthMode = "login" | "register" | "forgot";
type ExplicitLoginMethod = Exclude<LoginMode, "auto">;
type ForgotChannel = "email" | "phone";

const COUNTRY_CODES = ["+91", "+1", "+44", "+971", "+966", "+65", "+61"];

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5c-.3 1.5-1.1 2.8-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.2 0-5.9-2.1-6.9-5H1.1v3.1C3.1 21.4 7.2 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.1 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3V6.6H1.1C.4 8.2 0 10.1 0 12s.4 3.8 1.1 5.4l4-3.1z"
      />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C18 1.2 15.2 0 12 0 7.2 0 3.1 2.6 1.1 6.6l4 3.1c1-2.9 3.7-4.9 6.9-4.9z"
      />
    </svg>
  );
}

function AuthPage() {
  const navigate = useNavigate();
  const { next, mode: initialMode } = Route.useSearch();
  const { ready, me, soundEnabled, otpConfigured } = useChat();

  const [mode, setMode] = useState<AuthMode>(initialMode ?? "login");
  const [loginMethod, setLoginMethod] = useState<ExplicitLoginMethod>("gmail");
  const [backdropTheme, setBackdropTheme] = useState<SecretThemeId>("instagram");

  // Credentials & profile fields
  const [email, setEmail] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [bio, setBio] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [dp, setDp] = useState<string | null>(null);

  // Multi-account disambiguation when siblings share contact & password
  const [accountChoices, setAccountChoices] = useState<AccountChoiceOption[] | null>(null);

  // Forgot password states
  const [forgotChannel, setForgotChannel] = useState<ForgotChannel>("email");
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [smsOtpSent, setSmsOtpSent] = useState(false);
  const [resetCode, setResetCode] = useState("");
  const [resetNewPwd, setResetNewPwd] = useState("");
  const [resetUsername, setResetUsername] = useState("");

  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsProviderHelp, setNeedsProviderHelp] = useState(false);
  const [info, setInfo] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ready && me) {
      if (next && next.startsWith("/") && !next.startsWith("/auth")) {
        if (next.startsWith("/nfc/")) {
          window.location.assign(next);
        } else {
          navigate({ to: next as "/messages", replace: true });
        }
      } else {
        navigate({ to: "/messages", replace: true });
      }
    }
  }, [ready, me, navigate, next]);

  function switchMode(target: AuthMode) {
    playWaterSound("pop", soundEnabled);
    setMode(target);
    setError("");
    setNeedsProviderHelp(false);
    setInfo("");
    setPassword("");
    setConfirm("");
    setAccountChoices(null);
    setEmailOtpSent(false);
    setSmsOtpSent(false);
    setResetCode("");
    setResetNewPwd("");
  }

  function switchLoginMethod(nextMethod: ExplicitLoginMethod) {
    playWaterSound("pop", soundEnabled);
    setLoginMethod(nextMethod);
    setError("");
    setInfo("");
    setAccountChoices(null);
  }

  function pickDp(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setDp(String(reader.result));
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function goAfterLogin() {
    if (next && next.startsWith("/nfc/")) {
      window.location.assign(next);
    } else if (next && next.startsWith("/") && !next.startsWith("/auth")) {
      navigate({ to: next as "/messages", replace: true });
    } else {
      navigate({ to: "/messages", replace: true });
    }
  }

  async function handleGoogleLogin() {
    setError("");
    setNeedsProviderHelp(false);
    setInfo("");
    setGoogleBusy(true);
    try {
      await signInWithGoogle();
      toast.success("Signed in with Google");
      goAfterLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in with Google.");
    } finally {
      setGoogleBusy(false);
    }
  }

  async function submitLoginWithTarget(targetUserId?: string) {
    setError("");
    setNeedsProviderHelp(false);
    setInfo("");

    if (!password) {
      setError("Password is required.");
      return;
    }

    if (loginMethod === "gmail" && !email.trim()) {
      setError("Enter your Gmail or email address.");
      return;
    }
    if (loginMethod === "phone" && !phone.trim()) {
      setError("Enter your phone number.");
      return;
    }
    if (loginMethod === "username" && !username.trim()) {
      setError("Enter your username.");
      return;
    }

    setBusy(true);
    try {
      await loginAccount({
        mode: loginMethod,
        ...(loginMethod === "gmail" ? { email: email.trim() } : {}),
        ...(loginMethod === "phone" ? { phone: phone.trim() } : {}),
        countryCode,
        ...(loginMethod === "username" ? { username: username.trim() } : {}),
        password,
        ...(targetUserId ? { targetUserId } : {}),
      });
      setAccountChoices(null);
      playWaterSound("ripple", soundEnabled);
      toast.success("Welcome back");
      goAfterLogin();
    } catch (err) {
      if (err instanceof AccountChoiceRequiredError) {
        setAccountChoices(err.accounts);
        setInfo("Multiple linked accounts match your credentials. Pick one to open:");
      } else {
        const eObj = err as Error & { needsProviderConfig?: boolean };
        setError(eObj.message || "Invalid credentials.");
        if (eObj.needsProviderConfig) setNeedsProviderHelp(true);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNeedsProviderHelp(false);
    setInfo("");

    if (mode === "login") {
      await submitLoginWithTarget();
      return;
    }

    if (mode === "register") {
      if (fullName.trim().length < 2) {
        setError("Full name is required (at least 2 characters).");
        return;
      }
      const cleanEmail = email.trim();
      const cleanPhone = phone.trim();
      if (!cleanEmail && !cleanPhone) {
        setError("Enter your Gmail / email address or phone number.");
        return;
      }
      if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
        setError("Enter a valid Gmail or email address.");
        return;
      }
      if (username.trim() && username.trim().replace(/^@+/, "").length < 2) {
        setError("Username must be at least 2 characters.");
        return;
      }
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }
      if (password !== confirm) {
        setError("Passwords do not match.");
        return;
      }

      setBusy(true);
      try {
        await registerAccount({
          fullName: fullName.trim(),
          ...(cleanEmail ? { email: cleanEmail } : {}),
          ...(cleanPhone ? { phone: cleanPhone, countryCode } : {}),
          ...(username.trim() ? { username: username.trim() } : {}),
          password,
          bio: bio.trim(),
          avatarDataUrl: dp,
        });
        playWaterSound("ripple", soundEnabled);
        toast.success("Account created and saved permanently");
        goAfterLogin();
      } catch (err) {
        const eObj = err as Error & { needsProviderConfig?: boolean };
        setError(eObj.message || "Could not create account.");
        if (eObj.needsProviderConfig) setNeedsProviderHelp(true);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (mode === "forgot") {
      if (forgotChannel === "email") {
        const cleanEmail = email.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
          setError("Enter your registered Gmail or email address.");
          return;
        }

        if (emailOtpSent) {
          if (!resetCode.trim() || resetNewPwd.length < 8) {
            setError("Enter the verification code and a new password (8+ chars).");
            return;
          }
          setBusy(true);
          try {
            const res = await confirmEmailPasswordReset({
              email: cleanEmail,
              code: resetCode.trim(),
              newPassword: resetNewPwd,
              ...(resetUsername.trim() ? { username: resetUsername.trim() } : {}),
            });
            toast.success(
              `Password updated${res.updatedHandle ? ` for ${res.updatedHandle}` : ""}. You can sign in now.`,
            );
            switchMode("login");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not reset password.");
          } finally {
            setBusy(false);
          }
          return;
        }

        setBusy(true);
        try {
          const res = await sendPasswordReset(cleanEmail);
          playWaterSound("ripple", soundEnabled);
          if (res.mode === "email_otp") {
            setEmailOtpSent(true);
            setInfo(`6-digit reset code sent to ${cleanEmail}. Enter it below.`);
            toast.success("Reset code sent");
          } else {
            setInfo(`Password reset link sent to ${cleanEmail}. Check your inbox.`);
            toast.success("Password reset email sent");
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not send password reset email.");
        } finally {
          setBusy(false);
        }
        return;
      }

      // Phone SMS OTP reset
      if (!phone.trim()) {
        setError("Enter your registered phone number.");
        return;
      }

      if (!smsOtpSent) {
        setBusy(true);
        try {
          await sendOtp({ phone: phone.trim(), countryCode, purpose: "reset_password" });
          setSmsOtpSent(true);
          setInfo("SMS verification code sent. Enter the code and choose a new password.");
          toast.success("SMS OTP sent");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not send SMS OTP.");
        } finally {
          setBusy(false);
        }
        return;
      }

      if (!resetCode.trim() || resetNewPwd.length < 8) {
        setError("Enter the SMS OTP code and a new password (8+ chars).");
        return;
      }
      setBusy(true);
      try {
        const res = await resetPasswordWithOtp({
          phone: phone.trim(),
          countryCode,
          code: resetCode.trim(),
          newPassword: resetNewPwd,
        });
        toast.success(
          `Password updated${res.updatedHandle ? ` for ${res.updatedHandle}` : ""}. You can sign in now.`,
        );
        switchMode("login");
      } catch (err) {
        setError(err instanceof Error ? err.message : "OTP verification failed.");
      } finally {
        setBusy(false);
      }
    }
  }

  if (!ready || me) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-gradient-to-b from-[#070b14] via-[#0d1527] to-[#060a12] px-4 text-white">
        <div className="text-center">
          <Logo className="mx-auto size-12 animate-pulse" />
          <p className="mt-3 text-sm font-semibold">Restoring your session…</p>
          <p className="mt-1 text-xs text-white/65">Checking your saved account</p>
        </div>
      </div>
    );
  }

  const isDark = backdropTheme === "dark";
  const isLiquid = backdropTheme === "emerald";
  const insetClass = isDark
    ? "neu-inset-dark text-white focus-within:ring-sky-400/50"
    : isLiquid
      ? "liquid-glass-inset border border-white/80 text-[#1f1b38] focus-within:ring-violet-400/55"
      : "neu-inset-light text-[#1e293b] focus-within:ring-sky-400/50";
  const mutedTextClass = isDark ? "text-slate-300" : isLiquid ? "text-[#4e4970]" : "text-[#5b6b82]";
  const iconTintClass = isDark ? "text-sky-400" : isLiquid ? "text-[#6d5dfc]" : "text-[#5b6b82]";
  const linkAccentClass = isLiquid ? "text-[#6d5dfc]" : "text-[#0284c7]";

  return (
    <div
      className={cn(
        "relative min-h-[100dvh] overflow-x-hidden px-4 pt-6 pb-[calc(2rem+env(safe-area-inset-bottom))] transition-colors duration-500 sm:px-6 sm:pt-10 lg:pb-16",
        isDark
          ? "bg-gradient-to-b from-[#070b14] via-[#0d1527] to-[#060a12] text-white"
          : isLiquid
            ? "bg-gradient-to-br from-[#ede5e1] via-[#eaeaf5] to-[#dbeff5] text-[#1f1b38]"
            : "bg-gradient-to-br from-[#e7eef6] via-[#eef3fa] to-[#dce6f2] text-[#1e293b]",
      )}
    >
      {/* Drifting 3D Ambient Water & Iridescent Liquid Light Orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <motion.div
          animate={{
            x: [0, 24, -14, 0],
            y: [0, 18, -12, 0],
            scale: [1, 1.08, 0.96, 1],
            opacity: [0.46, 0.72, 0.46],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
          className={cn(
            "absolute -left-24 -top-24 size-[26rem] rounded-full blur-3xl",
            isDark
              ? "bg-gradient-to-tr from-[#06b6d4]/35 via-[#2563eb]/30 to-[#38bdf8]/24"
              : isLiquid
                ? "bg-gradient-to-tr from-[#a78bfa]/48 via-[#c4b5fd]/34 to-[#fbcfe8]/42"
                : "bg-gradient-to-tr from-[#7dd3fc]/45 via-[#38bdf8]/28 to-white/60",
          )}
        />
        <motion.div
          animate={{
            x: [0, -24, 16, 0],
            y: [0, -18, 12, 0],
            scale: [1.05, 0.95, 1.08, 1.05],
            opacity: [0.42, 0.68, 0.42],
          }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
          className={cn(
            "absolute -bottom-28 -right-24 size-[26rem] rounded-full blur-3xl",
            isDark
              ? "bg-gradient-to-tr from-[#2563eb]/32 via-[#0ea5e9]/28 to-[#6366f1]/28"
              : isLiquid
                ? "bg-gradient-to-tr from-[#2dd4bf]/44 via-[#6ee7d8]/36 to-[#fdba74]/40"
                : "bg-gradient-to-tr from-[#38bdf8]/30 via-[#93c5fd]/32 to-[#e0f2fe]/55",
          )}
        />
      </div>

      <TripleTapExit />

      <div className="relative mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-5xl flex-col justify-center lg:grid lg:grid-cols-[1fr_480px] lg:items-center lg:gap-12">
        {/* Left Info & Quick Header */}
        <div className="mb-6 lg:mb-0">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <WaterGlowButton
              variant={resolveWaterButtonVariant(backdropTheme, "surface")}
              size="sm"
              soundEnabled={soundEnabled}
              onClick={() => navigate({ to: "/home" })}
            >
              <ArrowLeft className="size-4" /> Reading Corner
            </WaterGlowButton>

            <div className="flex flex-wrap items-center gap-2">
              <WaterGlowButton
                variant={resolveWaterButtonVariant(backdropTheme, "surface")}
                size="sm"
                sound="pop"
                soundEnabled={!soundEnabled}
                onClick={() => setSoundEnabled(!soundEnabled)}
                aria-label={soundEnabled ? "Mute water sounds" : "Enable water sounds"}
              >
                {soundEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
                <span>{soundEnabled ? "Sound" : "Muted"}</span>
              </WaterGlowButton>

              <WaterGlowButton
                variant={
                  isLiquid ? "liquidViolet" : resolveWaterButtonVariant(backdropTheme, "surface")
                }
                size="sm"
                sound="pop"
                soundEnabled={soundEnabled}
                onClick={() => setBackdropTheme((t) => (t === "emerald" ? "instagram" : "emerald"))}
                aria-pressed={isLiquid}
                aria-label={isLiquid ? "Switch to Azure 3D theme" : "Switch to Liquid Glass theme"}
              >
                <Sparkles className="size-4" />
                <span>Liquid Glass</span>
              </WaterGlowButton>

              <WaterGlowButton
                variant={isDark ? "cobalt" : resolveWaterButtonVariant(backdropTheme, "surface")}
                size="sm"
                sound="pop"
                soundEnabled={soundEnabled}
                onClick={() => setBackdropTheme((t) => (t === "dark" ? "instagram" : "dark"))}
                aria-pressed={isDark}
                aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
              >
                {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
                <span>{isDark ? "Azure" : "Dark"}</span>
              </WaterGlowButton>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="mt-6"
          >
            <div className="flex items-center gap-4">
              <motion.div
                whileHover={{ y: -3, rotate: -2 }}
                transition={{ type: "spring", stiffness: 360, damping: 18 }}
                className={cn(
                  "glass-sheen grid size-14 place-items-center rounded-2xl border border-white/60 p-2.5 text-white",
                  isLiquid
                    ? "bg-gradient-to-tr from-[#9d7cff] via-[#7c5cff] to-[#2dd4bf] shadow-[0_14px_30px_-6px_rgba(124,92,255,0.55)]"
                    : "bg-gradient-to-tr from-[#4bc4e2] via-[#249ff0] to-[#0284c7] shadow-[0_14px_28px_-8px_rgba(14,165,233,0.58)]",
                )}
              >
                <Logo className="size-8 text-white" />
              </motion.div>
              <div>
                <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-4xl">
                  Reading Corner
                </h1>
                <p className={cn("text-xs font-medium sm:text-sm", mutedTextClass)}>
                  Read · Discover Readers · Direct Messages
                </p>
              </div>
            </div>

            <div
              className={cn(
                "mt-6 hidden space-y-3 text-sm lg:block",
                isDark ? "text-slate-300" : isLiquid ? "text-[#353054]" : "text-[#334155]",
              )}
            >
              <p className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "grid size-8 place-items-center rounded-full shadow-inner",
                    isLiquid ? "bg-violet-500/18 text-[#6d5dfc]" : "bg-sky-500/15 text-[#0284c7]",
                  )}
                >
                  <Mail className="size-4" />
                </span>
                Sign in with Gmail, Phone Number, Username, or Google — link up to 3 accounts per
                verified contact.
              </p>
              <p className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "grid size-8 place-items-center rounded-full shadow-inner",
                    isLiquid ? "bg-teal-500/18 text-[#0d9488]" : "bg-cyan-500/15 text-[#0ea5e9]",
                  )}
                >
                  <ShieldCheck className="size-4" />
                </span>
                Real-time WebSocket chat, calls, and permanent personal QR &amp; NFC links synced
                cleanly.
              </p>
              <p className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "grid size-8 place-items-center rounded-full shadow-inner",
                    isLiquid ? "bg-indigo-500/18 text-[#4f46e5]" : "bg-blue-500/15 text-[#2563eb]",
                  )}
                >
                  <Lock className="size-4" />
                </span>
                Your email, phone number, and password remain private and are never shown to other
                readers.
              </p>
            </div>
          </motion.div>
        </div>

        {/* Right 3D / Liquid Glass Card */}
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 22 }}
          className={cn(
            "relative w-full rounded-[34px] border p-5 sm:p-7",
            isDark
              ? "neu-card-dark border-sky-400/20 text-white"
              : isLiquid
                ? "liquid-glass-panel border-white/85 text-[#1f1b38]"
                : "neu-card-light border-white/95 text-[#1e293b]",
          )}
        >
          {/* Emblem Medallion */}
          <div className="flex flex-col items-center text-center">
            <motion.div
              animate={{ y: [0, -5, 0] }}
              transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut" }}
              className={cn(
                "mb-3 grid size-16 place-items-center rounded-full p-1.5 sm:size-[72px]",
                isDark
                  ? "bg-gradient-to-br from-[#1d2a45] to-[#0f172a] shadow-[10px_12px_24px_rgba(2,6,18,0.8),-6px_-6px_16px_rgba(56,189,248,0.12)]"
                  : isLiquid
                    ? "liquid-glass-iridescent border border-white/90"
                    : "bg-gradient-to-br from-white to-[#dfe8f4] shadow-[10px_12px_24px_rgba(154,174,200,0.48),-8px_-8px_20px_rgba(255,255,255,0.98)]",
              )}
            >
              <span
                className={cn(
                  "glass-sheen grid size-full place-items-center rounded-full text-white shadow-[inset_0_2px_4px_rgba(255,255,255,0.35)]",
                  isLiquid
                    ? "bg-gradient-to-br from-[#8b5cf6] via-[#6d5dfc] to-[#2dd4bf]"
                    : "bg-gradient-to-br from-[#0f172a] via-[#13294b] to-[#0284c7]",
                )}
              >
                {mode === "forgot" ? (
                  <KeyRound className="size-7 text-white" />
                ) : mode === "register" ? (
                  <Sparkles className="size-7 text-white" />
                ) : (
                  <BookOpen className="size-7 text-white" />
                )}
              </span>
            </motion.div>

            <AnimatePresence mode="wait">
              <motion.div
                key={mode}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-[28px]">
                  {mode === "login"
                    ? "Welcome Back"
                    : mode === "register"
                      ? "Create Your Account"
                      : "Reset Password"}
                </h2>
                <p className={cn("mt-1 text-xs font-medium", mutedTextClass)}>
                  {mode === "login"
                    ? "Choose Gmail, Phone Number, Username, or Google"
                    : mode === "register"
                      ? "Create a permanent account with your own handle & personal link"
                      : "Recover access using your Gmail or registered phone"}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Auth Primary Mode Switcher (Login | Create Account) */}
          <div className="mt-5">
            {mode !== "forgot" ? (
              <div
                className={cn(
                  "grid grid-cols-2 gap-1.5 rounded-full p-1.5",
                  isDark
                    ? "neu-inset-dark"
                    : isLiquid
                      ? "liquid-glass-inset border border-white/75"
                      : "neu-inset-light",
                )}
              >
                {(
                  [
                    { id: "login", label: "Login" },
                    { id: "register", label: "Create Account" },
                  ] as const
                ).map(({ id, label }) => {
                  const active = mode === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => switchMode(id)}
                      className={cn(
                        "relative min-h-[42px] rounded-full text-xs font-bold transition-colors",
                        active
                          ? "text-white"
                          : isDark
                            ? "text-slate-300 hover:text-white"
                            : isLiquid
                              ? "text-[#4e4970] hover:text-[#1f1b38]"
                              : "text-[#475569] hover:text-[#0f172a]",
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="authModePill"
                          transition={{ type: "spring", stiffness: 420, damping: 24 }}
                          className={cn(
                            "glass-sheen absolute inset-0 rounded-full",
                            isLiquid
                              ? "border border-white/60 bg-gradient-to-r from-[#9d7cff] via-[#7c5cff] to-[#2dd4bf] shadow-[inset_0_1.5px_1.5px_rgba(255,255,255,0.68),0_10px_24px_-6px_rgba(124,92,255,0.5)]"
                              : "bg-gradient-to-r from-[#4bc4e2] via-[#249ff0] to-[#0284c7] shadow-[inset_0_1.5px_1px_rgba(255,255,255,0.55),0_8px_18px_-4px_rgba(14,165,233,0.55)]",
                          )}
                        />
                      )}
                      <span className="relative z-10">{label}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => switchMode("login")}
                className={cn(
                  "inline-flex min-h-[36px] items-center gap-1.5 text-xs font-bold hover:underline",
                  linkAccentClass,
                )}
              >
                <ArrowLeft className="size-3.5" /> Back to Login
              </button>
            )}
          </div>

          {/* Google Sign-In Button */}
          {mode !== "forgot" && (
            <div className="mt-4">
              <WaterGlowButton
                type="button"
                variant={resolveWaterButtonVariant(backdropTheme, "surface")}
                size="md"
                sound="pop"
                soundEnabled={soundEnabled}
                disabled={googleBusy || busy}
                onClick={() => void handleGoogleLogin()}
                className="w-full"
              >
                <GoogleIcon />
                <span>{googleBusy ? "Connecting Google…" : "Continue with Google"}</span>
              </WaterGlowButton>

              <div className="my-4 flex items-center gap-3">
                <span
                  className={cn(
                    "h-px flex-1",
                    isDark ? "bg-white/15" : isLiquid ? "bg-violet-300/45" : "bg-slate-300/70",
                  )}
                />
                <span
                  className={cn(
                    "text-[11px] font-bold uppercase tracking-wider",
                    isDark ? "text-slate-400" : isLiquid ? "text-[#585478]" : "text-[#64748b]",
                  )}
                >
                  {mode === "login" ? "or sign in with" : "or register with"}
                </span>
                <span
                  className={cn(
                    "h-px flex-1",
                    isDark ? "bg-white/15" : isLiquid ? "bg-violet-300/45" : "bg-slate-300/70",
                  )}
                />
              </div>
            </div>
          )}

          {/* Explicit 3-Method Login Selector */}
          {mode === "login" && (
            <div
              role="tablist"
              aria-label="Login method"
              className={cn(
                "mb-3.5 grid grid-cols-3 gap-1 rounded-2xl p-1",
                isDark
                  ? "neu-inset-dark"
                  : isLiquid
                    ? "liquid-glass-inset border border-white/75"
                    : "neu-inset-light",
              )}
            >
              {(
                [
                  { id: "gmail", label: "Gmail", icon: Mail },
                  { id: "phone", label: "Phone", icon: Phone },
                  { id: "username", label: "Username", icon: AtSign },
                ] as const
              ).map(({ id, label, icon: Icon }) => {
                const active = loginMethod === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => switchLoginMethod(id)}
                    className={cn(
                      "relative flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-bold transition",
                      active
                        ? "text-white"
                        : isDark
                          ? "text-slate-300 hover:text-white"
                          : isLiquid
                            ? "text-[#4e4970]"
                            : "text-[#475569]",
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="loginMethodTab"
                        transition={{ type: "spring", stiffness: 400, damping: 28 }}
                        className={cn(
                          "absolute inset-0 rounded-xl",
                          isLiquid
                            ? "bg-gradient-to-r from-[#8b5cf6] to-[#2dd4bf]"
                            : "bg-gradient-to-r from-[#38bdf8] to-[#0284c7]",
                        )}
                      />
                    )}
                    <Icon className="relative z-10 size-3.5 shrink-0" />
                    <span className="relative z-10">{label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Forgot Password Channel Selector */}
          {mode === "forgot" && (
            <div
              className={cn(
                "mt-4 mb-3.5 grid grid-cols-2 gap-1 rounded-2xl p-1",
                isDark
                  ? "neu-inset-dark"
                  : isLiquid
                    ? "liquid-glass-inset border border-white/75"
                    : "neu-inset-light",
              )}
            >
              <button
                type="button"
                onClick={() => {
                  setForgotChannel("email");
                  setError("");
                  setInfo("");
                }}
                className={cn(
                  "min-h-[38px] rounded-xl text-xs font-bold transition",
                  forgotChannel === "email"
                    ? "bg-gradient-to-r from-[#38bdf8] to-[#0284c7] text-white"
                    : mutedTextClass,
                )}
              >
                Reset via Gmail
              </button>
              <button
                type="button"
                onClick={() => {
                  setForgotChannel("phone");
                  setError("");
                  setInfo("");
                }}
                className={cn(
                  "min-h-[38px] rounded-xl text-xs font-bold transition",
                  forgotChannel === "phone"
                    ? "bg-gradient-to-r from-[#38bdf8] to-[#0284c7] text-white"
                    : mutedTextClass,
                )}
              >
                Reset via Phone OTP
              </button>
            </div>
          )}

          <AnimatePresence mode="wait">
            <motion.div
              key={`${mode}-${loginMethod}-${forgotChannel}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <form
                onSubmit={handleSubmit}
                noValidate
                className={mode === "register" ? "space-y-3" : "space-y-3.5"}
              >
                {/* LOGIN MODE FIELDS */}
                {mode === "login" && loginMethod === "gmail" && (
                  <div
                    className={cn(
                      "flex min-h-[52px] items-center gap-3 rounded-full px-4 transition focus-within:ring-2",
                      insetClass,
                    )}
                  >
                    <Mail className={cn("size-4 shrink-0", iconTintClass)} />
                    <input
                      type="email"
                      inputMode="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setAccountChoices(null);
                      }}
                      placeholder="Gmail or email address *"
                      aria-label="Gmail or email address"
                      autoComplete="email"
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-65"
                    />
                  </div>
                )}

                {mode === "login" && loginMethod === "phone" && (
                  <div className="flex gap-2">
                    <select
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      aria-label="Country code"
                      className={cn(
                        "min-h-[52px] rounded-full px-3 text-xs font-bold outline-none",
                        insetClass,
                      )}
                    >
                      {COUNTRY_CODES.map((c) => (
                        <option key={c} value={c} className="text-slate-900">
                          {c}
                        </option>
                      ))}
                    </select>
                    <div
                      className={cn(
                        "flex min-h-[52px] flex-1 items-center gap-3 rounded-full px-4 transition focus-within:ring-2",
                        insetClass,
                      )}
                    >
                      <Phone className={cn("size-4 shrink-0", iconTintClass)} />
                      <input
                        type="tel"
                        inputMode="tel"
                        value={phone}
                        onChange={(e) => {
                          setPhone(e.target.value);
                          setAccountChoices(null);
                        }}
                        placeholder="Phone number *"
                        aria-label="Phone number"
                        autoComplete="tel-national"
                        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-65"
                      />
                    </div>
                  </div>
                )}

                {mode === "login" && loginMethod === "username" && (
                  <div
                    className={cn(
                      "flex min-h-[52px] items-center gap-3 rounded-full px-4 transition focus-within:ring-2",
                      insetClass,
                    )}
                  >
                    <AtSign className={cn("size-4 shrink-0", iconTintClass)} />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value);
                        setAccountChoices(null);
                      }}
                      placeholder="Username (e.g. @aanya.reads) *"
                      aria-label="Username"
                      autoComplete="username"
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-65"
                    />
                  </div>
                )}

                {/* REGISTER MODE FIELDS */}
                {mode === "register" && (
                  <>
                    <div className="flex items-center gap-3.5">
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className={cn(
                          "glass-sheen relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-full p-0.5",
                          isLiquid
                            ? "bg-gradient-to-tr from-[#9d7cff] via-[#7c5cff] to-[#2dd4bf] shadow-[0_8px_22px_-6px_rgba(124,92,255,0.52)]"
                            : "bg-gradient-to-tr from-[#4bc4e2] via-[#249ff0] to-[#0284c7] shadow-[0_8px_20px_-6px_rgba(14,165,233,0.55)]",
                        )}
                        aria-label="Choose profile photo"
                      >
                        <span
                          className={cn(
                            "grid size-full place-items-center overflow-hidden rounded-full font-display text-base font-bold",
                            isDark
                              ? "bg-[#151f36] text-white"
                              : isLiquid
                                ? "bg-white/85 text-[#1f1b38]"
                                : "bg-[#f3f7fc] text-[#1e293b]",
                          )}
                        >
                          {dp ? (
                            <img
                              src={dp}
                              alt="Profile preview"
                              className="size-full object-cover"
                            />
                          ) : fullName.trim() ? (
                            initialsOf(fullName)
                          ) : (
                            <Camera className="size-5 opacity-60" />
                          )}
                        </span>
                      </button>
                      <div className="min-w-0 flex-1 text-xs">
                        <p className="font-bold">Profile photo</p>
                        <p className={mutedTextClass}>Tap to upload a photo from your device.</p>
                      </div>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        onChange={pickDp}
                        className="hidden"
                      />
                    </div>

                    <div
                      className={cn(
                        "flex min-h-[50px] items-center gap-3 rounded-full px-4 transition focus-within:ring-2",
                        insetClass,
                      )}
                    >
                      <User className={cn("size-4 shrink-0", iconTintClass)} />
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Full name *"
                        aria-label="Full name"
                        autoComplete="name"
                        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-65"
                      />
                    </div>

                    <div
                      className={cn(
                        "flex min-h-[50px] items-center gap-3 rounded-full px-4 transition focus-within:ring-2",
                        insetClass,
                      )}
                    >
                      <AtSign className={cn("size-4 shrink-0", iconTintClass)} />
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="Username (optional, e.g. aanya.reads)"
                        aria-label="Username"
                        autoComplete="username"
                        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-65"
                      />
                    </div>

                    <div
                      className={cn(
                        "flex min-h-[50px] items-center gap-3 rounded-full px-4 transition focus-within:ring-2",
                        insetClass,
                      )}
                    >
                      <Mail className={cn("size-4 shrink-0", iconTintClass)} />
                      <input
                        type="email"
                        inputMode="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Gmail or email address"
                        aria-label="Gmail or email address"
                        autoComplete="email"
                        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-65"
                      />
                    </div>

                    <div className="flex gap-2">
                      <select
                        value={countryCode}
                        onChange={(e) => setCountryCode(e.target.value)}
                        aria-label="Country code"
                        className={cn(
                          "min-h-[50px] rounded-full px-3 text-xs font-bold outline-none",
                          insetClass,
                        )}
                      >
                        {COUNTRY_CODES.map((c) => (
                          <option key={c} value={c} className="text-slate-900">
                            {c}
                          </option>
                        ))}
                      </select>
                      <div
                        className={cn(
                          "flex min-h-[50px] flex-1 items-center gap-3 rounded-full px-4 transition focus-within:ring-2",
                          insetClass,
                        )}
                      >
                        <Phone className={cn("size-4 shrink-0", iconTintClass)} />
                        <input
                          type="tel"
                          inputMode="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="Phone number (optional if email provided)"
                          aria-label="Phone number"
                          autoComplete="tel-national"
                          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-65"
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* FORGOT PASSWORD FIELDS */}
                {mode === "forgot" && forgotChannel === "email" && (
                  <>
                    <div
                      className={cn(
                        "flex min-h-[52px] items-center gap-3 rounded-full px-4 transition focus-within:ring-2",
                        insetClass,
                      )}
                    >
                      <Mail className={cn("size-4 shrink-0", iconTintClass)} />
                      <input
                        type="email"
                        inputMode="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Registered Gmail or email *"
                        aria-label="Registered Gmail or email"
                        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-65"
                      />
                    </div>

                    {emailOtpSent && (
                      <>
                        <div
                          className={cn(
                            "flex min-h-[50px] items-center gap-3 rounded-full px-4",
                            insetClass,
                          )}
                        >
                          <KeyRound className={cn("size-4 shrink-0", iconTintClass)} />
                          <input
                            type="text"
                            value={resetCode}
                            onChange={(e) => setResetCode(e.target.value)}
                            placeholder="6-digit reset code *"
                            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-65"
                          />
                        </div>
                        <div
                          className={cn(
                            "flex min-h-[50px] items-center gap-3 rounded-full px-4",
                            insetClass,
                          )}
                        >
                          <AtSign className={cn("size-4 shrink-0", iconTintClass)} />
                          <input
                            type="text"
                            value={resetUsername}
                            onChange={(e) => setResetUsername(e.target.value)}
                            placeholder="Target @username (if multiple accounts)"
                            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-65"
                          />
                        </div>
                        <div
                          className={cn(
                            "flex min-h-[50px] items-center gap-3 rounded-full px-4",
                            insetClass,
                          )}
                        >
                          <Lock className={cn("size-4 shrink-0", iconTintClass)} />
                          <input
                            type={showPassword ? "text" : "password"}
                            value={resetNewPwd}
                            onChange={(e) => setResetNewPwd(e.target.value)}
                            placeholder="New password (8+ chars) *"
                            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-65"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((s) => !s)}
                            aria-label={showPassword ? "Hide password" : "Show password"}
                            className="grid size-8 shrink-0 place-items-center rounded-full opacity-70 hover:opacity-100"
                          >
                            {showPassword ? (
                              <EyeOff className="size-4" />
                            ) : (
                              <Eye className="size-4" />
                            )}
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}

                {mode === "forgot" && forgotChannel === "phone" && (
                  <>
                    <div className="flex gap-2">
                      <select
                        value={countryCode}
                        onChange={(e) => setCountryCode(e.target.value)}
                        aria-label="Country code"
                        className={cn(
                          "min-h-[52px] rounded-full px-3 text-xs font-bold outline-none",
                          insetClass,
                        )}
                      >
                        {COUNTRY_CODES.map((c) => (
                          <option key={c} value={c} className="text-slate-900">
                            {c}
                          </option>
                        ))}
                      </select>
                      <div
                        className={cn(
                          "flex min-h-[52px] flex-1 items-center gap-3 rounded-full px-4",
                          insetClass,
                        )}
                      >
                        <Phone className={cn("size-4 shrink-0", iconTintClass)} />
                        <input
                          type="tel"
                          inputMode="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="Registered phone number *"
                          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-65"
                        />
                      </div>
                    </div>

                    {!otpConfigured && (
                      <p className={cn("text-xs", mutedTextClass)}>
                        Note: Phone SMS OTP requires Twilio configuration on the server. Use Gmail
                        reset if SMS OTP is not enabled.
                      </p>
                    )}

                    {smsOtpSent && (
                      <>
                        <div
                          className={cn(
                            "flex min-h-[50px] items-center gap-3 rounded-full px-4",
                            insetClass,
                          )}
                        >
                          <KeyRound className={cn("size-4 shrink-0", iconTintClass)} />
                          <input
                            type="text"
                            value={resetCode}
                            onChange={(e) => setResetCode(e.target.value)}
                            placeholder="SMS OTP code *"
                            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-65"
                          />
                        </div>
                        <div
                          className={cn(
                            "flex min-h-[50px] items-center gap-3 rounded-full px-4",
                            insetClass,
                          )}
                        >
                          <Lock className={cn("size-4 shrink-0", iconTintClass)} />
                          <input
                            type={showPassword ? "text" : "password"}
                            value={resetNewPwd}
                            onChange={(e) => setResetNewPwd(e.target.value)}
                            placeholder="New password (8+ chars) *"
                            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-65"
                          />
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* PASSWORD INPUT (Login + Register) */}
                {mode !== "forgot" && (
                  <div
                    className={cn(
                      "flex min-h-[52px] items-center gap-3 rounded-full px-4 transition focus-within:ring-2",
                      insetClass,
                    )}
                  >
                    <Lock className={cn("size-4 shrink-0", iconTintClass)} />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setAccountChoices(null);
                      }}
                      placeholder={mode === "login" ? "Password *" : "Create password (8+ chars) *"}
                      aria-label="Password"
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-65"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="grid size-8 shrink-0 place-items-center rounded-full opacity-70 transition hover:opacity-100"
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                )}

                {/* CONFIRM PASSWORD & BIO (Register) */}
                {mode === "register" && (
                  <>
                    <div
                      className={cn(
                        "flex min-h-[50px] items-center gap-3 rounded-full px-4 transition focus-within:ring-2",
                        insetClass,
                      )}
                    >
                      <Lock className={cn("size-4 shrink-0", iconTintClass)} />
                      <input
                        type={showConfirm ? "text" : "password"}
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        placeholder="Confirm password *"
                        aria-label="Confirm password"
                        autoComplete="new-password"
                        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:opacity-65"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirm((s) => !s)}
                        aria-label={showConfirm ? "Hide confirm password" : "Show confirm password"}
                        className="grid size-8 shrink-0 place-items-center rounded-full opacity-70 transition hover:opacity-100"
                      >
                        {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>

                    <input
                      type="text"
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder="Short bio or favorite genre (optional)"
                      aria-label="Bio"
                      maxLength={180}
                      className={cn(
                        "min-h-[48px] w-full rounded-full px-4 text-sm outline-none transition placeholder:opacity-65 focus:ring-2",
                        insetClass,
                      )}
                    />
                  </>
                )}

                {/* Multi-Account Disambiguation Picker */}
                {accountChoices && accountChoices.length > 1 && (
                  <div
                    data-testid="account-choice-picker"
                    className="space-y-2 rounded-2xl border border-sky-400/35 bg-sky-500/10 p-3"
                  >
                    <p className="text-xs font-bold">Choose which linked profile to open:</p>
                    <div className="space-y-1.5">
                      {dedupeUsersById(accountChoices).map((acc) => (
                        <button
                          key={acc.id}
                          type="button"
                          disabled={busy}
                          onClick={() => void submitLoginWithTarget(acc.id)}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs transition hover:scale-[1.01]",
                            isDark
                              ? "border-white/15 bg-white/10 hover:bg-white/15"
                              : "border-slate-300/70 bg-white/80 hover:bg-white",
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-sky-500/20 font-bold">
                              {acc.avatarUrl ? (
                                <img
                                  src={acc.avatarUrl}
                                  alt={acc.fullName}
                                  className="size-full object-cover"
                                />
                              ) : (
                                initialsOf(acc.fullName)
                              )}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-bold">{acc.fullName}</span>
                              <span className="block truncate opacity-75">{acc.displayHandle}</span>
                            </span>
                          </span>
                          <ArrowRight className="size-4 shrink-0 opacity-75" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    role="alert"
                    className="space-y-1.5 rounded-2xl border border-rose-400/30 bg-rose-500/15 px-3.5 py-2.5 text-xs font-semibold text-rose-500"
                  >
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" />
                      <span>{error}</span>
                    </div>
                    {needsProviderHelp && (
                      <a
                        href="https://console.firebase.google.com/project/mindful-abode-g91ww/authentication/providers"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-bold underline"
                      >
                        Enable Email/Password in Firebase Console{" "}
                        <ExternalLink className="size-3" />
                      </a>
                    )}
                  </motion.div>
                )}

                {info && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-start gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/15 px-3.5 py-2.5 text-xs font-semibold text-emerald-500"
                  >
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                    <span>{info}</span>
                  </motion.div>
                )}

                {/* Primary CTA */}
                <WaterGlowButton
                  type="submit"
                  variant={resolveWaterButtonVariant(backdropTheme, "primary")}
                  size="lg"
                  sound="droplet"
                  soundEnabled={soundEnabled}
                  disabled={busy || googleBusy}
                  className="mt-1 w-full"
                >
                  <span>
                    {busy
                      ? "Please wait…"
                      : mode === "login"
                        ? "Login"
                        : mode === "register"
                          ? "Create Account"
                          : forgotChannel === "phone"
                            ? smsOtpSent
                              ? "Confirm OTP & Reset"
                              : "Send SMS OTP"
                            : emailOtpSent
                              ? "Reset Password"
                              : "Send Reset Link / Code"}
                  </span>
                  {!busy && <ArrowRight className="size-4" />}
                </WaterGlowButton>

                {mode === "login" && (
                  <p className={cn("pt-1 text-center text-xs font-medium", mutedTextClass)}>
                    <button
                      type="button"
                      onClick={() => switchMode("forgot")}
                      className={cn("font-bold hover:underline", linkAccentClass)}
                    >
                      Forgot password?
                    </button>{" "}
                    <span className="opacity-70">or</span>{" "}
                    <button
                      type="button"
                      onClick={() => switchMode("register")}
                      className={cn("font-bold hover:underline", linkAccentClass)}
                    >
                      Sign Up
                    </button>
                  </p>
                )}
              </form>
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </div>

      <ReadingActions
        themeId={backdropTheme}
        className="max-lg:static max-lg:mt-5 max-lg:justify-center"
      />
    </div>
  );
}
