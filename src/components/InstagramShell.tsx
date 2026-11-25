import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Compass, MessageCircle, ShieldCheck, User } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

import { DiscoverUsersView } from "@/components/DiscoverUsersView";
import { InstagramChatView } from "@/components/InstagramChatView";
import { InstagramProfileView, type ProfileSection } from "@/components/InstagramProfileView";
import { ReadingActions } from "@/components/ReadingActions";
import { Logo } from "@/components/Logo";
import { TripleTapExit } from "@/components/TripleTapExit";
import { initialsOf, openThread, useChat } from "@/lib/chat-store";
import { getSecretTheme } from "@/lib/secret-themes";
import { cn } from "@/lib/utils";
import { playWaterSound } from "@/lib/water-sound";

export type ShellTab = "chat" | "discover" | "profile";

export function InstagramShell({
  initialTab = "chat",
  initialProfileSection = "gallery",
}: {
  initialTab?: ShellTab;
  initialProfileSection?: ProfileSection;
}) {
  const navigate = useNavigate();
  const { ready, me, nfc, conversations, soundEnabled } = useChat();
  const [tab, setTab] = useState<ShellTab>(initialTab);
  const [threadOpenOnMobile, setThreadOpenOnMobile] = useState(false);

  function selectTab(nextTab: ShellTab) {
    playWaterSound("pop", soundEnabled);
    setTab(nextTab);
  }

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (ready && !me) {
      navigate({ to: "/auth", replace: true });
    }
  }, [ready, me, navigate]);

  const routerSearchStr = useRouterState({
    select: (s) => s.location.searchStr ?? "",
  });

  useEffect(() => {
    if (!ready || !me || typeof window === "undefined") return;
    const params = new URLSearchParams(routerSearchStr || window.location.search);
    const peer = params.get("peer");
    if (peer) {
      setTab("chat");
      void openThread(peer);
    }
  }, [ready, me, routerSearchStr]);

  useEffect(() => {
    if (!ready || !me || typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const onSwMessage = (event: MessageEvent) => {
      const payload = event.data as { type?: string; peerId?: string } | null;
      if (payload?.type === "OPEN_CHAT_THREAD" && payload.peerId) {
        setTab("chat");
        void openThread(payload.peerId);
      }
    };
    navigator.serviceWorker.addEventListener("message", onSwMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onSwMessage);
  }, [ready, me]);

  const totalUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + c.unreadCount, 0),
    [conversations],
  );

  function handleStartMessage(peerId: string) {
    setTab("chat");
    void openThread(peerId);
  }

  if (!ready || !me) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-[#090b12] text-white">
        <div className="text-center">
          <Logo className="mx-auto size-10 animate-pulse" />
          <p className="mt-3 text-xs font-medium text-white/70">Opening Reading Corner…</p>
        </div>
      </div>
    );
  }

  const theme = getSecretTheme(me.theme);

  return (
    <div
      className={cn("relative flex h-[100dvh] flex-col overflow-hidden md:flex-row", theme.pageBg)}
    >
      {/* Ambient studio backdrop + slow-drifting liquid glass light orbs */}
      <div className={cn("pointer-events-none fixed inset-0", theme.ambientBackdrop)} />
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <motion.div
          animate={{
            x: [0, 26, -14, 0],
            y: [0, -18, 22, 0],
            scale: [1, 1.08, 0.96, 1],
          }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
          className={cn(
            "absolute -left-24 -top-24 size-96 rounded-full blur-3xl",
            theme.glassOrbPrimary,
          )}
        />
        <motion.div
          animate={{
            x: [0, -28, 18, 0],
            y: [0, 22, -16, 0],
            scale: [1.04, 0.95, 1.07, 1.04],
          }}
          transition={{ duration: 17, repeat: Infinity, ease: "easeInOut" }}
          className={cn(
            "absolute -bottom-28 -right-24 size-[26rem] rounded-full blur-3xl",
            theme.glassOrbSecondary,
          )}
        />
      </div>
      <TripleTapExit />

      {/* Desktop Left Frosted Glass Navigation Rail */}
      <aside
        className={cn(
          "relative z-10 hidden w-20 shrink-0 flex-col justify-between border-r py-5 backdrop-blur-2xl md:flex lg:w-60 lg:px-4",
          theme.border,
          theme.surfaceGlass,
        )}
      >
        <div className="space-y-6">
          <button
            type="button"
            onClick={() => setTab("chat")}
            className="flex w-full items-center justify-center gap-3 px-2 text-left lg:justify-start"
          >
            <span
              className={cn(
                "glass-sheen grid size-10 shrink-0 place-items-center rounded-2xl p-1.5",
                theme.accentBg,
              )}
            >
              <Logo className="size-6" />
            </span>
            <span className="hidden min-w-0 lg:block">
              <span className="block truncate font-display text-base font-extrabold">
                Reading Corner
              </span>
              <span className={cn("block truncate text-[11px] font-medium", theme.mutedText)}>
                Read · Chat · Grow
              </span>
            </span>
          </button>

          <nav className="space-y-2">
            <button
              type="button"
              onClick={() => selectTab("chat")}
              className={cn(
                "relative flex min-h-[48px] w-full items-center justify-center gap-3 rounded-2xl px-3 text-sm font-bold transition lg:justify-start",
                tab === "chat" ? theme.navActiveText : theme.mutedText,
              )}
            >
              {tab === "chat" && (
                <motion.span
                  layoutId="desktopSecretNav"
                  transition={{ type: "spring", stiffness: 360, damping: 30 }}
                  className={cn("absolute inset-0 rounded-2xl", theme.navActiveBg)}
                />
              )}
              <span className="relative z-10">
                <MessageCircle className="size-5" />
                {totalUnread > 0 && (
                  <span
                    className={cn(
                      "absolute -right-2 -top-1.5 grid size-4 place-items-center rounded-full text-[9px] font-bold",
                      theme.badgeBg,
                    )}
                  >
                    {totalUnread > 9 ? "9+" : totalUnread}
                  </span>
                )}
              </span>
              <span className="relative z-10 hidden lg:inline">Chat</span>
            </button>

            <button
              type="button"
              onClick={() => selectTab("discover")}
              className={cn(
                "relative flex min-h-[48px] w-full items-center justify-center gap-3 rounded-2xl px-3 text-sm font-bold transition lg:justify-start",
                tab === "discover" ? theme.navActiveText : theme.mutedText,
              )}
            >
              {tab === "discover" && (
                <motion.span
                  layoutId="desktopSecretNav"
                  transition={{ type: "spring", stiffness: 360, damping: 30 }}
                  className={cn("absolute inset-0 rounded-2xl", theme.navActiveBg)}
                />
              )}
              <Compass className="relative z-10 size-5" />
              <span className="relative z-10 hidden lg:inline">Discover</span>
            </button>

            <button
              type="button"
              onClick={() => selectTab("profile")}
              className={cn(
                "relative flex min-h-[48px] w-full items-center justify-center gap-3 rounded-2xl px-3 text-sm font-bold transition lg:justify-start",
                tab === "profile" ? theme.navActiveText : theme.mutedText,
              )}
            >
              {tab === "profile" && (
                <motion.span
                  layoutId="desktopSecretNav"
                  transition={{ type: "spring", stiffness: 360, damping: 30 }}
                  className={cn("absolute inset-0 rounded-2xl", theme.navActiveBg)}
                />
              )}
              <span
                className={cn(
                  "relative z-10 grid size-6 place-items-center rounded-full p-[1.5px]",
                  theme.ringGradient,
                )}
              >
                <span
                  className={cn(
                    "grid size-full place-items-center overflow-hidden rounded-full text-[10px] font-bold",
                    theme.surface,
                  )}
                >
                  {me.avatarUrl ? (
                    <img src={me.avatarUrl} alt={me.fullName} className="size-full object-cover" />
                  ) : (
                    initialsOf(me.fullName)
                  )}
                </span>
              </span>
              <span className="relative z-10 hidden lg:inline">Profile</span>
            </button>

            {me.isAdmin && (
              <Link
                to="/control"
                className={cn(
                  "relative flex min-h-[48px] w-full items-center justify-center gap-3 rounded-2xl px-3 text-sm font-bold text-emerald-500 transition hover:bg-emerald-500/10 lg:justify-start",
                )}
              >
                <ShieldCheck className="relative z-10 size-5 shrink-0" />
                <span className="relative z-10 hidden lg:inline">CONTROL</span>
              </Link>
            )}
          </nav>
        </div>

        <p className={cn("hidden px-2 text-[11px] leading-relaxed lg:block", theme.mutedText)}>
          Discover readers, follow profiles, and sync your reading shelf across devices.
        </p>
      </aside>

      {/* Main Content Area with Smooth Glass Transitions */}
      <main className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AnimatePresence mode="wait">
          {tab === "chat" ? (
            <motion.div
              key="chat"
              initial={{ opacity: 0, y: 8, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.99 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              <InstagramChatView
                theme={theme}
                onOpenProfile={() => setTab("profile")}
                onOpenDiscover={() => setTab("discover")}
                onThreadOpenChange={setThreadOpenOnMobile}
              />
            </motion.div>
          ) : tab === "discover" ? (
            <motion.div
              key="discover"
              initial={{ opacity: 0, y: 8, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.99 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              <DiscoverUsersView theme={theme} onStartMessage={handleStartMessage} />
            </motion.div>
          ) : (
            <motion.div
              key="profile"
              initial={{ opacity: 0, y: 8, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.99 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              <InstagramProfileView
                theme={theme}
                initialSection={initialProfileSection}
                onBackToChat={() => setTab("chat")}
                onOpenDiscover={() => setTab("discover")}
              />
            </motion.div>
          )}
        </AnimatePresence>
        <div
          className={cn(
            "shrink-0",
            tab === "chat" && threadOpenOnMobile
              ? "hidden md:block"
              : "mb-[calc(4rem+max(0.5rem,env(safe-area-inset-bottom)))] md:mb-0",
          )}
        >
          <ReadingActions
            themeId={theme.id}
            inShell
            personalPath={nfc?.revoked ? null : nfc?.path}
          />
        </div>
      </main>

      {/* Floating Glass Mobile Bottom Pill */}
      {!(tab === "chat" && threadOpenOnMobile) && (
        <motion.nav
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className={cn(
            "fixed inset-x-3 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-30 rounded-[28px] border p-1.5 backdrop-blur-2xl md:hidden",
            theme.navBg,
          )}
        >
          <div className="mx-auto grid max-w-md grid-cols-3 gap-1">
            <button
              type="button"
              onClick={() => selectTab("chat")}
              className={cn(
                "relative flex min-h-[48px] items-center justify-center gap-1.5 rounded-[22px] px-2 text-xs font-bold transition",
                tab === "chat" ? theme.navActiveText : theme.mutedText,
              )}
            >
              {tab === "chat" && (
                <motion.span
                  layoutId="mobileSecretNav"
                  transition={{ type: "spring", stiffness: 360, damping: 28 }}
                  className={cn("glass-sheen absolute inset-0 rounded-[22px]", theme.navActiveBg)}
                />
              )}
              <span className="relative z-10">
                <MessageCircle className="size-5" />
                {totalUnread > 0 && (
                  <span
                    className={cn(
                      "absolute -right-2.5 -top-1.5 grid size-4 place-items-center rounded-full text-[9px] font-bold",
                      theme.badgeBg,
                    )}
                  >
                    {totalUnread > 9 ? "9+" : totalUnread}
                  </span>
                )}
              </span>
              <span className="relative z-10">Chat</span>
            </button>

            <button
              type="button"
              onClick={() => selectTab("discover")}
              className={cn(
                "relative flex min-h-[48px] items-center justify-center gap-1.5 rounded-[22px] px-2 text-xs font-bold transition",
                tab === "discover" ? theme.navActiveText : theme.mutedText,
              )}
            >
              {tab === "discover" && (
                <motion.span
                  layoutId="mobileSecretNav"
                  transition={{ type: "spring", stiffness: 360, damping: 28 }}
                  className={cn("glass-sheen absolute inset-0 rounded-[22px]", theme.navActiveBg)}
                />
              )}
              <Compass className="relative z-10 size-5" />
              <span className="relative z-10">Discover</span>
            </button>

            <button
              type="button"
              onClick={() => selectTab("profile")}
              className={cn(
                "relative flex min-h-[48px] items-center justify-center gap-1.5 rounded-[22px] px-2 text-xs font-bold transition",
                tab === "profile" ? theme.navActiveText : theme.mutedText,
              )}
            >
              {tab === "profile" && (
                <motion.span
                  layoutId="mobileSecretNav"
                  transition={{ type: "spring", stiffness: 360, damping: 28 }}
                  className={cn("glass-sheen absolute inset-0 rounded-[22px]", theme.navActiveBg)}
                />
              )}
              <User className="relative z-10 size-5" />
              <span className="relative z-10">Profile</span>
            </button>
          </div>
        </motion.nav>
      )}
    </div>
  );
}
