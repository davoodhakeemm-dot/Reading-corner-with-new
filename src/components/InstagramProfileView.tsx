import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  BookOpen,
  Camera,
  Check,
  CheckCircle2,
  Compass,
  Eye,
  EyeOff,
  Film,
  Grid3X3,
  KeyRound,
  Library,
  LogOut,
  MessageCircle,
  Nfc,
  Palette,
  Phone,
  Plus,
  Settings,
  ShieldCheck,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { BookCover } from "@/components/BookCover";
import { MediaLightbox } from "@/components/InstagramChatView";
import { LinkedAccountsCard } from "@/components/LinkedAccountsCard";
import { PersonalLinkCard } from "@/components/PersonalLinkCard";
import { ProtectedImage, ProtectedVideo } from "@/components/ProtectedMedia";
import { CopyPersonalLinkButton, GoToReadingButton } from "@/components/SecretPageActions";
import { DevicePermissionsCard } from "@/components/StartupPermissionsPrompt";
import { bookById } from "@/lib/books";
import {
  changePassword,
  deleteAccount,
  deleteGalleryMedia,
  fetchGallery,
  fetchNfcLink,
  getFreshGoogleReauthToken,
  initialsOf,
  loadBlocks,
  logout,
  sendOtp,
  setSecretTheme,
  setSoundEnabled,
  unblockUser,
  updateMyProfile,
  uploadAvatar,
  uploadChatMedia,
  useChat,
  verifyMyPhoneOtp,
} from "@/lib/chat-store";
import { progressPercent, useLibrary } from "@/lib/library-store";
import { SECRET_THEMES, type SecretThemeId, type SecretThemeTokens } from "@/lib/secret-themes";
import { cn } from "@/lib/utils";
import { playWaterSound } from "@/lib/water-sound";

export type ProfileSection = "gallery" | "nfc" | "theme" | "settings";

export function InstagramProfileView({
  theme,
  initialSection = "gallery",
  onBackToChat,
  onOpenDiscover,
}: {
  theme: SecretThemeTokens;
  initialSection?: ProfileSection;
  onBackToChat?: () => void;
  onOpenDiscover?: () => void;
}) {
  const navigate = useNavigate();
  const { me, gallery, blockedUsers, soundEnabled, otpConfigured } = useChat();
  const { state: libraryState, syncing: librarySyncing } = useLibrary();

  const [section, setSection] = useState<ProfileSection>(initialSection);
  const [editingProfile, setEditingProfile] = useState(false);
  const [fullName, setFullName] = useState("");
  const [displayHandle, setDisplayHandle] = useState("");
  const [bio, setBio] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [lightbox, setLightbox] = useState<{
    id: string;
    url: string;
    kind: "image" | "video";
    name: string;
    mine: boolean;
  } | null>(null);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingMediaId, setDeletingMediaId] = useState<string | null>(null);

  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [pwGoogleToken, setPwGoogleToken] = useState<string | null>(null);
  const [pwdBusy, setPwdBusy] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteGoogleToken, setDeleteGoogleToken] = useState<string | null>(null);
  const [deleteSecurityKey, setDeleteSecurityKey] = useState("");
  const [showDeleteKey, setShowDeleteKey] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);

  const [verifyOtpCode, setVerifyOtpCode] = useState("");
  const [verifyOtpSent, setVerifyOtpSent] = useState(false);

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    if (me) {
      setFullName(me.fullName);
      setDisplayHandle(me.displayHandle.replace(/^@/, ""));
      setBio(me.bio);
    }
  }, [me]);

  useEffect(() => {
    void Promise.all([fetchNfcLink(), fetchGallery(), loadBlocks()]);
  }, []);

  const continueBook = useMemo(() => {
    const entries = Object.entries(libraryState.progress).sort((a, b) =>
      b[1].updatedAt.localeCompare(a[1].updatedAt),
    );
    for (const [bookId, prog] of entries) {
      const book = bookById(bookId);
      if (book) return { book, prog };
    }
    return null;
  }, [libraryState.progress]);

  if (!me) return null;

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await uploadAvatar(file);
      toast.success("Profile photo updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update photo.");
    }
  }

  async function handleGalleryUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    const validFiles = files.filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/"),
    );
    if (validFiles.length === 0) {
      toast.error("Please choose a real image or video file from your device.");
      return;
    }

    setUploadingGallery(true);
    let uploadedCount = 0;
    const failures: string[] = [];
    try {
      for (const file of validFiles) {
        try {
          await uploadChatMedia(file);
          uploadedCount += 1;
        } catch (error) {
          failures.push(error instanceof Error ? error.message : `Could not upload ${file.name}.`);
        }
      }
      if (uploadedCount > 0) await fetchGallery();
      if (failures.length === 0) {
        toast.success(
          uploadedCount === 1
            ? "Added to your personal gallery"
            : `Added ${uploadedCount} items to your personal gallery`,
        );
      } else if (uploadedCount > 0) {
        toast.warning(`${uploadedCount} item(s) added. ${failures.length} could not be uploaded.`);
      } else {
        toast.error(failures[0] ?? "Upload failed.");
      }
    } finally {
      setUploadingGallery(false);
    }
  }

  async function handleDeleteGalleryItem(mediaId: string) {
    setDeletingMediaId(mediaId);
    try {
      await deleteGalleryMedia(mediaId);
      setConfirmDeleteId((prev) => (prev === mediaId ? null : prev));
      setLightbox((prev) => (prev?.id === mediaId ? null : prev));
      toast.success("Removed from your gallery");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete media.");
    } finally {
      setDeletingMediaId(null);
    }
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await updateMyProfile({ fullName, bio, displayHandle });
      setEditingProfile(false);
      toast.success("Profile saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save profile.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleThemeSelect(id: SecretThemeId) {
    try {
      await setSecretTheme(id);
      toast.success(`${SECRET_THEMES[id].name} theme saved`);
    } catch {
      toast.error("Could not save theme preference.");
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPwd.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    setPwdBusy(true);
    try {
      await changePassword(currentPwd, newPwd, pwGoogleToken || undefined);
      setCurrentPwd("");
      setNewPwd("");
      setPwGoogleToken(null);
      toast.success("Password updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change password.");
    } finally {
      setPwdBusy(false);
    }
  }

  async function handleDeleteAccountConfirm() {
    setDeleteError("");
    if (!deletePassword && !deleteGoogleToken) {
      setDeleteError("Enter your current password or verify with Google first.");
      return;
    }
    if (!deleteSecurityKey.trim()) {
      setDeleteError("Enter the deletion security key.");
      return;
    }
    setDeletingAccount(true);
    try {
      await deleteAccount({
        ...(deletePassword ? { password: deletePassword } : {}),
        ...(deleteGoogleToken ? { firebaseIdToken: deleteGoogleToken } : {}),
        securityKey: deleteSecurityKey.trim(),
      });
      setShowDeleteModal(false);
      toast.success("Account permanently deleted.");
      navigate({ to: "/auth", replace: true });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Deletion failed.");
    } finally {
      setDeletingAccount(false);
    }
  }

  async function handleSendPhoneVerifyOtp() {
    if (!me?.phoneE164) return;
    try {
      await sendOtp({ phone: me.phoneE164, countryCode: "+91", purpose: "verify_phone" });
      setVerifyOtpSent(true);
      toast.success("Verification code sent to your phone");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send verification OTP.");
    }
  }

  async function handleConfirmPhoneOtp() {
    try {
      await verifyMyPhoneOtp(verifyOtpCode);
      setVerifyOtpCode("");
      setVerifyOtpSent(false);
      toast.success("Phone number verified");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed.");
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-5 pb-36 md:px-8 md:py-7 md:pb-24">
      <div className="mx-auto max-w-3xl space-y-5">
        {/* Top Profile Utility Bar with Back to Chat */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={() => {
              if (onBackToChat) {
                onBackToChat();
              } else {
                navigate({ to: "/messages" });
              }
            }}
            className={cn(
              "glass-sheen inline-flex min-h-[42px] items-center gap-2 rounded-full border px-4 text-xs font-bold transition hover:scale-[1.02]",
              theme.glassPill,
            )}
          >
            <ArrowLeft className="size-4" />
            <MessageCircle className="size-3.5" />
            <span>Back to Chat</span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <CopyPersonalLinkButton theme={theme} size="sm" label="Copy Link" />
            {me.isAdmin && (
              <Link
                to="/control"
                className={cn(
                  "glass-sheen inline-flex min-h-[42px] items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-4 text-xs font-bold text-emerald-500 transition hover:scale-[1.02]",
                )}
              >
                <ShieldCheck className="size-4" />
                <span>CONTROL</span>
              </Link>
            )}
            {onOpenDiscover ? (
              <button
                type="button"
                onClick={onOpenDiscover}
                className={cn(
                  "glass-sheen inline-flex min-h-[42px] items-center gap-1.5 rounded-full border px-4 text-xs font-bold transition hover:scale-[1.02]",
                  theme.glassPill,
                )}
              >
                <Compass className="size-4" />
                <span>Discover</span>
              </button>
            ) : (
              <Link
                to="/discover-users"
                className={cn(
                  "glass-sheen inline-flex min-h-[42px] items-center gap-1.5 rounded-full border px-4 text-xs font-bold transition hover:scale-[1.02]",
                  theme.glassPill,
                )}
              >
                <Compass className="size-4" />
                <span>Discover</span>
              </Link>
            )}
          </div>
        </div>

        {/* Instagram-style Glass Profile Header */}
        <div
          className={cn(
            "rounded-3xl border p-5 backdrop-blur-xl",
            theme.surfaceGlass,
            theme.border,
            theme.cardShadow,
          )}
        >
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              aria-label="Change profile photo"
              className="relative mx-auto shrink-0 sm:mx-0"
            >
              <span className={cn("block rounded-full p-[3px]", theme.ringGradient)}>
                <span
                  className={cn(
                    "grid size-24 place-items-center overflow-hidden rounded-full font-display text-2xl font-extrabold",
                    theme.surface,
                  )}
                >
                  {me.avatarUrl ? (
                    <img
                      src={me.avatarUrl}
                      alt={me.fullName}
                      referrerPolicy="no-referrer"
                      className="size-full object-cover"
                    />
                  ) : (
                    initialsOf(me.fullName)
                  )}
                </span>
              </span>
              <span
                className={cn(
                  "absolute bottom-0 right-0 grid size-8 place-items-center rounded-full border-2 border-white shadow",
                  theme.accentBg,
                )}
              >
                <Camera className="size-4" />
              </span>
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => void handleAvatarChange(e)}
              className="hidden"
            />

            <div className="min-w-0 flex-1 text-center sm:text-left">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <h1 className="truncate font-display text-2xl font-extrabold">{me.fullName}</h1>
                <span className={cn("text-xs font-semibold", theme.mutedText)}>
                  {me.displayHandle}
                </span>
                <span className={cn("font-mono text-[11px] opacity-75", theme.mutedText)}>
                  ID: {me.id}
                </span>
              </div>

              <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2 text-xs sm:justify-start">
                {me.email && <span className={cn("font-medium", theme.mutedText)}>{me.email}</span>}
                {(me.phoneE164 || me.phoneMasked) && (
                  <>
                    {me.email && <span aria-hidden="true">·</span>}
                    <span
                      className={cn("inline-flex items-center gap-1 font-medium", theme.mutedText)}
                    >
                      <Phone className="size-3.5" />
                      {me.phoneE164 ?? me.phoneMasked}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 font-semibold",
                        me.phoneVerified ? "text-emerald-600" : "text-amber-600",
                      )}
                    >
                      {me.phoneVerified ? (
                        <>
                          <CheckCircle2 className="size-3.5" /> Verified
                        </>
                      ) : (
                        "Unverified"
                      )}
                    </span>
                  </>
                )}
              </div>

              <div className="mt-2.5 flex items-center justify-center gap-4 text-xs font-bold tabular-nums sm:justify-start">
                <span>
                  {me.followerCount ?? 0}{" "}
                  <span className={cn("font-medium", theme.mutedText)}>Followers</span>
                </span>
                <span>
                  {me.followingCount ?? 0}{" "}
                  <span className={cn("font-medium", theme.mutedText)}>Following</span>
                </span>
              </div>

              {me.bio && <p className="mt-2.5 text-sm leading-relaxed">{me.bio}</p>}

              <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
                <button
                  type="button"
                  onClick={() => setEditingProfile((s) => !s)}
                  className={cn(
                    "min-h-[40px] rounded-full border px-4 py-2 text-xs font-bold transition",
                    theme.glassRow,
                  )}
                >
                  {editingProfile ? "Cancel Edit" : "Edit Profile"}
                </button>
                <button
                  type="button"
                  onClick={() => setSection("nfc")}
                  className={cn(
                    "glass-sheen inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold shadow-sm transition hover:scale-[1.02]",
                    theme.accentBg,
                  )}
                >
                  <Nfc className="size-3.5" /> Personal NFC Link
                </button>
              </div>
            </div>
          </div>

          {editingProfile && (
            <form
              onSubmit={(e) => void handleSaveProfile(e)}
              className={cn("mt-5 space-y-3 border-t pt-5", theme.border)}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className={cn("mb-1 block text-xs font-semibold", theme.mutedText)}>
                    Full Name
                  </span>
                  <input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className={cn(
                      "w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none",
                      theme.border,
                      theme.surfaceMuted,
                    )}
                  />
                </label>
                <label className="block">
                  <span className={cn("mb-1 block text-xs font-semibold", theme.mutedText)}>
                    Display Handle
                  </span>
                  <input
                    value={displayHandle}
                    onChange={(e) => setDisplayHandle(e.target.value)}
                    className={cn(
                      "w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none",
                      theme.border,
                      theme.surfaceMuted,
                    )}
                  />
                </label>
              </div>
              <label className="block">
                <span className={cn("mb-1 block text-xs font-semibold", theme.mutedText)}>Bio</span>
                <textarea
                  rows={2}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className={cn(
                    "w-full resize-none rounded-xl border px-3.5 py-2.5 text-sm outline-none",
                    theme.border,
                    theme.surfaceMuted,
                  )}
                />
              </label>
              <button
                type="submit"
                disabled={savingProfile}
                className={cn(
                  "min-h-[42px] rounded-xl px-5 py-2 text-xs font-bold",
                  theme.accentBg,
                )}
              >
                {savingProfile ? "Saving…" : "Save Personal Info"}
              </button>
            </form>
          )}
        </div>

        {/* Account-Synced My Reading Shelf */}
        <div
          className={cn(
            "rounded-3xl border p-5 backdrop-blur-xl",
            theme.surfaceGlass,
            theme.border,
            theme.cardShadow,
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-extrabold">My Reading Corner Shelf</h2>
              <p className={cn("text-xs", theme.mutedText)}>
                {librarySyncing
                  ? "Syncing reading progress…"
                  : `${libraryState.favorites.length} favorites · ${libraryState.bookmarks.length} bookmarks · ${libraryState.completed.length} completed`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/explore"
                className={cn(
                  "inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border px-3 text-xs font-bold",
                  theme.border,
                  theme.surfaceMuted,
                )}
              >
                <Compass className="size-3.5" /> Explore Books
              </Link>
              <Link
                to="/library"
                className={cn(
                  "inline-flex min-h-[36px] items-center gap-1.5 rounded-xl px-3 text-xs font-bold",
                  theme.accentBg,
                )}
              >
                <Library className="size-3.5" /> Saved Library
              </Link>
            </div>
          </div>

          {continueBook && (
            <div
              className={cn(
                "mt-4 flex items-center gap-3.5 rounded-2xl border p-3",
                theme.border,
                theme.surfaceMuted,
              )}
            >
              <Link
                to="/book/$bookId"
                params={{ bookId: continueBook.book.id }}
                className="w-12 shrink-0"
              >
                <BookCover book={continueBook.book} size="sm" />
              </Link>
              <div className="min-w-0 flex-1">
                <p
                  className={cn("text-[10px] font-bold uppercase tracking-wider", theme.accentText)}
                >
                  Continue Reading ·{" "}
                  {progressPercent(continueBook.prog.page, continueBook.prog.pages)}%
                </p>
                <p className="truncate font-display text-sm font-extrabold">
                  {continueBook.book.title}
                </p>
                <p className={cn("truncate text-xs", theme.mutedText)}>
                  {continueBook.book.author} · Page {continueBook.prog.page + 1} of{" "}
                  {continueBook.prog.pages}
                </p>
              </div>
              <Link
                to="/read/$bookId"
                params={{ bookId: continueBook.book.id }}
                className={cn(
                  "inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-xs font-bold",
                  theme.accentBg,
                )}
              >
                <BookOpen className="size-3.5" /> Resume
              </Link>
            </div>
          )}
        </div>

        {/* Profile Sub-navigation (Gallery, NFC Card, Theme, Settings) */}
        <div
          className={cn(
            "grid grid-cols-4 gap-1.5 rounded-full border p-1.5 backdrop-blur-2xl",
            theme.surfaceGlass,
          )}
        >
          {(
            [
              { id: "gallery", label: "Gallery", icon: Grid3X3 },
              { id: "nfc", label: "NFC Card", icon: Nfc },
              { id: "theme", label: "Themes", icon: Palette },
              { id: "settings", label: "Settings", icon: Settings },
            ] as const
          ).map(({ id, label, icon: Icon }) => {
            const active = section === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={cn(
                  "relative flex min-h-[44px] items-center justify-center gap-1.5 rounded-full px-2 text-xs font-bold transition-colors",
                  active ? "text-white" : theme.mutedText,
                )}
              >
                {active && (
                  <motion.span
                    layoutId="profileSectionPill"
                    transition={{ type: "spring", stiffness: 360, damping: 28 }}
                    className={cn("glass-sheen absolute inset-0 rounded-full", theme.navActiveBg)}
                  />
                )}
                <Icon className="relative z-10 size-4 shrink-0" />
                <span className="relative z-10 truncate">{label}</span>
              </button>
            );
          })}
        </div>

        {/* Section 1: Private Media Gallery */}
        {section === "gallery" && (
          <motion.section
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "rounded-3xl border p-5 backdrop-blur-xl",
              theme.surfaceGlass,
              theme.border,
              theme.cardShadow,
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold">Gallery</h2>
                <p className={cn("text-xs", theme.mutedText)}>
                  Your private photos and videos. Add multiple files at once (up to 25 MB each).
                </p>
              </div>
              <button
                type="button"
                disabled={uploadingGallery}
                onClick={() => galleryInputRef.current?.click()}
                className={cn(
                  "inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition disabled:opacity-60",
                  theme.accentBg,
                )}
              >
                <Plus className="size-4" />
                {uploadingGallery ? "Uploading…" : "Add Photo / Video"}
              </button>
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={(e) => void handleGalleryUpload(e)}
                className="hidden"
              />
            </div>

            {gallery.length > 0 ? (
              <div className="mt-4 grid grid-cols-3 gap-1.5 sm:gap-2.5">
                {gallery.map((item) => {
                  const confirming = confirmDeleteId === item.id;
                  const deleting = deletingMediaId === item.id;
                  return (
                    <div
                      key={item.id}
                      data-testid={`gallery-item-${item.id}`}
                      className="group relative aspect-square overflow-hidden rounded-xl bg-black/10"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setLightbox({
                            id: item.id,
                            url: item.url,
                            kind: item.kind,
                            name: item.originalName,
                            mine: item.mine,
                          })
                        }
                        aria-label={`View ${item.originalName}`}
                        className="block size-full"
                      >
                        {item.kind === "image" ? (
                          <ProtectedImage
                            src={item.url}
                            alt={item.originalName}
                            className="size-full object-cover transition duration-200 group-hover:scale-105"
                          />
                        ) : (
                          <>
                            <ProtectedVideo src={item.url} className="size-full object-cover" />
                            <span className="absolute left-2 top-2 grid size-7 place-items-center rounded-full bg-black/65 text-white">
                              <Film className="size-3.5" />
                            </span>
                          </>
                        )}
                      </button>

                      {item.mine && !confirming && (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(item.id)}
                          aria-label={`Delete ${item.originalName}`}
                          title="Delete from gallery"
                          className="absolute right-1.5 top-1.5 z-10 grid size-8 place-items-center rounded-full bg-black/65 text-white shadow-sm backdrop-blur-sm transition hover:bg-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}

                      {item.mine && confirming && (
                        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 bg-black/80 p-2 text-center text-white backdrop-blur-sm">
                          <p className="text-[11px] font-bold leading-tight">
                            Delete this {item.kind}?
                          </p>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={deleting}
                              onClick={() => void handleDeleteGalleryItem(item.id)}
                              className="min-h-[30px] rounded-lg bg-rose-600 px-2.5 text-[11px] font-bold text-white transition hover:bg-rose-500 disabled:opacity-50"
                            >
                              {deleting ? "…" : "Delete"}
                            </button>
                            <button
                              type="button"
                              disabled={deleting}
                              onClick={() => setConfirmDeleteId(null)}
                              aria-label="Cancel delete"
                              className="grid size-7 place-items-center rounded-lg bg-white/15 text-white transition hover:bg-white/25"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={cn("mt-5 rounded-2xl p-8 text-center", theme.surfaceMuted)}>
                <Grid3X3 className={cn("mx-auto size-8 opacity-40", theme.mutedText)} />
                <p className="mt-2 text-sm font-bold">Your gallery is empty</p>
                <p className={cn("mt-1 text-xs", theme.mutedText)}>
                  Photos and videos you upload from your device or share in chat stay protected to
                  your account.
                </p>
              </div>
            )}
          </motion.section>
        )}

        {/* Section 2: Personal NFC Card, QR Code & Linked Accounts */}
        {section === "nfc" && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <PersonalLinkCard variant="glass" theme={theme} />
            <LinkedAccountsCard variant="glass" theme={theme} />
          </motion.div>
        )}

        {/* Section 3: Three Secret-Page Themes */}
        {section === "theme" && (
          <motion.section
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "space-y-4 rounded-3xl border p-5 backdrop-blur-xl",
              theme.surfaceGlass,
              theme.border,
              theme.cardShadow,
            )}
          >
            <div>
              <h2 className="font-display text-lg font-bold">Secret Page Themes</h2>
              <p className={cn("text-xs", theme.mutedText)}>
                Saved to your account and synced across all your devices.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {(Object.keys(SECRET_THEMES) as SecretThemeId[]).map((id) => {
                const t = SECRET_THEMES[id];
                const selected = me.theme === id;
                const isLiquidCard = id === "emerald";
                return (
                  <motion.button
                    key={id}
                    type="button"
                    whileHover={{ y: -3, scale: 1.015 }}
                    whileTap={{ scale: 0.97 }}
                    transition={{ type: "spring", stiffness: 400, damping: 20 }}
                    onClick={() => {
                      playWaterSound("pop", soundEnabled);
                      void handleThemeSelect(id);
                    }}
                    className={cn(
                      "flex flex-col rounded-2xl border p-4 text-left transition",
                      selected ? "ring-2 ring-offset-1" : "opacity-88 hover:opacity-100",
                      isLiquidCard
                        ? "liquid-glass-iridescent border-white/85 text-[#1f1b38]"
                        : cn(theme.border, theme.surfaceMuted),
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-base font-bold">{t.name}</span>
                      {selected && (
                        <span
                          className={cn("grid size-6 place-items-center rounded-full", t.accentBg)}
                        >
                          <Check className="size-3.5" />
                        </span>
                      )}
                    </div>
                    <p
                      className={cn(
                        "mt-1 flex-1 text-xs leading-relaxed",
                        isLiquidCard ? "text-[#484366]" : theme.mutedText,
                      )}
                    >
                      {t.description}
                    </p>
                    <div className="mt-3 flex gap-1.5">
                      {t.swatches.map((hex) => (
                        <span
                          key={hex}
                          className="h-5 flex-1 rounded-md border border-white/60 shadow-inner"
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </motion.section>
        )}

        {/* Section 4: Settings (Phone verification, Blocked Users, Password, Notifications, Logout) */}
        {section === "settings" && (
          <motion.section
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {/* Phone Verification */}
            {me.phoneE164 && !me.phoneVerified && (
              <div
                className={cn(
                  "rounded-3xl border p-5 backdrop-blur-xl",
                  theme.surfaceGlass,
                  theme.border,
                  theme.cardShadow,
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-base font-bold">Verify Phone Number</h2>
                    <p className={cn("mt-0.5 text-xs", theme.mutedText)}>
                      {otpConfigured
                        ? "Confirm ownership of your phone number via SMS OTP."
                        : "SMS OTP requires Twilio Verify configuration on the server."}
                    </p>
                  </div>
                  {otpConfigured && (
                    <button
                      type="button"
                      onClick={() => void handleSendPhoneVerifyOtp()}
                      className={cn("rounded-xl px-3.5 py-2 text-xs font-bold", theme.accentBg)}
                    >
                      Send OTP
                    </button>
                  )}
                </div>
                {verifyOtpSent && (
                  <div className="mt-3 flex gap-2">
                    <input
                      value={verifyOtpCode}
                      onChange={(e) => setVerifyOtpCode(e.target.value)}
                      placeholder="Enter 6-digit OTP"
                      className={cn(
                        "flex-1 rounded-xl border px-3 py-2 text-sm outline-none",
                        theme.border,
                        theme.surfaceMuted,
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => void handleConfirmPhoneOtp()}
                      className={cn("rounded-xl px-4 py-2 text-xs font-bold", theme.accentBg)}
                    >
                      Verify
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Blocked Users List */}
            <div
              className={cn(
                "rounded-3xl border p-5 backdrop-blur-xl",
                theme.surfaceGlass,
                theme.border,
                theme.cardShadow,
              )}
            >
              <div className="flex items-center gap-2">
                <Ban className="size-4 text-rose-600" />
                <h2 className="font-display text-base font-bold">Blocked Users</h2>
              </div>
              <p className={cn("mt-1 text-xs", theme.mutedText)}>
                Blocked users cannot send you messages or initiate calls. Enforced by the backend.
              </p>

              {blockedUsers.length > 0 ? (
                <div className="mt-4 space-y-2">
                  {blockedUsers.map((u) => (
                    <div
                      key={u.id}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-2xl border px-3.5 py-2.5",
                        theme.border,
                        theme.surfaceMuted,
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">{u.fullName}</p>
                        <p className={cn("truncate text-xs", theme.mutedText)}>{u.displayHandle}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          void unblockUser(u.id).then(() =>
                            toast.success(`Unblocked ${u.fullName}`),
                          )
                        }
                        className={cn(
                          "min-h-[38px] shrink-0 rounded-xl px-3.5 text-xs font-bold",
                          theme.accentBg,
                        )}
                      >
                        Unblock
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={cn("mt-3 text-xs", theme.mutedText)}>No blocked users.</p>
              )}
            </div>

            {/* Notification Sound */}
            <div
              className={cn(
                "rounded-3xl border p-5 backdrop-blur-xl",
                theme.surfaceGlass,
                theme.border,
                theme.cardShadow,
              )}
            >
              <button
                type="button"
                onClick={() => setSoundEnabled(!soundEnabled)}
                className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left"
              >
                <span className="flex items-center gap-2.5">
                  {soundEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
                  <span>
                    <span className="block text-sm font-bold">Message notification sound</span>
                    <span className={cn("block text-xs", theme.mutedText)}>
                      Play an alert chime when new messages arrive
                    </span>
                  </span>
                </span>
                <span
                  className={cn(
                    "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                    soundEnabled ? theme.accentBg : theme.surfaceMuted,
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all",
                      soundEnabled ? "left-[22px]" : "left-0.5",
                    )}
                  />
                </span>
              </button>
            </div>

            {/* Personal Link + QR & Linked Accounts visible inside Settings */}
            <PersonalLinkCard variant="glass" theme={theme} />
            <LinkedAccountsCard variant="glass" theme={theme} />

            {/* Device Permissions */}
            <DevicePermissionsCard theme={theme} />

            {/* Change Password */}
            <form
              onSubmit={(e) => void handleChangePassword(e)}
              className={cn(
                "space-y-3 rounded-3xl border p-5 backdrop-blur-xl",
                theme.surfaceGlass,
                theme.border,
                theme.cardShadow,
              )}
            >
              <div className="flex items-center gap-2">
                <KeyRound className="size-4" />
                <h2 className="font-display text-base font-bold">Change Password</h2>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <input
                  type="password"
                  value={currentPwd}
                  onChange={(e) => setCurrentPwd(e.target.value)}
                  placeholder="Current password"
                  className={cn(
                    "rounded-xl border px-3.5 py-2.5 text-sm outline-none",
                    theme.border,
                    theme.surfaceMuted,
                  )}
                />
                <input
                  type="password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  placeholder="New password (8+ chars)"
                  className={cn(
                    "rounded-xl border px-3.5 py-2.5 text-sm outline-none",
                    theme.border,
                    theme.surfaceMuted,
                  )}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                {me.email && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const tok = await getFreshGoogleReauthToken();
                        setPwGoogleToken(tok);
                        toast.success("Google verified. Enter your new password and click Update.");
                      } catch (err) {
                        toast.error(
                          err instanceof Error ? err.message : "Google verification failed.",
                        );
                      }
                    }}
                    className={cn("text-xs font-bold hover:underline", theme.accentText)}
                  >
                    {pwGoogleToken
                      ? "✓ Google verified"
                      : "Signed in with Google? Verify with Google"}
                  </button>
                )}
                <button
                  type="submit"
                  disabled={pwdBusy}
                  className={cn("min-h-[42px] rounded-xl px-4 text-xs font-bold", theme.accentBg)}
                >
                  {pwdBusy ? "Updating…" : "Update Password"}
                </button>
              </div>
            </form>

            {/* Permanent Single-Account Deletion */}
            <div
              className={cn(
                "space-y-3 rounded-3xl border border-rose-500/35 p-5 backdrop-blur-xl",
                theme.surfaceGlass,
                theme.cardShadow,
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-base font-bold text-rose-500">Delete Account</h2>
                  <p className={cn("mt-0.5 text-xs", theme.mutedText)}>
                    Permanently deletes ONLY this profile ({me.displayHandle}). Sibling accounts on
                    your Gmail/phone stay intact.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDeletePassword("");
                    setDeleteGoogleToken(null);
                    setDeleteSecurityKey("");
                    setDeleteError("");
                    setShowDeleteModal(true);
                  }}
                  className="shrink-0 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-rose-500"
                >
                  Delete Account
                </button>
              </div>
            </div>

            {/* Account Navigation & Sign Out */}
            <div className="grid gap-2.5 sm:grid-cols-2">
              <GoToReadingButton size="md" className="min-h-[46px] w-full" />
              <button
                type="button"
                onClick={() =>
                  void logout().then(() => {
                    navigate({ to: "/auth", replace: true });
                  })
                }
                className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-full bg-rose-600 text-xs font-bold text-white"
              >
                <LogOut className="size-4" /> Log Out
              </button>
            </div>
          </motion.section>
        )}
      </div>

      {showDeleteModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-md">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm Account Deletion"
            className={cn(
              "w-full max-w-md space-y-4 rounded-3xl border p-6 shadow-2xl",
              theme.surfaceGlass,
              theme.border,
            )}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-6 shrink-0 text-rose-500" />
              <div>
                <h3 className="text-lg font-bold text-rose-500">Permanently Delete Account?</h3>
                <p className={cn("mt-1 text-xs leading-relaxed", theme.mutedText)}>
                  This permanently deletes ONLY {me.displayHandle} and its messages, gallery media,
                  and personal link. Sibling accounts remain untouched.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold">
                  1. Account Ownership (Password or Google)
                </label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Enter your account password"
                  className={cn(
                    "w-full rounded-xl border px-3.5 py-2 text-sm outline-none",
                    theme.border,
                    theme.surfaceMuted,
                  )}
                />
                {me.email && (
                  <button
                    type="button"
                    onClick={async () => {
                      setDeleteError("");
                      try {
                        const tok = await getFreshGoogleReauthToken();
                        setDeleteGoogleToken(tok);
                        toast.success("Google verified.");
                      } catch (err) {
                        setDeleteError(
                          err instanceof Error ? err.message : "Google verification failed.",
                        );
                      }
                    }}
                    className={cn("mt-1.5 text-xs font-bold hover:underline", theme.accentText)}
                  >
                    {deleteGoogleToken
                      ? "✓ Google ownership verified"
                      : "Signed in with Google? Verify with Google"}
                  </button>
                )}
              </div>

              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
                  <KeyRound className="size-3.5" /> 2. Deletion Security Key
                </label>
                <div
                  className={cn(
                    "flex items-center rounded-xl border pr-2",
                    theme.border,
                    theme.surfaceMuted,
                  )}
                >
                  <input
                    type={showDeleteKey ? "text" : "password"}
                    value={deleteSecurityKey}
                    onChange={(e) => setDeleteSecurityKey(e.target.value)}
                    placeholder="Enter security key"
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
                  className="rounded-xl bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-500"
                >
                  {deleteError}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={deletingAccount}
                onClick={() => setShowDeleteModal(false)}
                className={cn("rounded-full px-4 py-2 text-xs font-bold", theme.surfaceMuted)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingAccount}
                onClick={() => void handleDeleteAccountConfirm()}
                className="rounded-full bg-rose-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                {deletingAccount ? "Deleting…" : "Confirm Permanent Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      <MediaLightbox
        media={lightbox}
        canDelete={Boolean(lightbox?.mine)}
        onDelete={lightbox ? () => handleDeleteGalleryItem(lightbox.id) : undefined}
        onClose={() => setLightbox(null)}
      />
    </div>
  );
}
