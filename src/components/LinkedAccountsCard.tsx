import {
  ArrowRightLeft,
  Camera,
  CheckCircle2,
  Mail,
  Phone,
  Plus,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  checkEmailVerificationStatus,
  createLinkedAccount,
  fetchLinkedAccounts,
  initialsOf,
  sendOtp,
  switchLinkedAccount,
  useChat,
  verifyEmailWithFirebase,
  verifyMyPhoneOtp,
  type LinkedAccountsInfo,
} from "@/lib/chat-store";
import type { SecretThemeTokens } from "@/lib/secret-themes";
import { cn } from "@/lib/utils";

export function LinkedAccountsCard({
  variant = "surface",
  theme,
  className,
  onSwitched,
}: {
  variant?: "surface" | "glass";
  theme?: SecretThemeTokens;
  className?: string;
  onSwitched?: () => void;
}) {
  const { me, otpConfigured } = useChat();
  const [info, setInfo] = useState<LinkedAccountsInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  // Create linked account form
  const [showCreate, setShowCreate] = useState(false);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [bio, setBio] = useState("");
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [linkBy, setLinkBy] = useState<"auto" | "email" | "phone" | "both">("auto");
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Inline verification states
  const [emailVerifyPwd, setEmailVerifyPwd] = useState("");
  const [verifyingEmail, setVerifyingEmail] = useState(false);
  const [phoneOtpSent, setPhoneOtpSent] = useState(false);
  const [phoneOtpCode, setPhoneOtpCode] = useState("");
  const [verifyingPhone, setVerifyingPhone] = useState(false);

  const loadLinked = useCallback(async () => {
    if (!me) return;
    setLoading(true);
    try {
      const data = await fetchLinkedAccounts();
      setInfo(data);
    } catch {
      /* ignore transient fetch failure */
    } finally {
      setLoading(false);
    }
  }, [me?.id, me?.emailVerified, me?.phoneVerified]);

  useEffect(() => {
    void loadLinked();
  }, [loadLinked]);

  if (!me) return null;

  const isGlass = variant === "glass" && Boolean(theme);
  const canCreate = Boolean(info && (info.canCreateByEmail || info.canCreateByPhone));

  function pickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setAvatarDataUrl(String(reader.result));
    reader.readAsDataURL(f);
  }

  async function handleSwitch(targetId: string) {
    if (switchingId || targetId === me?.id) return;
    setSwitchingId(targetId);
    try {
      const switched = await switchLinkedAccount(targetId);
      toast.success(`Switched to ${switched.fullName} (${switched.displayHandle})`);
      await loadLinked();
      onSwitched?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not switch account.");
    } finally {
      setSwitchingId(null);
    }
  }

  async function handleCreateLinked(e: React.FormEvent) {
    e.preventDefault();
    if (fullName.trim().length < 2) {
      toast.error("Full name must be at least 2 characters.");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    setCreating(true);
    try {
      const res = await createLinkedAccount({
        fullName: fullName.trim(),
        ...(username.trim() ? { username: username.trim() } : {}),
        password,
        bio: bio.trim(),
        avatarDataUrl,
        linkBy,
        switchToNew: true,
      });
      toast.success(`Created & opened ${res.user.fullName} (${res.user.displayHandle})`);
      setShowCreate(false);
      setFullName("");
      setUsername("");
      setPassword("");
      setBio("");
      setAvatarDataUrl(null);
      await loadLinked();
      onSwitched?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create linked account.");
    } finally {
      setCreating(false);
    }
  }

  async function handleVerifyEmail() {
    if (!emailVerifyPwd) {
      toast.error("Enter your account password to send Gmail verification.");
      return;
    }
    setVerifyingEmail(true);
    try {
      await verifyEmailWithFirebase(emailVerifyPwd);
      toast.success("Email verified! You can now link up to 3 accounts.");
      setEmailVerifyPwd("");
      await loadLinked();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification status pending.");
    } finally {
      setVerifyingEmail(false);
    }
  }

  async function handleCheckEmailVerified() {
    setVerifyingEmail(true);
    try {
      const updated = await checkEmailVerificationStatus();
      if (updated?.emailVerified) {
        toast.success("Gmail verified!");
        await loadLinked();
      } else {
        toast("Verification email link not clicked yet.", {
          description: "Open the verification email sent to your inbox and try again.",
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not verify status.");
    } finally {
      setVerifyingEmail(false);
    }
  }

  async function handleSendPhoneOtp() {
    if (!me?.phoneE164) return;
    setVerifyingPhone(true);
    try {
      await sendOtp({ phone: me.phoneE164, countryCode: "+91", purpose: "verify_phone" });
      setPhoneOtpSent(true);
      toast.success("OTP sent to your phone.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send OTP.");
    } finally {
      setVerifyingPhone(false);
    }
  }

  async function handleConfirmPhoneOtp() {
    if (!phoneOtpCode.trim()) return;
    setVerifyingPhone(true);
    try {
      await verifyMyPhoneOtp(phoneOtpCode.trim());
      setPhoneOtpCode("");
      setPhoneOtpSent(false);
      toast.success("Phone number verified!");
      await loadLinked();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid OTP code.");
    } finally {
      setVerifyingPhone(false);
    }
  }

  const maxPerContact = info?.maxAccounts ?? 3;
  const reachedCap =
    info &&
    !info.canCreateByEmail &&
    !info.canCreateByPhone &&
    (info.emailVerified || info.phoneVerified);

  return (
    <section
      data-testid="linked-accounts-card"
      className={cn(
        "space-y-4 rounded-3xl p-5 sm:p-6",
        isGlass
          ? cn("border backdrop-blur-xl", theme!.surfaceGlass, theme!.border, theme!.cardShadow)
          : "bg-card shadow-soft",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-bold sm:text-lg">
            Linked Accounts (Max {maxPerContact})
          </h2>
          <p className={cn("mt-0.5 text-xs", isGlass ? theme!.mutedText : "text-muted-foreground")}>
            Create up to {maxPerContact} separate profiles under your verified Gmail or phone number
            — each with its own username, DP, messages, and personal link.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
          {info?.email && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1",
                info.emailVerified
                  ? "bg-emerald-500/15 text-emerald-600"
                  : "bg-amber-500/15 text-amber-600",
              )}
            >
              <Mail className="size-3" />
              {info.emailVerified
                ? `${info.emailAccountCount}/${maxPerContact}`
                : "Email unverified"}
            </span>
          )}
          {info?.phoneMasked && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1",
                info.phoneVerified
                  ? "bg-emerald-500/15 text-emerald-600"
                  : "bg-amber-500/15 text-amber-600",
              )}
            >
              <Phone className="size-3" />
              {info.phoneVerified
                ? `${info.phoneAccountCount}/${maxPerContact}`
                : "Phone unverified"}
            </span>
          )}
        </div>
      </div>

      {/* Verification prompt when current contact isn't verified yet */}
      {info && !info.emailVerified && !info.phoneVerified && (
        <div
          className={cn(
            "space-y-3 rounded-2xl border p-4 text-xs",
            isGlass
              ? cn(theme!.border, theme!.surfaceMuted)
              : "border-amber-500/30 bg-amber-500/10",
          )}
        >
          <p className="flex items-center gap-1.5 font-bold">
            <ShieldCheck className="size-4 text-amber-500" />
            Verify your Gmail or phone number to unlock creating up to {maxPerContact} linked
            accounts
          </p>

          {info.email && !info.emailVerified && (
            <div className="flex flex-wrap gap-2">
              <input
                type="password"
                value={emailVerifyPwd}
                onChange={(e) => setEmailVerifyPwd(e.target.value)}
                placeholder="Account password to verify email"
                className={cn(
                  "min-w-[200px] flex-1 rounded-xl border px-3 py-2 text-xs outline-none",
                  isGlass ? cn(theme!.border, theme!.surface) : "border-border bg-background",
                )}
              />
              <button
                type="button"
                disabled={verifyingEmail}
                onClick={() => void handleVerifyEmail()}
                className={cn(
                  "press rounded-xl px-3.5 py-2 text-xs font-bold",
                  isGlass ? theme!.accentBg : "bg-brand text-primary-foreground",
                )}
              >
                Send Verification Link
              </button>
              <button
                type="button"
                disabled={verifyingEmail}
                onClick={() => void handleCheckEmailVerified()}
                className={cn(
                  "press rounded-xl px-3 py-2 text-xs font-bold",
                  isGlass ? theme!.surface : "bg-secondary text-secondary-foreground",
                )}
              >
                Check Status
              </button>
            </div>
          )}

          {me.phoneE164 && !info.phoneVerified && otpConfigured && (
            <div className="flex flex-wrap gap-2">
              {!phoneOtpSent ? (
                <button
                  type="button"
                  disabled={verifyingPhone}
                  onClick={() => void handleSendPhoneOtp()}
                  className={cn(
                    "press rounded-xl px-3.5 py-2 text-xs font-bold",
                    isGlass ? theme!.accentBg : "bg-brand text-primary-foreground",
                  )}
                >
                  Verify Phone via SMS OTP
                </button>
              ) : (
                <>
                  <input
                    value={phoneOtpCode}
                    onChange={(e) => setPhoneOtpCode(e.target.value)}
                    placeholder="Enter 6-digit OTP"
                    className={cn(
                      "min-w-[160px] flex-1 rounded-xl border px-3 py-2 text-xs outline-none",
                      isGlass ? cn(theme!.border, theme!.surface) : "border-border bg-background",
                    )}
                  />
                  <button
                    type="button"
                    disabled={verifyingPhone}
                    onClick={() => void handleConfirmPhoneOtp()}
                    className={cn(
                      "press rounded-xl px-4 py-2 text-xs font-bold",
                      isGlass ? theme!.accentBg : "bg-brand text-primary-foreground",
                    )}
                  >
                    Confirm OTP
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Existing Linked Sibling Accounts List */}
      <div className="space-y-2">
        {loading && !info ? (
          <p className={cn("text-xs", isGlass ? theme!.mutedText : "text-muted-foreground")}>
            Loading linked accounts…
          </p>
        ) : (
          (info?.accounts ?? []).map((acc) => (
            <div
              key={acc.id}
              data-testid={`linked-account-${acc.id}`}
              className={cn(
                "flex items-center justify-between gap-3 rounded-2xl border p-3",
                acc.isCurrent
                  ? isGlass
                    ? cn(theme!.border, theme!.surfaceMuted, "ring-1 ring-sky-400/50")
                    : "border-primary/40 bg-primary/5"
                  : isGlass
                    ? cn(theme!.border, theme!.surfaceMuted)
                    : "border-border/60 bg-secondary/50",
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className={cn(
                    "grid size-10 shrink-0 place-items-center overflow-hidden rounded-full font-display text-xs font-bold",
                    isGlass ? theme!.surface : "bg-brand text-primary-foreground",
                  )}
                >
                  {acc.avatarUrl ? (
                    <img
                      src={acc.avatarUrl}
                      alt={acc.fullName}
                      className="size-full object-cover"
                    />
                  ) : (
                    initialsOf(acc.fullName)
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{acc.fullName}</p>
                  <p
                    className={cn(
                      "truncate text-xs",
                      isGlass ? theme!.mutedText : "text-muted-foreground",
                    )}
                  >
                    {acc.displayHandle} · ID: {acc.id.slice(0, 10)}…
                  </p>
                </div>
              </div>

              {acc.isCurrent ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-bold text-emerald-600">
                  <CheckCircle2 className="size-3.5" /> Active
                </span>
              ) : (
                <button
                  type="button"
                  disabled={switchingId === acc.id}
                  onClick={() => void handleSwitch(acc.id)}
                  className={cn(
                    "press inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-xs font-bold disabled:opacity-50",
                    isGlass ? theme!.accentBg : "bg-brand text-primary-foreground",
                  )}
                >
                  <ArrowRightLeft className="size-3.5" />
                  {switchingId === acc.id ? "Switching…" : "Switch"}
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Create New Linked Account Button / Form */}
      {canCreate && !showCreate && (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className={cn(
            "press inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-2xl px-4 text-xs font-bold",
            isGlass ? theme!.accentBg : "bg-brand text-primary-foreground",
          )}
        >
          <UserPlus className="size-4" /> Create Another Account Under Verified Contact
        </button>
      )}

      {reachedCap && (
        <p
          className={cn(
            "text-xs font-medium",
            isGlass ? theme!.mutedText : "text-muted-foreground",
          )}
        >
          Maximum limit of {maxPerContact} linked accounts reached for your verified contact.
        </p>
      )}

      {showCreate && canCreate && (
        <form
          onSubmit={(e) => void handleCreateLinked(e)}
          className={cn(
            "space-y-3 rounded-2xl border p-4",
            isGlass ? cn(theme!.border, theme!.surfaceMuted) : "border-border bg-secondary/40",
          )}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <Plus className="size-4" /> New Linked Profile
            </h3>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="text-xs font-semibold opacity-70 hover:opacity-100"
            >
              Cancel
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={cn(
                "grid size-12 shrink-0 place-items-center overflow-hidden rounded-full border",
                isGlass ? cn(theme!.border, theme!.surface) : "border-border bg-card",
              )}
              aria-label="Choose profile photo"
            >
              {avatarDataUrl ? (
                <img src={avatarDataUrl} alt="New account DP" className="size-full object-cover" />
              ) : (
                <Camera className="size-4 opacity-60" />
              )}
            </button>
            <span className={cn("text-xs", isGlass ? theme!.mutedText : "text-muted-foreground")}>
              Optional separate display picture for this account.
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={pickAvatar}
              className="hidden"
            />
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Full name *"
              className={cn(
                "rounded-xl border px-3 py-2 text-xs outline-none",
                isGlass ? cn(theme!.border, theme!.surface) : "border-border bg-background",
              )}
            />
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Unique @username (optional)"
              className={cn(
                "rounded-xl border px-3 py-2 text-xs outline-none",
                isGlass ? cn(theme!.border, theme!.surface) : "border-border bg-background",
              )}
            />
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (8+ chars) *"
              className={cn(
                "rounded-xl border px-3 py-2 text-xs outline-none",
                isGlass ? cn(theme!.border, theme!.surface) : "border-border bg-background",
              )}
            />
            <input
              type="text"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Short bio (optional)"
              maxLength={180}
              className={cn(
                "rounded-xl border px-3 py-2 text-xs outline-none",
                isGlass ? cn(theme!.border, theme!.surface) : "border-border bg-background",
              )}
            />
          </div>

          {info?.canCreateByEmail && info?.canCreateByPhone && (
            <label className="block text-xs">
              <span className="mb-1 block font-semibold">Attach verified contact:</span>
              <select
                value={linkBy}
                onChange={(e) => setLinkBy(e.target.value as "auto" | "email" | "phone" | "both")}
                className={cn(
                  "w-full rounded-xl border px-3 py-2 text-xs outline-none",
                  isGlass ? cn(theme!.border, theme!.surface) : "border-border bg-background",
                )}
              >
                <option value="both">Both Gmail &amp; Phone</option>
                <option value="email">Verified Gmail only</option>
                <option value="phone">Verified Phone only</option>
              </select>
            </label>
          )}

          <button
            type="submit"
            disabled={creating}
            className={cn(
              "press min-h-[40px] w-full rounded-xl px-4 text-xs font-bold disabled:opacity-50",
              isGlass ? theme!.accentBg : "bg-brand text-primary-foreground",
            )}
          >
            {creating ? "Creating Account…" : "Create & Switch to New Account"}
          </button>
        </form>
      )}
    </section>
  );
}
