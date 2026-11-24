import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell, PageHeader } from "@/components/AppShell";
import { UserProfileModal } from "@/components/UserProfileModal";
import {
  initialsOf,
  removeControlUser,
  searchControlUsers,
  useChat,
  type ControlUserRecord,
  type PublicAccount,
} from "@/lib/chat-store";
import { getSecretTheme } from "@/lib/secret-themes";
import { dedupeUsersById } from "@/lib/social-logic";

export const Route = createFileRoute("/control")({
  head: () => ({
    meta: [
      { title: "CONTROL — User Directory — Reading Corner" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ControlPage,
});

async function copyLinkText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fallback */
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.top = "-9999px";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

function ControlPage() {
  const navigate = useNavigate();
  const { ready, me } = useChat();

  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<ControlUserRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<PublicAccount | null>(null);

  const [removeTarget, setRemoveTarget] = useState<ControlUserRecord | null>(null);
  const [removeCode, setRemoveCode] = useState("");
  const [showRemoveCode, setShowRemoveCode] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [removingBusy, setRemovingBusy] = useState(false);

  useEffect(() => {
    if (ready && !me) {
      toast("Sign in to open the CONTROL directory.");
      navigate({ to: "/auth", search: { next: "/control" }, replace: true });
    }
  }, [ready, me, navigate]);

  const runSearch = useCallback(
    async (q: string) => {
      if (!me) return;
      setLoading(true);
      setError("");
      try {
        const res = await searchControlUsers(q);
        setUsers(dedupeUsersById(res));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load directory.");
      } finally {
        setLoading(false);
      }
    },
    [me],
  );

  useEffect(() => {
    if (!ready || !me) return;
    const t = window.setTimeout(() => {
      void runSearch(query);
    }, 200);
    return () => window.clearTimeout(t);
  }, [ready, me, query, runSearch]);

  useEffect(() => {
    if (!copiedId) return;
    const t = window.setTimeout(() => setCopiedId(null), 2000);
    return () => window.clearTimeout(t);
  }, [copiedId]);

  if (!ready || !me) {
    return null;
  }

  const theme = getSecretTheme(me.theme);

  function toPublicModalTarget(u: ControlUserRecord): PublicAccount {
    return {
      id: u.id,
      fullName: u.fullName,
      displayHandle: u.displayHandle,
      bio: u.bio,
      avatarUrl: u.avatarUrl,
      theme: me?.theme ?? "instagram",
      phoneVerified: false,
      lastActiveAt: u.lastActiveAt,
      online: u.online,
    };
  }

  async function handleCopyPersonalLink(u: ControlUserRecord) {
    if (!u.personalLink) {
      toast.error("This user's personal link is currently revoked.");
      return;
    }
    const fullUrl =
      typeof window !== "undefined" ? `${window.location.origin}${u.personalLink}` : u.personalLink;
    const ok = await copyLinkText(fullUrl);
    if (ok) {
      setCopiedId(u.id);
      toast.success(`Copied personal link for ${u.displayHandle}`);
    } else {
      toast.error("Could not copy personal link.");
    }
  }

  function openRemoveModal(u: ControlUserRecord) {
    setRemoveTarget(u);
    setRemoveCode("2233");
    setShowRemoveCode(false);
    setRemoveError("");
  }

  function closeRemoveModal() {
    if (removingBusy) return;
    setRemoveTarget(null);
    setRemoveCode("2233");
    setShowRemoveCode(false);
    setRemoveError("");
  }

  async function handleConfirmRemove(e: React.FormEvent) {
    e.preventDefault();
    if (!removeTarget) return;
    setRemoveError("");
    if (!removeCode.trim()) {
      setRemoveError("Enter the removal security code.");
      return;
    }
    setRemovingBusy(true);
    try {
      const res = await removeControlUser(removeTarget.id, removeCode.trim());
      setUsers((prev) => prev.filter((item) => item.id !== removeTarget.id));
      toast.success(`Removed ${removeTarget.fullName} (${removeTarget.displayHandle})`);
      setRemoveTarget(null);
      setRemoveCode("");
      if (res.selfDeleted) {
        navigate({ to: "/auth", replace: true });
      }
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Could not remove user.");
    } finally {
      setRemovingBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-5 sm:px-6">
        <PageHeader
          title="CONTROL"
          subtitle="View registered users' ID, username, DP, and permanent personal link, or remove an account with the security code."
          action={
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-600">
              <ShieldCheck className="size-4" /> Directory ({users.length})
            </span>
          }
        />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch(query);
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <div className="flex flex-1 items-center gap-2.5 rounded-2xl bg-card px-4 py-2.5 shadow-soft focus-within:ring-2 focus-within:ring-primary/40">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by @username, User ID (u_...), or display name"
              aria-label="Search users in CONTROL directory"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="press rounded-2xl bg-brand px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-soft disabled:opacity-50"
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </form>

        {error && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs font-semibold text-rose-600">
            {error}
          </div>
        )}

        <div className="space-y-3" data-testid="control-results-list">
          {!loading && users.length === 0 ? (
            <div className="rounded-3xl bg-card p-8 text-center shadow-soft">
              <p className="text-sm font-bold">No matching accounts found</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Try another @username, User ID prefix, or clear your search filter.
              </p>
            </div>
          ) : (
            dedupeUsersById(users).map((u) => {
              const fullPersonalUrl =
                u.personalLink && typeof window !== "undefined"
                  ? `${window.location.origin}${u.personalLink}`
                  : u.personalLink;

              return (
                <div
                  key={u.id}
                  data-testid={`control-user-${u.id}`}
                  className="flex flex-col gap-4 rounded-3xl bg-card p-4 shadow-soft sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3.5">
                    <div className="relative shrink-0">
                      <div className="grid size-12 place-items-center overflow-hidden rounded-full bg-brand font-display text-sm font-bold text-primary-foreground">
                        {u.avatarUrl ? (
                          <img
                            src={u.avatarUrl}
                            alt={u.fullName}
                            className="size-full object-cover"
                          />
                        ) : (
                          initialsOf(u.fullName)
                        )}
                      </div>
                      {u.online && (
                        <span
                          title="Online"
                          className="absolute bottom-0 right-0 size-3 rounded-full border-2 border-card bg-emerald-500"
                        />
                      )}
                    </div>

                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-display text-sm font-bold">{u.fullName}</p>
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-secondary-foreground">
                          {u.displayHandle}
                        </span>
                      </div>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        ID: {u.id}
                      </p>
                      <p className="flex items-center gap-1 truncate font-mono text-[11px] text-primary">
                        <Link2 className="size-3 shrink-0" />
                        <span className="truncate">
                          {fullPersonalUrl ?? "Personal link revoked"}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!u.personalLink}
                      aria-label={`Copy personal link for ${u.displayHandle}`}
                      onClick={() => void handleCopyPersonalLink(u)}
                      className="press inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-secondary px-3.5 text-xs font-bold text-secondary-foreground disabled:opacity-50"
                    >
                      {copiedId === u.id ? (
                        <>
                          <Check className="size-3.5 text-emerald-600" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" /> Copy Link
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={`View ${u.fullName} (${u.displayHandle})`}
                      onClick={() => setSelectedUser(toPublicModalTarget(u))}
                      className="press inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-brand px-3.5 text-xs font-bold text-primary-foreground"
                    >
                      <UserCheck className="size-3.5" /> View
                    </button>
                    {u.personalLink && (
                      <a
                        href={u.personalLink}
                        className="press inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-border px-3 text-xs font-semibold hover:bg-secondary/70"
                        title="Open personal link"
                        aria-label={`Open personal link for ${u.displayHandle}`}
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                    <button
                      type="button"
                      aria-label={`Remove ${u.fullName} (${u.displayHandle})`}
                      onClick={() => openRemoveModal(u)}
                      data-testid={`control-remove-${u.id}`}
                      className="press inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 text-xs font-bold text-white hover:bg-rose-500"
                    >
                      <Trash2 className="size-3.5" /> Remove
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {removeTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
          <form
            role="dialog"
            aria-modal="true"
            aria-label="Confirm Remove User"
            onSubmit={handleConfirmRemove}
            className="w-full max-w-md space-y-4 rounded-3xl bg-card p-6 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-6 shrink-0 text-rose-600" />
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-rose-600">Remove User Account?</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  This permanently deletes <strong>{removeTarget.fullName}</strong> (
                  {removeTarget.displayHandle}) and their messages, media gallery, and personal
                  link.
                </p>
                <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                  ID: {removeTarget.id}
                </p>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-xs font-semibold">
                <label className="flex items-center gap-1.5">
                  <KeyRound className="size-3.5" /> Removal Security Code
                </label>
                <span className="text-[11px] font-normal text-muted-foreground">
                  Default code: 2233
                </span>
              </div>
              <div className="flex items-center rounded-xl border border-border bg-background pr-2">
                <input
                  type={showRemoveCode ? "text" : "password"}
                  value={removeCode}
                  onChange={(e) => setRemoveCode(e.target.value)}
                  placeholder="Enter removal code (default: 2233)"
                  aria-label="Removal security code"
                  autoFocus
                  className="min-w-0 flex-1 bg-transparent px-3.5 py-2 text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowRemoveCode((s) => !s)}
                  aria-label={showRemoveCode ? "Hide removal code" : "Show removal code"}
                  className="grid size-8 place-items-center opacity-70 hover:opacity-100"
                >
                  {showRemoveCode ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {removeError && (
              <p
                role="alert"
                className="rounded-xl bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-600"
              >
                {removeError}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={removingBusy}
                onClick={closeRemoveModal}
                className="press rounded-full bg-secondary px-4 py-2 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={removingBusy}
                className="press rounded-full bg-rose-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                {removingBusy ? "Removing…" : "Confirm Remove"}
              </button>
            </div>
          </form>
        </div>
      )}

      <UserProfileModal
        user={selectedUser}
        theme={theme}
        onClose={() => setSelectedUser(null)}
        onStartMessage={(peerId) => {
          navigate({ to: "/messages", search: { peer: peerId } });
        }}
      />
    </AppShell>
  );
}
