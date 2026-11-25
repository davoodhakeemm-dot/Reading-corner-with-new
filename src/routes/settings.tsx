import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { InstallApp } from "@/components/InstallApp";
import {
  AlertTriangle,
  Bell,
  BellOff,
  Eye,
  EyeOff,
  KeyRound,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell, PageHeader } from "@/components/AppShell";
import { LinkedAccountsCard } from "@/components/LinkedAccountsCard";
import { PersonalLinkCard } from "@/components/PersonalLinkCard";
import { DevicePermissionsCard } from "@/components/StartupPermissionsPrompt";
import {
  changePassword,
  deleteAccount,
  getBearerHeaders,
  getFreshGoogleReauthToken,
  logout,
  sendPasswordReset,
  useChat,
} from "@/lib/chat-store";
import { useLibrary } from "@/lib/library-store";
import {
  fetchPushDiagnostics,
  getNotificationPreferences,
  registerDevicePushToken,
  unregisterDevicePushToken,
  updateNotificationPreferences,
  type NotificationPreferences,
  type PushRegistrationStatus,
} from "@/lib/push-notifications";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Reading Corner" },
      {
        name: "description",
        content:
          "Control app appearance, reading defaults, personal link & QR code, linked accounts, and account settings.",
      },
      { property: "og:title", content: "Settings — Reading Corner" },
      { property: "og:description", content: "Tune Reading Corner to the way you read." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const navigate = useNavigate();
  const { state, update, setReader, reset } = useLibrary();
  const { me } = useChat();

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteGoogleToken, setDeleteGoogleToken] = useState<string | null>(null);
  const [deleteSecurityKey, setDeleteSecurityKey] = useState("");
  const [showDeleteKey, setShowDeleteKey] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deletingBusy, setDeletingBusy] = useState(false);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwGoogleToken, setPwGoogleToken] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  const [pushStatus, setPushStatus] = useState<PushRegistrationStatus | null>(null);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>({
    pushEnabled: true,
    messagePreview: true,
    callAlerts: true,
    quietHoursEnabled: false,
  });
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchPushDiagnostics().then((status) => {
      if (active) setPushStatus(status);
    });
    if (me) {
      void getBearerHeaders().then((headers) =>
        getNotificationPreferences(headers).then((prefs) => {
          if (active) setNotifPrefs(prefs);
        }),
      );
    }
    return () => {
      active = false;
    };
  }, [me]);

  async function handleEnableDevicePush() {
    setPushBusy(true);
    try {
      const headers = await getBearerHeaders();
      const res = await registerDevicePushToken(headers);
      const next = await fetchPushDiagnostics();
      setPushStatus(next);
      if (res.ok) {
        toast.success("Push notifications enabled for this device");
      } else {
        toast.info(res.reason || "Could not enable background push on this device.");
      }
    } finally {
      setPushBusy(false);
    }
  }

  async function handleDisableDevicePush() {
    setPushBusy(true);
    try {
      const headers = await getBearerHeaders();
      await unregisterDevicePushToken(headers);
      setPushStatus(await fetchPushDiagnostics());
      toast.success("Device push registration removed");
    } finally {
      setPushBusy(false);
    }
  }

  async function handleUpdateNotifPref(patch: Partial<NotificationPreferences>) {
    const optimistic = { ...notifPrefs, ...patch };
    setNotifPrefs(optimistic);
    const headers = await getBearerHeaders();
    const saved = await updateNotificationPreferences(patch, headers);
    if (saved) {
      setNotifPrefs(saved);
    } else {
      toast.error("Could not update notification preferences.");
    }
  }

  function closeDeleteModal() {
    setShowDeleteModal(false);
    setDeletePassword("");
    setDeleteGoogleToken(null);
    setDeleteSecurityKey("");
    setDeleteError("");
  }

  function closePasswordModal() {
    setShowPasswordModal(false);
    setCurrentPw("");
    setNewPw("");
    setPwGoogleToken(null);
  }

  async function handleGoogleReauthForDelete() {
    setDeleteError("");
    try {
      const tok = await getFreshGoogleReauthToken();
      setDeleteGoogleToken(tok);
      toast.success("Google ownership verified. Enter the deletion security key to continue.");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Google verification failed.");
    }
  }

  async function handleConfirmDeleteAccount() {
    setDeleteError("");
    if (!me?.id.startsWith("fb_") && !deletePassword && !deleteGoogleToken) {
      setDeleteError("Enter your current password or verify with Google first.");
      return;
    }
    if (!deleteSecurityKey.trim()) {
      setDeleteError("Enter the deletion security key.");
      return;
    }
    setDeletingBusy(true);
    try {
      await deleteAccount({
        ...(deletePassword ? { password: deletePassword } : {}),
        ...(deleteGoogleToken ? { firebaseIdToken: deleteGoogleToken } : {}),
        securityKey: deleteSecurityKey.trim(),
      });
      closeDeleteModal();
      toast.success("Account permanently deleted.");
      navigate({ to: "/auth", replace: true });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Deletion failed.");
    } finally {
      setDeletingBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-5 sm:px-6">
        <PageHeader
          title="Settings"
          subtitle="Appearance, reading defaults, personal link and account."
        />

        {me && (
          <Card title="Account Management">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{me.fullName}</p>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-secondary-foreground">
                      {me.displayHandle}
                    </span>
                    {me.isAdmin && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-600">
                        <ShieldCheck className="size-3" /> Admin
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {me.email ?? me.phoneMasked ?? me.displayHandle} · ID: {me.id}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    await logout();
                    toast.success("Signed out successfully.");
                    navigate({ to: "/auth", replace: true });
                  }}
                  className="press rounded-full bg-secondary px-3 py-1.5 text-xs font-bold text-secondary-foreground"
                >
                  Log Out
                </button>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-border/50 pt-2">
                <button
                  onClick={() => setShowPasswordModal(true)}
                  className="press rounded-full bg-secondary px-3.5 py-2 text-xs font-bold text-secondary-foreground"
                >
                  Change Password
                </button>
                <button
                  onClick={async () => {
                    if (!me.email) {
                      toast.error("No email associated with this account for password reset.");
                      return;
                    }
                    try {
                      await sendPasswordReset(me.email);
                      toast.success(`Password reset instructions sent to ${me.email}`);
                    } catch (err) {
                      toast.error(
                        err instanceof Error ? err.message : "Could not send reset email.",
                      );
                    }
                  }}
                  className="press rounded-full bg-secondary px-3.5 py-2 text-xs font-bold text-secondary-foreground"
                >
                  Forgot Password
                </button>
                {me.isAdmin && (
                  <Link
                    to="/control"
                    className="press inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white"
                  >
                    <ShieldCheck className="size-3.5" /> CONTROL Directory
                  </Link>
                )}
                <button
                  onClick={() => {
                    setDeleteSecurityKey("2233");
                    setShowDeleteModal(true);
                  }}
                  className="press rounded-full bg-rose-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-rose-500"
                >
                  Delete Account
                </button>
              </div>
            </div>
          </Card>
        )}

        {me && <PersonalLinkCard variant="surface" />}
        {me && <LinkedAccountsCard variant="surface" />}

        <Card title="Appearance">
          <Row label="App theme">
            <Segmented
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "system", label: "System" },
              ]}
              value={state.appTheme}
              onChange={(v) => update({ appTheme: v as typeof state.appTheme })}
            />
          </Row>
        </Card>

        <Card title="Reading defaults">
          <Row label="Reader theme">
            <Segmented
              options={[
                { value: "light", label: "Light" },
                { value: "sepia", label: "Sepia" },
                { value: "dark", label: "Night" },
              ]}
              value={state.reader.theme}
              onChange={(v) => setReader({ theme: v as typeof state.reader.theme })}
            />
          </Row>
          <Row label="Font">
            <Segmented
              options={[
                { value: "serif", label: "Serif" },
                { value: "sans", label: "Sans" },
              ]}
              value={state.reader.font}
              onChange={(v) => setReader({ font: v as typeof state.reader.font })}
            />
          </Row>
          <Row label="Line spacing">
            <Segmented
              options={[
                { value: "small", label: "Small" },
                { value: "medium", label: "Medium" },
                { value: "large", label: "Large" },
              ]}
              value={state.reader.lineSpacing}
              onChange={(v) => setReader({ lineSpacing: v as typeof state.reader.lineSpacing })}
            />
          </Row>
        </Card>

        <Card title="Notifications">
          {me && (
            <div className="space-y-3 border-b border-border/50 pb-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Chat &amp; Call Push Notifications</p>
                  <p className="text-xs text-muted-foreground">
                    {pushStatus?.activeToken
                      ? `Registered on this device (${pushStatus.registeredDevices} device(s) total).`
                      : "Receive alerts for new messages and incoming calls."}
                  </p>
                </div>
                {pushStatus?.activeToken ? (
                  <button
                    type="button"
                    disabled={pushBusy}
                    onClick={() => void handleDisableDevicePush()}
                    className="press inline-flex items-center gap-1.5 rounded-full bg-secondary px-3.5 py-1.5 text-xs font-bold text-secondary-foreground disabled:opacity-50"
                  >
                    <BellOff className="size-3.5" /> Disable Push
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={pushBusy}
                    onClick={() => void handleEnableDevicePush()}
                    className="press inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
                  >
                    <Bell className="size-3.5" /> {pushBusy ? "Enabling…" : "Enable Push"}
                  </button>
                )}
              </div>

              {pushStatus?.limitationNote && (
                <p className="rounded-xl bg-secondary/70 px-3 py-2 text-xs text-muted-foreground">
                  {pushStatus.limitationNote}
                </p>
              )}

              <Toggle
                label="Allow push notifications for messages"
                checked={notifPrefs.pushEnabled}
                onChange={(v) => void handleUpdateNotifPref({ pushEnabled: v })}
              />
              <Toggle
                label="Show sender and message preview"
                checked={notifPrefs.messagePreview}
                onChange={(v) => void handleUpdateNotifPref({ messagePreview: v })}
              />
              <Toggle
                label="Incoming call notifications"
                checked={notifPrefs.callAlerts}
                onChange={(v) => void handleUpdateNotifPref({ callAlerts: v })}
              />
              <Toggle
                label="Quiet hours (silence push banners)"
                checked={notifPrefs.quietHoursEnabled}
                onChange={(v) => void handleUpdateNotifPref({ quietHoursEnabled: v })}
              />
            </div>
          )}

          <Toggle
            label="Daily reading reminder"
            checked={state.notifications.reminders}
            onChange={(v) => update({ notifications: { ...state.notifications, reminders: v } })}
          />
          <Toggle
            label="New book announcements"
            checked={state.notifications.newBooks}
            onChange={(v) => update({ notifications: { ...state.notifications, newBooks: v } })}
          />
        </Card>

        <Card title="Preferences">
          <div className="flex flex-wrap gap-2">
            <Link
              to="/onboarding/language"
              className="press rounded-full bg-secondary px-4 py-2 text-xs font-bold text-secondary-foreground"
            >
              Change languages
            </Link>
            <Link
              to="/onboarding/categories"
              className="press rounded-full bg-secondary px-4 py-2 text-xs font-bold text-secondary-foreground"
            >
              Change categories
            </Link>
          </div>
        </Card>

        <DevicePermissionsCard />

        <InstallApp />

        <Card title="Reading Data">
          <p className="text-sm text-muted-foreground">
            Resetting local reading data clears progress, favorites, and bookmarks on this profile.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => {
                reset();
                toast.success("Reading data reset.");
              }}
              className="press inline-flex items-center gap-2 rounded-full bg-destructive px-4 py-2 text-xs font-bold text-destructive-foreground"
            >
              <RotateCcw className="size-3.5" /> Reset reading data
            </button>
          </div>
        </Card>
      </div>

      {showDeleteModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm Account Deletion"
            className="w-full max-w-md space-y-4 rounded-3xl bg-card p-6 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-6 shrink-0 text-rose-600" />
              <div>
                <h3 className="text-lg font-bold text-rose-600">Permanently Delete Account?</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  This deletes ONLY this profile ({me?.displayHandle}) — including its messages,
                  media gallery, personal link, and reading state. Linked sibling accounts are NOT
                  removed. This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold">
                  1. Verify Account Ownership (Password or Google)
                </label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Enter your account password"
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2 text-sm outline-none"
                />
                {me?.email && (
                  <button
                    type="button"
                    onClick={() => void handleGoogleReauthForDelete()}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
                  >
                    {deleteGoogleToken
                      ? "✓ Google ownership verified"
                      : "Signed in with Google? Verify with Google instead"}
                  </button>
                )}
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between text-xs font-semibold">
                  <label className="flex items-center gap-1.5">
                    <KeyRound className="size-3.5" /> 2. Deletion Security Key
                  </label>
                  <span className="text-[11px] font-normal text-muted-foreground">
                    Default key: 2233
                  </span>
                </div>
                <div className="flex items-center rounded-xl border border-border bg-background pr-2">
                  <input
                    type={showDeleteKey ? "text" : "password"}
                    value={deleteSecurityKey}
                    onChange={(e) => setDeleteSecurityKey(e.target.value)}
                    placeholder="Enter security key (default: 2233)"
                    aria-label="Deletion security key"
                    className="min-w-0 flex-1 bg-transparent px-3.5 py-2 text-sm outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowDeleteKey((s) => !s)}
                    aria-label={showDeleteKey ? "Hide security key" : "Show security key"}
                    className="grid size-8 place-items-center opacity-70 hover:opacity-100"
                  >
                    {showDeleteKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              {deleteError && (
                <p
                  role="alert"
                  className="rounded-xl bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-600"
                >
                  {deleteError}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={deletingBusy}
                onClick={closeDeleteModal}
                className="press rounded-full bg-secondary px-4 py-2 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingBusy}
                onClick={() => void handleConfirmDeleteAccount()}
                className="press rounded-full bg-rose-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                {deletingBusy ? "Deleting…" : "Confirm Permanent Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPasswordModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-4 rounded-3xl bg-card p-6 shadow-2xl">
            <h3 className="text-lg font-bold">Change Password</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold">
                  Current Password (or Verify with Google)
                </label>
                <input
                  type="password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  placeholder="Current password"
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2 text-sm"
                />
                {me?.email && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const tok = await getFreshGoogleReauthToken();
                        setPwGoogleToken(tok);
                        toast.success("Google verified. Enter your new password below.");
                      } catch (err) {
                        toast.error(
                          err instanceof Error ? err.message : "Google verification failed.",
                        );
                      }
                    }}
                    className="mt-1.5 text-xs font-bold text-primary hover:underline"
                  >
                    {pwGoogleToken ? "✓ Verified with Google" : "Verify with Google instead"}
                  </button>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold">
                  New Password (at least 8 chars)
                </label>
                <input
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={pwBusy}
                onClick={closePasswordModal}
                className="press rounded-full bg-secondary px-4 py-2 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pwBusy}
                onClick={async () => {
                  setPwBusy(true);
                  try {
                    await changePassword(currentPw, newPw, pwGoogleToken || undefined);
                    toast.success("Password changed successfully.");
                    closePasswordModal();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Could not change password.");
                  } finally {
                    setPwBusy(false);
                  }
                }}
                className="press rounded-full bg-brand px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50"
              >
                {pwBusy ? "Updating…" : "Update Password"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl bg-card p-5 shadow-soft sm:p-6">
      <h2 className="mb-4 font-display text-base font-bold sm:text-lg">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex rounded-2xl bg-secondary p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "press rounded-xl px-3.5 py-1.5 text-xs font-bold transition-colors",
            value === o.value
              ? "bg-brand text-primary-foreground shadow-soft"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 rounded border-border accent-brand"
      />
    </label>
  );
}
