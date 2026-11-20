export type SecretThemeId = "instagram" | "emerald" | "dark";

export type SecretThemeTokens = {
  id: SecretThemeId;
  name: string;
  description: string;
  isDark: boolean;
  pageBg: string;
  ambientBackdrop: string;
  glassOrbPrimary: string;
  glassOrbSecondary: string;
  surface: string;
  surfaceGlass: string;
  glassSheet: string;
  glassRow: string;
  glassRowSelected: string;
  glassPill: string;
  surfaceMuted: string;
  border: string;
  text: string;
  mutedText: string;
  accentBg: string;
  accentText: string;
  ringGradient: string;
  myBubble: string;
  peerBubble: string;
  navBg: string;
  navActiveBg: string;
  navActiveText: string;
  badgeBg: string;
  cardShadow: string;
  swatches: [string, string, string];
};

export const SECRET_THEMES: Record<SecretThemeId, SecretThemeTokens> = {
  instagram: {
    id: "instagram",
    name: "Azure 3D",
    description: "Soft 3D ice-slate neumorphic panels with glowing azure water-bubble depth.",
    isDark: false,
    pageBg: "bg-gradient-to-br from-[#e7eef6] via-[#edf3f9] to-[#dde7f3] text-[#1e293b]",
    ambientBackdrop:
      "bg-[radial-gradient(circle_at_14%_14%,rgba(56,189,248,0.22),transparent_48%),radial-gradient(circle_at_86%_18%,rgba(14,165,233,0.18),transparent_46%),radial-gradient(circle_at_50%_88%,rgba(37,99,235,0.14),transparent_52%)]",
    glassOrbPrimary: "bg-gradient-to-tr from-[#38bdf8]/30 via-[#60a5fa]/24 to-[#e0f2fe]/35",
    glassOrbSecondary: "bg-gradient-to-tr from-[#0ea5e9]/24 via-[#38bdf8]/22 to-[#93c5fd]/30",
    surface: "bg-[#f5f8fc] text-[#1e293b]",
    surfaceGlass:
      "bg-[#eef3f9]/92 backdrop-blur-2xl text-[#1e293b] border-white/95 shadow-[12px_14px_30px_rgba(154,174,200,0.34),-10px_-10px_26px_rgba(255,255,255,0.92),inset_1px_1px_1px_rgba(255,255,255,0.95)]",
    glassSheet:
      "bg-[#edf3f9]/90 backdrop-blur-2xl border-white/95 shadow-[14px_16px_34px_rgba(154,174,200,0.38),-12px_-12px_28px_rgba(255,255,255,0.95),inset_1.5px_1.5px_2px_rgba(255,255,255,0.95)]",
    glassRow:
      "bg-[#f3f7fc]/92 hover:bg-white border-white/95 shadow-[5px_6px_14px_rgba(162,180,206,0.28),-4px_-4px_12px_rgba(255,255,255,0.95),inset_1px_1px_0_rgba(255,255,255,0.95)]",
    glassRowSelected:
      "bg-gradient-to-r from-white via-[#f8fbff] to-[#eef6ff] border-white shadow-[0_12px_26px_-8px_rgba(14,165,233,0.32),8px_8px_20px_rgba(154,174,200,0.36),-6px_-6px_16px_rgba(255,255,255,1),inset_1px_1px_1px_rgba(255,255,255,1)]",
    glassPill:
      "bg-[#f4f8fd]/95 backdrop-blur-xl border-white shadow-[6px_7px_16px_rgba(158,176,202,0.32),-5px_-5px_12px_rgba(255,255,255,0.98),inset_1px_1px_1px_rgba(255,255,255,1)]",
    surfaceMuted: "bg-[#e6eef7] text-[#1e293b]",
    border: "border-white/90",
    text: "text-[#1e293b]",
    mutedText: "text-[#5b6b82]",
    accentBg:
      "bg-gradient-to-r from-[#4bc4e2] via-[#249ff0] to-[#0284c7] text-white shadow-[inset_0_1.5px_1px_rgba(255,255,255,0.55),0_10px_24px_-6px_rgba(14,165,233,0.52)]",
    accentText: "text-[#0284c7]",
    ringGradient: "bg-gradient-to-tr from-[#38bdf8] via-[#0ea5e9] to-[#2563eb]",
    myBubble:
      "border border-sky-200/45 bg-gradient-to-br from-[#38b6ff] via-[#1c8cff] to-[#0066ff] text-white shadow-[inset_0_1.5px_1px_rgba(255,255,255,0.52),0_12px_24px_-8px_rgba(0,102,255,0.48)]",
    peerBubble:
      "bg-gradient-to-br from-white via-[#f7faff] to-[#edf3fa] border border-white text-[#1e293b] shadow-[6px_8px_18px_rgba(160,178,204,0.34),-5px_-5px_14px_rgba(255,255,255,0.98),inset_1px_1px_1px_rgba(255,255,255,1)]",
    navBg:
      "bg-[#eef4fb]/92 border-white text-[#5b6b82] shadow-[0_-10px_28px_-8px_rgba(148,163,184,0.32),inset_0_1.5px_1px_rgba(255,255,255,1)]",
    navActiveBg:
      "bg-gradient-to-r from-[#4bc4e2] via-[#249ff0] to-[#0284c7] text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),0_8px_20px_-4px_rgba(14,165,233,0.52)]",
    navActiveText: "text-white",
    badgeBg:
      "bg-gradient-to-r from-[#fb7185] to-[#f43f5e] text-white shadow-[0_4px_12px_rgba(244,63,94,0.45)]",
    cardShadow:
      "shadow-[10px_12px_26px_rgba(154,174,200,0.32),-8px_-8px_20px_rgba(255,255,255,0.95)]",
    swatches: ["#4bc4e2", "#249ff0", "#e7eef6"],
  },
  emerald: {
    id: "emerald",
    name: "Liquid Glass",
    description:
      "Refractive translucent crystal glass with amethyst-violet and aqua-mint caustics.",
    isDark: false,
    pageBg: "bg-gradient-to-br from-[#ede5e1] via-[#eaeaf5] to-[#dbeff5] text-[#1f1b38]",
    ambientBackdrop:
      "bg-[radial-gradient(circle_at_18%_16%,rgba(167,139,250,0.34),transparent_46%),radial-gradient(circle_at_84%_20%,rgba(45,212,191,0.32),transparent_44%),radial-gradient(circle_at_72%_82%,rgba(251,146,120,0.28),transparent_48%),radial-gradient(circle_at_24%_82%,rgba(56,189,248,0.22),transparent_46%)]",
    glassOrbPrimary: "bg-gradient-to-tr from-[#a78bfa]/42 via-[#2dd4bf]/34 to-[#fbcfe8]/38",
    glassOrbSecondary: "bg-gradient-to-tr from-[#fed7aa]/42 via-[#c4b5fd]/36 to-[#5eead4]/36",
    surface: "bg-white/80 text-[#1f1b38]",
    surfaceGlass:
      "bg-white/42 backdrop-blur-2xl text-[#1f1b38] border-white/85 shadow-[inset_0_1.5px_1.5px_rgba(255,255,255,0.96),inset_0_-1px_2px_rgba(124,92,255,0.16),0_20px_48px_-14px_rgba(124,92,255,0.22),0_12px_28px_-10px_rgba(45,212,191,0.22)]",
    glassSheet:
      "bg-white/38 backdrop-blur-2xl border-white/85 shadow-[inset_0_2px_2px_rgba(255,255,255,0.96),inset_0_-1px_2px_rgba(45,212,191,0.18),0_22px_50px_-14px_rgba(99,102,241,0.22)]",
    glassRow:
      "bg-white/48 hover:bg-white/70 backdrop-blur-xl border-white/85 shadow-[inset_0_1.5px_1px_rgba(255,255,255,0.95),0_10px_22px_-10px_rgba(100,116,139,0.24)]",
    glassRowSelected:
      "bg-gradient-to-r from-[#ffe6d5]/78 via-[#ede2ff]/78 to-[#ccf7f0]/82 backdrop-blur-2xl border-white/95 shadow-[inset_0_1.5px_1.5px_rgba(255,255,255,0.98),0_14px_28px_-10px_rgba(124,92,255,0.34),0_8px_20px_-8px_rgba(45,212,191,0.28)]",
    glassPill:
      "bg-white/56 backdrop-blur-2xl border-white/90 shadow-[inset_0_1.5px_1.5px_rgba(255,255,255,0.98),0_10px_24px_-8px_rgba(124,92,255,0.22)]",
    surfaceMuted: "bg-white/55 text-[#1f1b38]",
    border: "border-white/80",
    text: "text-[#1f1b38]",
    mutedText: "text-[#585478]",
    accentBg:
      "border border-white/55 bg-gradient-to-r from-[#9d7cff] via-[#7c5cff] to-[#2dd4bf] text-white shadow-[inset_0_1.5px_1.5px_rgba(255,255,255,0.68),0_12px_26px_-6px_rgba(124,92,255,0.48),0_6px_18px_-6px_rgba(45,212,191,0.36)]",
    accentText: "text-[#6d5dfc]",
    ringGradient: "bg-gradient-to-tr from-[#9d7cff] via-[#38bdf8] to-[#2dd4bf]",
    myBubble:
      "border border-white/55 bg-gradient-to-br from-[#a78bfa]/95 via-[#7c5cff]/95 to-[#6366f1]/95 text-white shadow-[inset_0_2px_2px_rgba(255,255,255,0.65),0_14px_26px_-8px_rgba(124,92,255,0.5)]",
    peerBubble:
      "bg-white/62 backdrop-blur-2xl border border-white/90 text-[#1f1b38] shadow-[inset_0_1.5px_1.5px_rgba(255,255,255,0.98),0_10px_24px_-10px_rgba(45,212,191,0.28)]",
    navBg:
      "bg-white/48 border-white/85 text-[#585478] shadow-[inset_0_1.5px_1.5px_rgba(255,255,255,0.98),0_-10px_32px_-10px_rgba(124,92,255,0.22)]",
    navActiveBg:
      "bg-gradient-to-r from-[#9d7cff] via-[#7c5cff] to-[#2dd4bf] text-white shadow-[inset_0_1.5px_1px_rgba(255,255,255,0.6),0_10px_22px_-6px_rgba(124,92,255,0.5)]",
    navActiveText: "text-white",
    badgeBg:
      "bg-gradient-to-r from-[#8b5cf6] to-[#2dd4bf] text-white shadow-[0_4px_12px_rgba(124,92,255,0.45)]",
    cardShadow:
      "shadow-[0_18px_38px_-14px_rgba(124,92,255,0.22),0_10px_24px_-12px_rgba(45,212,191,0.22)]",
    swatches: ["#8b5cf6", "#2dd4bf", "#fbcfe8"],
  },
  dark: {
    id: "dark",
    name: "Deep Water",
    description: "3D obsidian slate with luminous cyan-cobalt water glow.",
    isDark: true,
    pageBg: "bg-gradient-to-b from-[#070b14] via-[#0d1527] to-[#060a12] text-[#f1f5f9]",
    ambientBackdrop:
      "bg-[radial-gradient(circle_at_18%_14%,rgba(56,189,248,0.2),transparent_46%),radial-gradient(circle_at_85%_18%,rgba(37,99,235,0.24),transparent_48%),radial-gradient(circle_at_50%_88%,rgba(6,182,212,0.14),transparent_52%)]",
    glassOrbPrimary: "bg-gradient-to-tr from-[#06b6d4]/30 via-[#2563eb]/26 to-[#4f46e5]/25",
    glassOrbSecondary: "bg-gradient-to-tr from-[#38bdf8]/22 via-[#2563eb]/24 to-[#0ea5e9]/22",
    surface: "bg-[#121a2d] text-[#f1f5f9]",
    surfaceGlass:
      "bg-[#10182a]/84 backdrop-blur-2xl text-[#f1f5f9] border-[#38bdf8]/22 shadow-[12px_16px_36px_rgba(2,6,18,0.78),-6px_-6px_18px_rgba(56,189,248,0.06),inset_1px_1px_1px_rgba(186,230,253,0.16)]",
    glassSheet:
      "bg-[#0e1526]/86 backdrop-blur-2xl border-[#38bdf8]/24 shadow-[14px_18px_40px_rgba(2,6,18,0.82),inset_1.5px_1.5px_1px_rgba(147,197,253,0.22)]",
    glassRow:
      "bg-[#162038]/82 hover:bg-[#1c2947]/92 border-white/12 shadow-[6px_8px_18px_rgba(2,6,18,0.62),-3px_-3px_10px_rgba(56,189,248,0.05),inset_0_1px_0_rgba(255,255,255,0.1)]",
    glassRowSelected:
      "bg-gradient-to-r from-[#0ea5e9]/24 via-[#1a2744]/95 to-[#2563eb]/24 border-sky-400/50 shadow-[0_0_26px_-6px_rgba(56,189,248,0.5),inset_1px_1px_1px_rgba(186,230,253,0.22)]",
    glassPill:
      "bg-[#141f35]/90 backdrop-blur-xl border-[#38bdf8]/28 shadow-[6px_8px_18px_rgba(2,6,18,0.7),inset_0_1px_1px_rgba(186,230,253,0.18)]",
    surfaceMuted: "bg-[#1a2540] text-[#f1f5f9]",
    border: "border-[#2a3958]",
    text: "text-[#f1f5f9]",
    mutedText: "text-[#94a3b8]",
    accentBg:
      "bg-gradient-to-r from-[#22d3ee] via-[#0ea5e9] to-[#2563eb] text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.4),0_0_24px_-4px_rgba(14,165,233,0.58)]",
    accentText: "text-[#38bdf8]",
    ringGradient: "bg-gradient-to-tr from-[#22d3ee] via-[#38bdf8] to-[#2563eb]",
    myBubble:
      "border border-sky-300/35 bg-gradient-to-br from-[#0ea5e9] via-[#2563eb] to-[#1d4ed8] text-white shadow-[inset_0_1.5px_1px_rgba(255,255,255,0.36),0_10px_26px_-6px_rgba(14,165,233,0.52)]",
    peerBubble:
      "bg-gradient-to-br from-[#1b253d] to-[#131b2e] border border-white/14 text-[#f1f5f9] shadow-[6px_8px_18px_rgba(2,6,18,0.65),inset_0_1px_0_rgba(255,255,255,0.12)]",
    navBg:
      "bg-[#0e1526]/90 border-[#38bdf8]/22 text-[#94a3b8] shadow-[inset_0_1px_1px_rgba(255,255,255,0.14),0_-10px_34px_-10px_rgba(0,0,0,0.75)]",
    navActiveBg:
      "bg-gradient-to-r from-[#0ea5e9] to-[#2563eb] text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.35),0_0_22px_-4px_rgba(14,165,233,0.62)]",
    navActiveText: "text-white",
    badgeBg: "bg-gradient-to-r from-[#fb7185] to-[#e11d48] text-white",
    cardShadow: "shadow-[10px_14px_30px_rgba(2,6,18,0.7)]",
    swatches: ["#0d1527", "#0ea5e9", "#38bdf8"],
  },
};

export function getSecretTheme(id?: string | null): SecretThemeTokens {
  if (id === "emerald") return SECRET_THEMES.emerald;
  if (id === "dark") return SECRET_THEMES.dark;
  return SECRET_THEMES.instagram;
}

export type ThemeButtonRole = "primary" | "secondary" | "surface";

export function resolveWaterButtonVariant(
  themeId: SecretThemeId,
  role: ThemeButtonRole = "primary",
):
  | "ocean"
  | "cobalt"
  | "surface3d"
  | "surface3dDark"
  | "liquidViolet"
  | "liquidAqua"
  | "liquidGlass" {
  if (themeId === "emerald") {
    if (role === "primary") return "liquidViolet";
    if (role === "secondary") return "liquidAqua";
    return "liquidGlass";
  }
  if (themeId === "dark") {
    if (role === "primary") return "cobalt";
    if (role === "secondary") return "ocean";
    return "surface3dDark";
  }
  if (role === "primary") return "ocean";
  if (role === "secondary") return "cobalt";
  return "surface3d";
}
