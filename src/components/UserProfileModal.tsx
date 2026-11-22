import {
  Ban,
  Check,
  Flag,
  MessageCircle,
  Phone,
  UserCheck,
  UserPlus,
  Video,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  blockUser,
  fetchUserProfile,
  followUser,
  formatRelative,
  initialsOf,
  initiateCall,
  reportUser,
  unblockUser,
  unfollowUser,
  type PublicAccount,
} from "@/lib/chat-store";
import type { SecretThemeTokens } from "@/lib/secret-themes";
import { cn } from "@/lib/utils";

const REPORT_REASONS = [
  "Spam or unwanted messages",
  "Harassment or bullying",
  "Inappropriate content",
  "Fake or impersonation account",
  "Other safety concern",
];

export function UserProfileModal({
  user: initialUser,
  theme,
  onClose,
  onStartMessage,
  onUserUpdated,
}: {
  user: PublicAccount | null;
  theme: SecretThemeTokens;
  onClose: () => void;
  onStartMessage: (userId: string) => void;
  onUserUpdated?: (user: PublicAccount) => void;
}) {
  const [profile, setProfile] = useState<PublicAccount | null>(initialUser);
  const [followBusy, setFollowBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState(REPORT_REASONS[0] ?? "Spam or unwanted messages");
  const [details, setDetails] = useState("");
  const [reportBusy, setReportBusy] = useState(false);

  useEffect(() => {
    setProfile(initialUser);
    setReportOpen(false);
    setDetails("");
    if (!initialUser) return;
    let active = true;
    fetchUserProfile(initialUser.id)
      .then((fresh) => {
        if (active) setProfile(fresh);
      })
      .catch(() => {
        /* keep initial snapshot if offline */
      });
    return () => {
      active = false;
    };
  }, [initialUser]);

  if (!profile) return null;

  const isBlocked = Boolean(profile.blockedByMe || profile.blockedMe);

  async function handleToggleFollow() {
    if (!profile || followBusy) return;
    setFollowBusy(true);
    try {
      const res = profile.isFollowing
        ? await unfollowUser(profile.id)
        : await followUser(profile.id);
      const next: PublicAccount = {
        ...profile,
        isFollowing: res.isFollowing,
        followerCount: res.followerCount,
        followingCount: res.followingCount,
      };
      setProfile(next);
      onUserUpdated?.(next);
      toast.success(
        res.isFollowing ? `Following ${profile.fullName}` : `Unfollowed ${profile.fullName}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update follow status.");
    } finally {
      setFollowBusy(false);
    }
  }

  async function handleToggleBlock() {
    if (!profile) return;
    try {
      if (profile.blockedByMe) {
        await unblockUser(profile.id);
        const next = { ...profile, blockedByMe: false };
        setProfile(next);
        onUserUpdated?.(next);
        toast.success(`Unblocked ${profile.fullName}`);
      } else {
        await blockUser(profile.id);
        const next = { ...profile, blockedByMe: true, isFollowing: false };
        setProfile(next);
        onUserUpdated?.(next);
        toast.success(`Blocked ${profile.fullName}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update block status.");
    }
  }

  async function handleSubmitReport(e: React.FormEvent) {
    e.preventDefault();
    if (!profile || reportBusy) return;
    setReportBusy(true);
    try {
      await reportUser(profile.id, reason, details);
      toast.success("Report submitted. Thank you for helping keep Reading Corner safe.");
      setReportOpen(false);
      setDetails("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit report.");
    } finally {
      setReportBusy(false);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-md"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 12 }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={`${profile.fullName} profile`}
          className={cn(
            "relative w-full max-w-md overflow-hidden rounded-[32px] border p-6 backdrop-blur-2xl",
            theme.surfaceGlass,
            theme.border,
          )}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close profile"
            className={cn(
              "absolute right-4 top-4 grid size-9 place-items-center rounded-full transition hover:scale-105",
              theme.surfaceMuted,
            )}
          >
            <X className="size-4" />
          </button>

          <div className="flex flex-col items-center text-center">
            <div className="relative">
              <div className={cn("rounded-full p-[3px]", theme.ringGradient)}>
                <div
                  className={cn(
                    "grid size-24 place-items-center overflow-hidden rounded-full font-display text-2xl font-extrabold",
                    theme.surface,
                  )}
                >
                  {profile.avatarUrl ? (
                    <img
                      src={profile.avatarUrl}
                      alt={profile.fullName}
                      className="size-full object-cover"
                    />
                  ) : (
                    initialsOf(profile.fullName)
                  )}
                </div>
              </div>
              {profile.online && (
                <span
                  title="Online"
                  className="absolute bottom-1 right-1 size-4 rounded-full border-2 border-white bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"
                />
              )}
            </div>

            <h2 className="mt-4 font-display text-xl font-extrabold">{profile.fullName}</h2>
            <p className={cn("text-xs font-semibold", theme.mutedText)}>{profile.displayHandle}</p>

            <div className="mt-1.5 flex items-center gap-2 text-xs">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 font-semibold",
                  profile.online ? "text-emerald-500" : theme.mutedText,
                )}
              >
                <span
                  className={cn(
                    "size-2 rounded-full",
                    profile.online ? "bg-emerald-500" : "bg-current opacity-45",
                  )}
                />
                {profile.online
                  ? "Online now"
                  : `Active ${formatRelative(profile.lastActiveAt)} ago`}
              </span>
              {profile.followsMe && (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold",
                    theme.surfaceMuted,
                  )}
                >
                  Follows you
                </span>
              )}
            </div>

            {profile.bio && <p className="mt-3 max-w-xs text-sm leading-relaxed">{profile.bio}</p>}

            {/* Follower / Following counts */}
            <div
              className={cn(
                "mt-5 grid w-full grid-cols-2 gap-3 rounded-2xl border p-3",
                theme.border,
                theme.surfaceMuted,
              )}
            >
              <div>
                <p className="font-display text-xl font-extrabold tabular-nums">
                  {profile.followerCount ?? 0}
                </p>
                <p className={cn("text-[11px] font-semibold", theme.mutedText)}>Followers</p>
              </div>
              <div>
                <p className="font-display text-xl font-extrabold tabular-nums">
                  {profile.followingCount ?? 0}
                </p>
                <p className={cn("text-[11px] font-semibold", theme.mutedText)}>Following</p>
              </div>
            </div>

            {/* Primary Actions */}
            <div className="mt-5 grid w-full grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={followBusy || isBlocked}
                onClick={() => void handleToggleFollow()}
                className={cn(
                  "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-2xl border px-4 text-xs font-bold transition disabled:opacity-50",
                  profile.isFollowing ? cn(theme.surfaceMuted, theme.border) : theme.accentBg,
                )}
              >
                {profile.isFollowing ? (
                  <>
                    <UserCheck className="size-4" /> Following
                  </>
                ) : (
                  <>
                    <UserPlus className="size-4" /> Follow
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={isBlocked}
                onClick={() => {
                  onClose();
                  onStartMessage(profile.id);
                }}
                className={cn(
                  "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-2xl px-4 text-xs font-bold transition disabled:opacity-50",
                  theme.accentBg,
                )}
              >
                <MessageCircle className="size-4" /> Message
              </button>
            </div>

            <div className="mt-2.5 grid w-full grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={isBlocked}
                onClick={async () => {
                  onClose();
                  try {
                    await initiateCall(profile, "audio");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Cannot initiate audio call.");
                  }
                }}
                className={cn(
                  "inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-2xl border px-3 text-xs font-bold transition disabled:opacity-50",
                  theme.surfaceMuted,
                  theme.border,
                )}
              >
                <Phone className="size-4" /> Audio Call
              </button>
              <button
                type="button"
                disabled={isBlocked}
                onClick={async () => {
                  onClose();
                  try {
                    await initiateCall(profile, "video");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Cannot initiate video call.");
                  }
                }}
                className={cn(
                  "inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-2xl border px-3 text-xs font-bold transition disabled:opacity-50",
                  theme.surfaceMuted,
                  theme.border,
                )}
              >
                <Video className="size-4" /> Video Call
              </button>
            </div>

            {/* Safety Actions */}
            <div className="mt-4 flex w-full items-center justify-center gap-4 pt-1 text-xs">
              <button
                type="button"
                onClick={() => void handleToggleBlock()}
                className="inline-flex items-center gap-1.5 font-semibold text-rose-500 hover:underline"
              >
                <Ban className="size-3.5" />
                {profile.blockedByMe ? "Unblock user" : "Block user"}
              </button>
              <button
                type="button"
                onClick={() => setReportOpen((o) => !o)}
                className={cn(
                  "inline-flex items-center gap-1.5 font-semibold hover:underline",
                  theme.mutedText,
                )}
              >
                <Flag className="size-3.5" /> Report
              </button>
            </div>

            {reportOpen && (
              <form
                onSubmit={(e) => void handleSubmitReport(e)}
                className={cn(
                  "mt-4 w-full space-y-2.5 rounded-2xl border p-3.5 text-left",
                  theme.border,
                  theme.surfaceMuted,
                )}
              >
                <p className="text-xs font-bold">Report {profile.fullName}</p>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className={cn(
                    "w-full rounded-xl border px-3 py-2 text-xs font-medium outline-none",
                    theme.surface,
                    theme.border,
                  )}
                >
                  {REPORT_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <textarea
                  rows={2}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="Optional details…"
                  maxLength={400}
                  className={cn(
                    "w-full resize-none rounded-xl border px-3 py-2 text-xs outline-none",
                    theme.surface,
                    theme.border,
                  )}
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setReportOpen(false)}
                    className="rounded-xl px-3 py-1.5 text-xs font-semibold opacity-75 hover:opacity-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={reportBusy}
                    className="inline-flex items-center gap-1 rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    <Check className="size-3.5" /> {reportBusy ? "Sending…" : "Submit Report"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
