import { Bell, Camera, Check, Mic, ShieldCheck, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  APP_PERMISSION_ITEMS,
  hasPromptedStartupPermissions,
  markStartupPermissionsPrompted,
  queryAllAppPermissions,
  requestAllAppPermissions,
  requestSingleAppPermission,
  shouldShowStartupPermissions,
  type AppPermissionKind,
  type AppPermissionState,
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
    label: "Needed",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  };
}

export function PermissionsList({
  snapshot,
  busyKind,
  onAllowOne,
  theme,
}: {
  snapshot: PermissionSnapshot;
  busyKind: AppPermissionKind | "all" | null;
  onAllowOne: (kind: AppPermissionKind) => void;
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

            {canRequest && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onAllowOne(item.kind)}
                className={cn(
                  "min-h-[34px] shrink-0 rounded-full px-3 text-xs font-bold transition hover:opacity-90 disabled:opacity-50",
                  theme ? theme.accentBg : "bg-brand text-primary-foreground",
                )}
              >
                {busyKind === item.kind ? "Asking…" : "Allow"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function DevicePermissionsCard({ theme }: { theme?: SecretThemeTokens | undefined }) {
  const [snapshot, setSnapshot] = useState<PermissionSnapshot>(INITIAL_SNAPSHOT);
  const [busyKind, setBusyKind] = useState<AppPermissionKind | "all" | null>(null);

  useEffect(() => {
    let active = true;
    void queryAllAppPermissions().then((next) => {
      if (active) setSnapshot(next);
    });
    return () => {
      active = false;
    };
  }, []);

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
        toast.info("Some permissions were blocked. Allow them in your browser site settings.");
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
        toast.success(`${kind.charAt(0).toUpperCase() + kind.slice(1)} allowed`);
      } else if (result === "denied") {
        toast.info(
          `Browser blocked ${kind}. Enable it from your browser address-bar site settings.`,
        );
      }
    } finally {
      setBusyKind(null);
    }
  }

  const allGranted =
    snapshot.microphone === "granted" &&
    snapshot.camera === "granted" &&
    snapshot.notifications === "granted";

  return (
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
          <h2 className="font-display text-base font-bold">Device Permissions</h2>
        </div>
        <button
          type="button"
          disabled={Boolean(busyKind) || allGranted}
          onClick={() => void handleAllowAll()}
          className={cn(
            "min-h-[36px] rounded-full px-3.5 text-xs font-bold transition disabled:opacity-50",
            theme ? theme.accentBg : "bg-brand text-primary-foreground",
          )}
        >
          {busyKind === "all"
            ? "Requesting…"
            : allGranted
              ? "All Allowed"
              : "Allow All Permissions"}
        </button>
      </div>
      <p className={cn("text-xs", theme ? theme.mutedText : "text-muted-foreground")}>
        Manage microphone, camera, and notification access for voice notes, live audio/video calls,
        and message alerts.
      </p>
      <PermissionsList
        snapshot={snapshot}
        busyKind={busyKind}
        onAllowOne={(kind) => void handleAllowOne(kind)}
        theme={theme}
      />
    </section>
  );
}

export function StartupPermissionsPrompt() {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<PermissionSnapshot>(INITIAL_SNAPSHOT);
  const [busyKind, setBusyKind] = useState<AppPermissionKind | "all" | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (hasPromptedStartupPermissions()) return;

    let cancelled = false;
    const isRootSplash = window.location.pathname === "/";
    const timer = window.setTimeout(
      () => {
        void queryAllAppPermissions().then((next) => {
          if (cancelled) return;
          setSnapshot(next);
          if (shouldShowStartupPermissions(next, hasPromptedStartupPermissions())) {
            setOpen(true);
          }
        });
      },
      isRootSplash ? 1400 : 450,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
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
                    Grant microphone, camera, and notification access first
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
