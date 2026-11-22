import { MessageCircle, Moon, Search, Sun, UserCheck, UserPlus, Users, X } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { CopyPersonalLinkButton } from "@/components/SecretPageActions";
import { UserProfileModal } from "@/components/UserProfileModal";
import { WaterGlowButton } from "@/components/WaterGlowButton";
import {
  discoverUsers,
  followUser,
  formatRelative,
  initialsOf,
  setSecretTheme,
  unfollowUser,
  useChat,
  type PublicAccount,
} from "@/lib/chat-store";
import { resolveWaterButtonVariant, type SecretThemeTokens } from "@/lib/secret-themes";
import { cn } from "@/lib/utils";
import { playWaterSound } from "@/lib/water-sound";

type FilterMode = "all" | "following" | "followers";

export function DiscoverUsersView({
  theme,
  onStartMessage,
}: {
  theme: SecretThemeTokens;
  onStartMessage: (userId: string) => void;
}) {
  const { me, discoveredUsers, soundEnabled } = useChat();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [users, setUsers] = useState<PublicAccount[]>(discoveredUsers);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<PublicAccount | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadList = useCallback(async (q: string, f: FilterMode) => {
    setLoading(true);
    try {
      const list = await discoverUsers(q, f);
      setUsers(list);
    } catch {
      /* keep previous list on transient error */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(
      () => {
        void loadList(query, filter);
      },
      query.trim() ? 220 : 0,
    );
    return () => window.clearTimeout(t);
  }, [query, filter, loadList]);

  // Keep live presence / follow updates synchronized when showing full directory
  useEffect(() => {
    if (!query.trim() && filter === "all" && !loading) {
      setUsers(discoveredUsers);
    }
  }, [discoveredUsers, query, filter, loading]);

  async function handleFollowToggle(user: PublicAccount) {
    if (busyId) return;
    setBusyId(user.id);
    try {
      const res = user.isFollowing ? await unfollowUser(user.id) : await followUser(user.id);
      setUsers((prev) =>
        prev.map((u) =>
          u.id === user.id
            ? { ...u, isFollowing: res.isFollowing, followerCount: res.followerCount }
            : u,
        ),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update follow status.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-5 pb-36 md:px-8 md:py-7 md:pb-24">
      <div className="mx-auto max-w-4xl space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
              Discover Readers
            </h1>
            <p className={cn("mt-0.5 text-xs font-medium sm:text-sm", theme.mutedText)}>
              Find registered accounts, view profiles, follow readers, and start a real-time chat.
            </p>
          </div>

          {me && (
            <div className="flex flex-wrap items-center gap-2">
              <CopyPersonalLinkButton theme={theme} size="sm" label="Copy Personal Link" />
              <WaterGlowButton
                type="button"
                variant={resolveWaterButtonVariant(theme.id, "surface")}
                size="sm"
                sound="pop"
                soundEnabled={soundEnabled}
                onClick={() => void setSecretTheme(theme.isDark ? "instagram" : "dark")}
                aria-label={theme.isDark ? "Switch to light mode" : "Switch to dark mode"}
              >
                {theme.isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
                <span>{theme.isDark ? "Light" : "Dark"}</span>
              </WaterGlowButton>
            </div>
          )}
        </div>

        {/* Search & Filter Bar */}
        <div
          className={cn(
            "space-y-3 rounded-[28px] border p-4 backdrop-blur-2xl",
            theme.id === "emerald" ? "liquid-glass-panel" : theme.surfaceGlass,
            theme.border,
          )}
        >
          <div className="relative">
            <Search
              className={cn(
                "pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2",
                theme.accentText,
              )}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search users by name or @username…"
              aria-label="Search registered users"
              className={cn(
                "w-full rounded-full py-3 pl-11 pr-10 text-sm outline-none transition focus:ring-2 focus:ring-sky-400/40",
                theme.isDark
                  ? "neu-inset-dark text-white"
                  : theme.id === "emerald"
                    ? "liquid-glass-inset text-[#1f1b38]"
                    : "neu-inset-light text-[#1e293b]",
              )}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1.5">
              {(
                [
                  { id: "all", label: "All Users" },
                  { id: "following", label: "Following" },
                  { id: "followers", label: "Followers" },
                ] as const
              ).map((tab) => {
                const active = filter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      playWaterSound("pop", soundEnabled);
                      setFilter(tab.id);
                    }}
                    className={cn(
                      "min-h-[36px] rounded-full px-3.5 py-1.5 text-xs font-bold transition",
                      active ? theme.navActiveBg : cn(theme.surfaceMuted, theme.mutedText),
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <span className={cn("text-xs font-semibold tabular-nums", theme.mutedText)}>
              {loading
                ? "Loading…"
                : `${users.length} ${users.length === 1 ? "reader" : "readers"}`}
            </span>
          </div>
        </div>

        {/* User Directory Grid */}
        {loading && users.length === 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={cn(
                  "h-32 animate-pulse rounded-3xl border",
                  theme.surfaceGlass,
                  theme.border,
                )}
              />
            ))}
          </div>
        ) : users.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {users.map((u, idx) => (
              <motion.div
                key={u.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx * 0.03, 0.25), duration: 0.22 }}
                className={cn(
                  "flex flex-col justify-between gap-3 rounded-[26px] border p-4 backdrop-blur-xl transition",
                  theme.id === "emerald" ? "liquid-glass-panel" : theme.surfaceGlass,
                  theme.border,
                  theme.cardShadow,
                )}
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedUser(u)}
                    aria-label={`View ${u.fullName} profile`}
                    className="relative shrink-0"
                  >
                    <span className={cn("block rounded-full p-[2px]", theme.ringGradient)}>
                      <span
                        className={cn(
                          "grid size-14 place-items-center overflow-hidden rounded-full font-display text-base font-bold",
                          theme.surface,
                        )}
                      >
                        {u.avatarUrl ? (
                          <img
                            src={u.avatarUrl}
                            alt={u.fullName}
                            className="size-full object-cover"
                          />
                        ) : (
                          initialsOf(u.fullName)
                        )}
                      </span>
                    </span>
                    {u.online && (
                      <span
                        title="Online"
                        className="absolute bottom-0 right-0 size-3.5 rounded-full border-2 border-white bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.75)]"
                      />
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedUser(u)}
                        className="truncate text-left font-display text-base font-extrabold hover:underline"
                      >
                        {u.fullName}
                      </button>
                      {u.followsMe && (
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                            theme.surfaceMuted,
                          )}
                        >
                          Follows you
                        </span>
                      )}
                    </div>
                    <p className={cn("truncate text-xs font-medium", theme.mutedText)}>
                      {u.displayHandle} ·{" "}
                      <span className={u.online ? "font-semibold text-emerald-500" : undefined}>
                        {u.online ? "Online" : `Active ${formatRelative(u.lastActiveAt)} ago`}
                      </span>
                    </p>
                    {u.bio && (
                      <p className={cn("mt-1.5 line-clamp-2 text-xs", theme.mutedText)}>{u.bio}</p>
                    )}
                    <p
                      className={cn(
                        "mt-1.5 text-[11px] font-semibold tabular-nums",
                        theme.mutedText,
                      )}
                    >
                      {u.followerCount ?? 0} followers · {u.followingCount ?? 0} following
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  <WaterGlowButton
                    type="button"
                    variant={resolveWaterButtonVariant(theme.id, "surface")}
                    size="sm"
                    sound="pop"
                    soundEnabled={soundEnabled}
                    onClick={() => setSelectedUser(u)}
                    className="px-2"
                  >
                    Profile
                  </WaterGlowButton>
                  <WaterGlowButton
                    type="button"
                    variant={
                      u.isFollowing
                        ? resolveWaterButtonVariant(theme.id, "surface")
                        : resolveWaterButtonVariant(theme.id, "secondary")
                    }
                    size="sm"
                    sound="droplet"
                    soundEnabled={soundEnabled}
                    disabled={busyId === u.id}
                    onClick={() => void handleFollowToggle(u)}
                    className="px-2"
                  >
                    {u.isFollowing ? (
                      <>
                        <UserCheck className="size-3.5" /> Following
                      </>
                    ) : (
                      <>
                        <UserPlus className="size-3.5" /> Follow
                      </>
                    )}
                  </WaterGlowButton>
                  <WaterGlowButton
                    type="button"
                    variant={resolveWaterButtonVariant(theme.id, "primary")}
                    size="sm"
                    sound="droplet"
                    soundEnabled={soundEnabled}
                    onClick={() => onStartMessage(u.id)}
                    className="px-2"
                  >
                    <MessageCircle className="size-3.5" /> Message
                  </WaterGlowButton>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div
            className={cn(
              "rounded-[28px] border p-10 text-center backdrop-blur-xl",
              theme.surfaceGlass,
              theme.border,
            )}
          >
            <Users className={cn("mx-auto size-10 opacity-40", theme.mutedText)} />
            <p className="mt-3 text-sm font-bold">
              {query.trim() ? "No matching users found" : "No other registered users yet"}
            </p>
            <p className={cn("mt-1 text-xs", theme.mutedText)}>
              {query.trim()
                ? "Try searching with another display name or username."
                : "When more readers register an account, they will appear here automatically."}
            </p>
          </div>
        )}
      </div>

      <UserProfileModal
        user={selectedUser}
        theme={theme}
        onClose={() => setSelectedUser(null)}
        onStartMessage={onStartMessage}
        onUserUpdated={(updated) => {
          setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
          setSelectedUser(updated);
        }}
      />
    </div>
  );
}
