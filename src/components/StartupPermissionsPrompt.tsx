import {
  Bell,
  Camera,
  Check,
  Copy,
  Mic,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Vibrate,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { isVibrationEnabled, setVibrationEnabled } from "@/lib/alerts";
import {
  APP_PERMISSION_ITEMS,
  detectDevicePlatform,
  getMobilePermissionSettingsGuide,
  hasPromptedStartupPermissions,
  markStartupPermissionsPrompted,
  queryAllAppPermissions,
  requestAllAppPermissions,
  requestSingleAppPermission,
  shouldShowStartupPermissions,
  type AppPermissionKind,
  type AppPermissionState,
  type DevicePlatform,
  type PermissionSnapshot,
} from "@/lib/permissions";
import type { SecretThemeTokens } from "@/lib/secret-themes";
import { cn } from "@/lib/utils";

const INITIAL_SNAPSHOT: PermissionSnapshot = {
  microphone: "prompt",
  camera: "prompt",
  notifications: "prompt",
};

function PermissionIcon({ kind }: { kind: AppPermissionKind }) {
  if (kind === "microphone") return <Mic className="size-4" />;
  if (kind === "camera") return <Camera className="size-4" />;
  return <Bell className="size-4" />;
}

function statusBadge(status: AppPermissionState) {
  if (status === "granted") {
    return {
      label: "Allowed",
      className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    };
  }
  if (status === "denied") {
    return {
      label: "Blocked",
      className: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
    };
  }
  if (status === "unsupported") {
    return {
      label: "Unavailable",
      className: "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/25",
    };
  }
  return {
    label: "Not Allowed Yet",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  };
}

export function PermissionsList({
  snapshot,
  busyKind,
  onAllowOne,
  onOpenMobileSettings,
  theme,
}: {
  snapshot: PermissionSnapshot;
  busyKind: AppPermissionKind | "all" | null;
  onAllowOne: (kind: AppPermissionKind) => void;
  onOpenMobileSettings?: () => void;
  theme?: SecretThemeTokens | undefined;
}) {
  return (
    <div className="space-y-2.5">
      {APP_PERMISSION_ITEMS.map((item) => {
        const status = snapshot[item.kind];
        const badge = statusBadge(status);
        const canRequest = status === "prompt" || status === "denied";
        const busy = busyKind === "all" || busyKind === item.kind;
        return (
          <div
            key={item.kind}
            className={cn(
              "flex items-center justify-between gap-3 rounded-2xl border p-3",
              theme
                ? cn(theme.border, theme.surfaceMuted)
                : "border-border bg-secondary/40 text-foreground",
            )}
          >
            <div className="flex min-w-0 items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl",
                  theme ? theme.accentBg : "bg-brand text-primary-foreground",
                )}
              >
                <PermissionIcon kind={item.kind} />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-bold">{item.title}</p>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold",
                      badge.className,
                    )}
                  >
                    {status === "granted" && <Check className="size-2.5" />}
                    {badge.label}
                  </span>
                </div>
                <p
                  className={cn(
                    "mt-0.5 text-xs leading-relaxed",
                    theme ? theme.mutedText : "text-muted-foreground",
                  )}
                >
                  {item.description}
                </p>
              </div>
            </div>

            {status === "denied" && onOpenMobileSettings ? (
              <button
                type="button"
                onClick={onOpenMobileSettings}
                className={cn(
                  "min-h-[34px] shrink-0 rounded-full border px-3 text-xs font-bold transition hover:opacity-90",
                  theme ? cn(theme.border, theme.surface) : "border-border bg-card text-foreground",
                )}
              >
                Mobile Settings
              </button>
            ) : (
              canRequest && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAllowOne(item.kind)}
                  className={cn(
                    "min-h-[34px] shrink-0 rounded-full px-3 text-xs font-bold transition hover:opacity-90 disabled:opacity-50",
                    theme ? theme.accentBg : "bg-brand text-primary-foreground",
                  )}
                >
                  {busyKind === item.kind ? "Asking…" : "Turn On"}
                </button>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

export function MobileSettingsModal({
  open,
  onClose,
  snapshot,
  busyKind,
  onAllowOne,
  onRefresh,
  theme,
}: {
  open: boolean;
  onClose: () => void;
  snapshot: PermissionSnapshot;
  busyKind: AppPermissionKind | "all" | null;
  onAllowOne: (kind: AppPermissionKind) => void;
  onRefresh: () => void;
  theme?: SecretThemeTokens | undefined;
}) {
  const [platform, setPlatform] = useState<DevicePlatform>(() => detectDevicePlatform());
  const guide = getMobilePermissionSettingsGuide(platform);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  async function handleCopyAppLink() {
    if (typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(window.location.origin);
      toast.success("Site link copied — search for it in your Mobile Browser Site Settings.");
    } catch {
      toast.info(`Site URL: ${window.location.origin}`);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[65] flex items-center justify-center bg-black/65 p-4 backdrop-blur-md"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 12 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-settings-title"
            className={cn(
              "max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-[28px] border p-5 shadow-2xl sm:p-6",
              theme
                ? cn(theme.surfaceGlass, theme.border, "backdrop-blur-2xl")
                : "border-border bg-card text-foreground",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-2xl",
                    theme ? theme.accentBg : "bg-brand text-primary-foreground",
                  )}
                >
                  <Smartphone className="size-5" />
                </span>
                <div>
                  <h2 id="mobile-settings-title" className="font-display text-lg font-extrabold">
                    Mobile &amp; App Settings
                  </h2>
                  <p className={cn("text-xs", theme ? theme.mutedText : "text-muted-foreground")}>
                    {guide.subtitle}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close mobile settings"
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-full transition hover:opacity-80",
                  theme ? theme.surfaceMuted : "bg-secondary text-secondary-foreground",
                )}
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Platform selector tabs */}
            <div className="mt-4 grid grid-cols-3 gap-1.5 rounded-2xl bg-black/5 p-1 dark:bg-white/5">
              {(
                [
                  { id: "android", label: "Android" },
                  { id: "ios", label: "iPhone / iPad" },
                  { id: "desktop", label: "Desktop" },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlatform(p.id)}
                  className={cn(
                    "min-h-[34px] rounded-xl text-xs font-bold transition",
                    platform === p.id
                      ? theme
                        ? theme.accentBg
                        : "bg-brand text-primary-foreground shadow-sm"
                      : theme
                        ? theme.mutedText
                        : "text-muted-foreground",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Step-by-step OS / Browser settings guide */}
            <div
              className={cn(
                "mt-4 space-y-2.5 rounded-2xl border p-3.5",
                theme ? cn(theme.border, theme.surfaceMuted) : "border-border bg-secondary/40",
              )}
            >
              <p className="text-xs font-extrabold">{guide.title}</p>
              <ol className="space-y-2 text-xs leading-relaxed">
                {guide.steps.map((step, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span
                      className={cn(
                        "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-extrabold",
                        theme ? theme.accentBg : "bg-brand text-primary-foreground",
                      )}
                    >
                      {idx + 1}
                    </span>
                    <span className={theme ? theme.mutedText : "text-muted-foreground"}>
                      {step}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Turn on permissions on demand */}
            <div className="mt-4 space-y-2">
              <p className="text-xs font-bold">Quick Permission Controls</p>
              <div className="grid grid-cols-3 gap-2">
                {APP_PERMISSION_ITEMS.map((item) => {
                  const status = snapshot[item.kind];
                  const granted = status === "granted";
                  return (
                    <button
                      key={item.kind}
                      type="button"
                      disabled={busyKind !== null || granted}
                      onClick={() => onAllowOne(item.kind)}
                      className={cn(
                        "flex flex-col items-center justify-center gap-1 rounded-2xl border p-2.5 text-center text-[11px] font-bold transition disabled:opacity-65",
                        granted
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : theme
                            ? cn(theme.border, theme.surfaceMuted)
                            : "border-border bg-secondary/50 text-foreground",
                      )}
                    >
                      <PermissionIcon kind={item.kind} />
                      <span>{item.title}</span>
                      <span className="text-[10px] opacity-80">
                        {granted ? "On" : status === "denied" ? "Blocked" : "Tap to On"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleCopyAppLink()}
                className={cn(
                  "inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-full border px-3.5 text-xs font-bold transition hover:opacity-90",
                  theme
                    ? cn(theme.border, theme.surfaceMuted)
                    : "border-border bg-secondary text-secondary-foreground",
                )}
              >
                <Copy className="size-3.5" />
                <span>Copy App Link</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onRefresh();
                  toast.success("Checked latest mobile/browser permissions");
                }}
                className={cn(
                  "inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-full px-3.5 text-xs font-bold transition hover:opacity-95",
                  theme ? theme.accentBg : "bg-brand text-primary-foreground",
                )}
              >
                <RefreshCw className="size-3.5" />
                <span>Re-check Permissions</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function DevicePermissionsCard({ theme }: { theme?: SecretThemeTokens | undefined }) {
  const [snapshot, setSnapshot] = useState<PermissionSnapshot>(INITIAL_SNAPSHOT);
  const [busyKind, setBusyKind] = useState<AppPermissionKind | "all" | null>(null);
  const [vibrationOn, setVibrationOn] = useState<boolean>(() => isVibrationEnabled());
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);

  const refreshPermissions = useCallback(() => {
    void queryAllAppPermissions().then((next) => {
      setSnapshot(next);
    });
  }, []);

  useEffect(() => {
    refreshPermissions();
    const onFocusOrVisible = () => {
      if (document.visibilityState !== "hidden") {
        refreshPermissions();
      }
    };
    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);
    return () => {
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
    };
  }, [refreshPermissions]);

  async function handleAllowAll() {
    if (busyKind) return;
    setBusyKind("all");
    try {
      const next = await requestAllAppPermissions();
      setSnapshot(next);
      markStartupPermissionsPrompted();
      if (next.microphone === "granted" && next.camera === "granted") {
        toast.success("Microphone and camera permissions enabled");
      } else if (next.microphone === "denied" || next.camera === "denied") {
        toast.info("Some permissions are blocked. Tap Open Mobile Settings to allow them.");
        setMobileSettingsOpen(true);
      }
    } finally {
      setBusyKind(null);
    }
  }

  async function handleAllowOne(kind: AppPermissionKind) {
    if (busyKind) return;
    setBusyKind(kind);
    try {
      const result = await requestSingleAppPermission(kind);
      setSnapshot((prev) => ({ ...prev, [kind]: result }));
      markStartupPermissionsPrompted();
      if (result === "granted") {
        toast.success(`${kind.charAt(0).toUpperCase() + kind.slice(1)} turned on`);
      } else if (result === "denied") {
        toast.info(`Browser blocked ${kind}. Open Mobile Settings below to enable it.`);
        setMobileSettingsOpen(true);
      }
    } finally {
      setBusyKind(null);
    }
  }

  function handleToggleVibration() {
    const next = !vibrationOn;
    setVibrationOn(next);
    setVibrationEnabled(next);
    toast.success(next ? "Call & message vibration turned on" : "Vibration alerts turned off");
  }

  const allGranted =
    snapshot.microphone === "granted" &&
    snapshot.camera === "granted" &&
    snapshot.notifications === "granted";

  return (
    <>
      <section
        className={cn(
          "space-y-4 rounded-3xl p-5",
          theme
            ? cn("border backdrop-blur-xl", theme.surfaceGlass, theme.border, theme.cardShadow)
            : "bg-card shadow-soft",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className={cn("size-4", theme ? theme.accentText : "text-brand")} />
            <h2 className="font-display text-base font-bold">
              Device Permissions &amp; Mobile Settings
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileSettingsOpen(true)}
              className={cn(
                "inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3.5 text-xs font-bold transition hover:opacity-90",
                theme
                  ? cn(theme.border, theme.surfaceMuted)
                  : "border-border bg-secondary text-secondary-foreground",
              )}
            >
              <Smartphone className="size-3.5" />
              <span>Open Mobile Settings</span>
            </button>
            <button
              type="button"
              disabled={Boolean(busyKind) || allGranted}
              onClick={() => void handleAllowAll()}
              className={cn(
                "min-h-[36px] rounded-full px-3.5 text-xs font-bold transition disabled:opacity-50",
                theme ? theme.accentBg : "bg-brand text-primary-foreground",
              )}
            >
              {busyKind === "all" ? "Requesting…" : allGranted ? "All Allowed" : "Turn On All"}
            </button>
          </div>
        </div>
        <p className={cn("text-xs", theme ? theme.mutedText : "text-muted-foreground")}>
          Turn on microphone, camera, or notification permissions whenever you need them, or open
          Mobile Settings if a permission was previously blocked.
        </p>

        {/* Vibration alerts toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={vibrationOn}
          onClick={handleToggleVibration}
          className={cn(
            "flex min-h-[48px] w-full items-center justify-between gap-3 rounded-2xl border p-3 text-left transition",
            theme
              ? cn(theme.border, theme.surfaceMuted)
              : "border-border bg-secondary/40 text-foreground",
          )}
        >
          <span className="flex items-center gap-2.5">
            <span
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-xl",
                theme ? theme.accentBg : "bg-brand text-primary-foreground",
              )}
            >
              <Vibrate className="size-4" />
            </span>
            <span>
              <span className="block text-sm font-bold">Call &amp; message vibration</span>
              <span
                className={cn("block text-xs", theme ? theme.mutedText : "text-muted-foreground")}
              >
                Vibrate on incoming calls and unread messages (never while typing)
              </span>
            </span>
          </span>
          <span
            className={cn(
              "relative h-6 w-11 shrink-0 rounded-full transition-colors",
              vibrationOn
                ? theme
                  ? theme.accentBg
                  : "bg-brand"
                : "bg-slate-400/40 dark:bg-white/20",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all",
                vibrationOn ? "left-[22px]" : "left-0.5",
              )}
            />
          </span>
        </button>

        <PermissionsList
          snapshot={snapshot}
          busyKind={busyKind}
          onAllowOne={(kind) => void handleAllowOne(kind)}
          onOpenMobileSettings={() => setMobileSettingsOpen(true)}
          theme={theme}
        />
      </section>

      <MobileSettingsModal
        open={mobileSettingsOpen}
        onClose={() => setMobileSettingsOpen(false)}
        snapshot={snapshot}
        busyKind={busyKind}
        onAllowOne={(kind) => void handleAllowOne(kind)}
        onRefresh={refreshPermissions}
        theme={theme}
      />
    </>
  );
}

export function StartupPermissionsPrompt() {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<PermissionSnapshot>(INITIAL_SNAPSHOT);
  const [busyKind, setBusyKind] = useState<AppPermissionKind | "all" | null>(null);

  useEffect(() => {
    let cancelled = false;
    void queryAllAppPermissions().then((next) => {
      if (cancelled) return;
      setSnapshot(next);
      setOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        markStartupPermissionsPrompted();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function handleDismiss() {
    markStartupPermissionsPrompted();
    setOpen(false);
  }

  async function handleAllowAll() {
    if (busyKind) return;
    setBusyKind("all");
    try {
      const next = await requestAllAppPermissions();
      setSnapshot(next);
      markStartupPermissionsPrompted();

      const remainingPrompt = shouldShowStartupPermissions(next, false);
      if (!remainingPrompt) {
        if (next.microphone === "granted" && next.camera === "granted") {
          toast.success("Permissions ready for calls, voice notes, and chat!");
        }
        setOpen(false);
      }
    } finally {
      setBusyKind(null);
    }
  }

  async function handleAllowOne(kind: AppPermissionKind) {
    if (busyKind) return;
    setBusyKind(kind);
    try {
      const result = await requestSingleAppPermission(kind);
      const next = { ...snapshot, [kind]: result };
      setSnapshot(next);
      if (!shouldShowStartupPermissions(next, false)) {
        markStartupPermissionsPrompted();
        setOpen(false);
      }
    } finally {
      setBusyKind(null);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleDismiss}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 14 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="startup-permissions-title"
            className="relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-[28px] border border-border bg-card p-5 text-foreground shadow-2xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand text-primary-foreground shadow-sm">
                  <ShieldCheck className="size-5" />
                </span>
                <div>
                  <h2
                    id="startup-permissions-title"
                    className="font-display text-lg font-extrabold"
                  >
                    Enable App Permissions
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Choose microphone, camera, and notification access for this app. Tap Allow All
                    to review each Android/browser prompt; permissions already allowed stay enabled
                    until revoked in site settings.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleDismiss}
                aria-label="Close permissions prompt"
                className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground transition hover:opacity-80"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4">
              <PermissionsList
                snapshot={snapshot}
                busyKind={busyKind}
                onAllowOne={(kind) => void handleAllowOne(kind)}
              />
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={Boolean(busyKind)}
                onClick={() => void handleAllowAll()}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full bg-brand px-4 text-sm font-bold text-primary-foreground shadow-sm transition hover:opacity-95 disabled:opacity-50"
              >
                {busyKind === "all" ? "Asking Browser…" : "Allow All Permissions"}
              </button>
              <button
                type="button"
                disabled={Boolean(busyKind)}
                onClick={handleDismiss}
                className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-border bg-secondary px-4 text-xs font-bold text-secondary-foreground transition hover:opacity-85 disabled:opacity-50"
              >
                Skip for now
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
