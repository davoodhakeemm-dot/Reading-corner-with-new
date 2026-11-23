import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { InstallApp } from "@/components/InstallApp";
import { RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell, PageHeader } from "@/components/AppShell";
import { DevicePermissionsCard } from "@/components/StartupPermissionsPrompt";
import { removeAllUsersAndData, useChat } from "@/lib/chat-store";
import { useLibrary } from "@/lib/library-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Reading Corner" },
      {
        name: "description",
        content:
          "Control app appearance, reading defaults, notifications, account settings and reset reading data.",
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
  const { me, logout, deleteAccount, sendPasswordReset, changePassword } = useChat();

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-5 sm:px-6">
        <PageHeader title="Settings" subtitle="Appearance, reading defaults, account and data." />

        {me && (
          <Card title="Account Management">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <div>
                  <p className="font-semibold">{me.fullName}</p>
                  <p className="text-xs text-muted-foreground">
                    {me.email ?? me.phoneMasked ?? me.displayHandle}
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

              <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
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
                      toast.success(`Password reset email sent to ${me.email}`);
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
                <button
                  onClick={() => setShowDeleteModal(true)}
                  className="press rounded-full bg-rose-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-rose-500"
                >
                  Delete Account
                </button>
              </div>
            </div>
          </Card>
        )}

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

        <Card title="Data">
          <p className="text-sm text-muted-foreground">
            Your progress, favorites and bookmarks are stored on this device only.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => reset()}
              className="press inline-flex items-center gap-2 rounded-full bg-destructive px-4 py-2 text-xs font-bold text-destructive-foreground"
            >
              <RotateCcw className="size-3.5" /> Reset all reading data
            </button>
            <button
              onClick={async () => {
                if (
                  window.confirm(
                    "Are you sure you want to remove all users and reset the database? All registered accounts and database records will be permanently deleted.",
                  )
                ) {
                  try {
                    await removeAllUsersAndData();
                    toast.success("All users and database records removed.");
                    navigate({ to: "/auth", replace: true });
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Could not remove all users.");
                  }
                }
              }}
              className="press inline-flex items-center gap-2 rounded-full bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-md hover:bg-rose-500"
            >
              <Trash2 className="size-3.5" /> Remove all users &amp; database
            </button>
          </div>
        </Card>
      </div>

      {showDeleteModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-card p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-rose-600">Permanently Delete Account?</h3>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to permanently delete your account? All your profile data, chat
              messages, and personal information will be permanently removed according to our
              data-retention policy. This action cannot be undone.
            </p>
            <div>
              <label className="mb-1 block text-xs font-semibold">
                Enter your password to confirm:
              </label>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-border bg-background px-3.5 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeletePassword("");
                }}
                className="press rounded-full bg-secondary px-4 py-2 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    await deleteAccount(deletePassword);
                    toast.success("Account permanently deleted.");
                    navigate({ to: "/auth", replace: true });
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Deletion failed.");
                  }
                }}
                className="press rounded-full bg-rose-600 px-4 py-2 text-xs font-bold text-white"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {showPasswordModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-card p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold">Change Password</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold">Current Password</label>
                <input
                  type="password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2 text-sm"
                />
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
                onClick={() => {
                  setShowPasswordModal(false);
                  setCurrentPw("");
                  setNewPw("");
                }}
                className="press rounded-full bg-secondary px-4 py-2 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    await changePassword(currentPw, newPw);
                    toast.success("Password changed successfully.");
                    setShowPasswordModal(false);
                    setCurrentPw("");
                    setNewPw("");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Could not change password.");
                  }
                }}
                className="press rounded-full bg-brand px-4 py-2 text-xs font-bold text-primary-foreground"
              >
                Update Password
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
