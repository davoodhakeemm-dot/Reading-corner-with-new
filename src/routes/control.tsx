import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Check,
  Copy,
  ExternalLink,
  Link2,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell, PageHeader } from "@/components/AppShell";
import { UserProfileModal } from "@/components/UserProfileModal";
import {
  initialsOf,
  searchControlUsers,
  useChat,
  type ControlUserRecord,
  type PublicAccount,
} from "@/lib/chat-store";
import { getSecretTheme } from "@/lib/secret-themes";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/control")({
  head: () => ({
    meta: [
      { title: "CONTROL — Admin Directory — Reading Corner" },
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

  useEffect(() => {
    if (ready && !me) {
      navigate({ to: "/auth", replace: true });
    }
  }, [ready, me, navigate]);

  const runSearch = useCallback(
    async (q: string) => {
      if (!me?.isAdmin) return;
      setLoading(true);
      setError("");
      try {
        const res = await searchControlUsers(q);
        setUsers(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load directory.");
      } finally {
        setLoading(false);
      }
    },
    [me?.isAdmin],
  );

  useEffect(() => {
    if (!ready || !me?.isAdmin) return;
    const t = window.setTimeout(() => {
      void runSearch(query);
    }, 220);
    return () => window.clearTimeout(t);
  }, [ready, me?.isAdmin, query, runSearch]);

  useEffect(() => {
    if (!copiedId) return;
    const t = window.setTimeout(() => setCopiedId(null), 2000);
    return () => window.clearTimeout(t);
  }, [copiedId]);

  if (!ready || !me) {
    return null;
  }

  if (!me.isAdmin) {
    return (
      <AppShell>
        <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
          <div className="rounded-3xl bg-card p-6 text-center shadow-soft space-y-4">
            <ShieldAlert className="mx-auto size-10 text-rose-500" />
            <h1 className="font-display text-xl font-bold">Administrator Access Required</h1>
            <p className="text-sm text-muted-foreground">
              The CONTROL user search directory is restricted to authorized administrators only.
            </p>
            <div className="flex justify-center gap-2">
              <Link
                to="/home"
                className="press rounded-full bg-brand px-4 py-2 text-xs font-bold text-primary-foreground"
              >
                Return Home
              </Link>
              <Link
                to="/settings"
                className="press rounded-full bg-secondary px-4 py-2 text-xs font-bold text-secondary-foreground"
              >
                Settings
              </Link>
            </div>
          </div>
        </div>
      </AppShell>
    );
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

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-5 sm:px-6">
        <PageHeader
          title="CONTROL"
          subtitle="Admin user search & permanent personal link lookup (no sensitive PII exposed)."
          action={
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-600">
              <ShieldCheck className="size-4" /> Admin Access
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
            users.map((u) => {
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

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={!u.personalLink}
                      onClick={() => void handleCopyPersonalLink(u)}
                      className="press inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-secondary px-3.5 text-xs font-bold text-secondary-foreground disabled:opacity-50"
                    >
                      {copiedId === u.id ? (
                        <>
                          <Check className="size-3.5 text-emerald-600" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" /> Copy Personal Link
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedUser(toPublicModalTarget(u))}
                      className="press inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-brand px-3.5 text-xs font-bold text-primary-foreground"
                    >
                      <UserCheck className="size-3.5" /> View Profile
                    </button>
                    {u.personalLink && (
                      <a
                        href={u.personalLink}
                        className="press inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-border px-3 text-xs font-semibold hover:bg-secondary/70"
                        title="Open personal link"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

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
