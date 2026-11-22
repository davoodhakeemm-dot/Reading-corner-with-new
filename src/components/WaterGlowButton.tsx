import { motion, type HTMLMotionProps } from "motion/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { computeWaterRippleGeometry, playWaterSound, type WaterSoundKind } from "@/lib/water-sound";

export type WaterGlowVariant =
  | "ocean"
  | "cobalt"
  | "aurora"
  | "surface3d"
  | "surface3dDark"
  | "liquidViolet"
  | "liquidAqua"
  | "liquidGlass";
export type WaterGlowSize = "sm" | "md" | "lg" | "icon";

type RippleInstance = {
  id: number;
  x: number;
  y: number;
  diameter: number;
};

export interface WaterGlowButtonProps extends Omit<HTMLMotionProps<"button">, "ref" | "children"> {
  children?: ReactNode;
  variant?: WaterGlowVariant;
  size?: WaterGlowSize;
  sound?: WaterSoundKind | "none";
  soundEnabled?: boolean;
  glow?: boolean;
}

const VARIANT_CLASSES: Record<WaterGlowVariant, string> = {
  ocean:
    "border border-white/45 bg-gradient-to-r from-[#56cae5] via-[#2ea6e6] to-[#0284c7] text-white shadow-[inset_0_1.5px_1.5px_rgba(255,255,255,0.62),inset_0_-3px_6px_rgba(3,105,161,0.35),0_14px_30px_-6px_rgba(14,165,233,0.62),0_0_22px_-4px_rgba(56,189,248,0.55)] hover:shadow-[inset_0_1.5px_2px_rgba(255,255,255,0.75),0_18px_36px_-6px_rgba(14,165,233,0.75),0_0_32px_0px_rgba(56,189,248,0.7)]",
  cobalt:
    "border border-sky-200/45 bg-gradient-to-r from-[#38bdf8] via-[#2563eb] to-[#1d4ed8] text-white shadow-[inset_0_1.5px_1.5px_rgba(255,255,255,0.55),inset_0_-3px_6px_rgba(30,58,138,0.4),0_14px_30px_-6px_rgba(37,99,235,0.6),0_0_22px_-4px_rgba(59,130,246,0.55)] hover:shadow-[inset_0_1.5px_2px_rgba(255,255,255,0.7),0_18px_36px_-6px_rgba(37,99,235,0.75),0_0_30px_0px_rgba(56,189,248,0.65)]",
  aurora:
    "border border-white/45 bg-gradient-to-r from-[#10b981] via-[#06b6d4] to-[#2563eb] text-white shadow-[inset_0_1.5px_1.5px_rgba(255,255,255,0.55),0_14px_30px_-6px_rgba(6,182,212,0.58),0_0_22px_-4px_rgba(16,185,129,0.48)] hover:shadow-[inset_0_1.5px_2px_rgba(255,255,255,0.7),0_18px_36px_-6px_rgba(6,182,212,0.72),0_0_30px_0px_rgba(16,185,129,0.6)]",
  surface3d:
    "border border-white/95 bg-gradient-to-br from-[#f8fbff] to-[#e5edf7] text-[#1e293b] shadow-[7px_8px_18px_rgba(154,174,200,0.42),-6px_-6px_14px_rgba(255,255,255,0.96),inset_0_1.5px_1px_rgba(255,255,255,1)] hover:shadow-[9px_11px_22px_rgba(154,174,200,0.5),-7px_-7px_16px_rgba(255,255,255,1),0_0_20px_-4px_rgba(56,189,248,0.35)]",
  surface3dDark:
    "border border-sky-400/25 bg-gradient-to-br from-[#1b2742] to-[#0f172a] text-white shadow-[8px_10px_22px_rgba(2,6,18,0.78),-4px_-4px_14px_rgba(56,189,248,0.1),inset_0_1.5px_1px_rgba(186,230,253,0.2)] hover:shadow-[10px_12px_26px_rgba(2,6,18,0.86),0_0_24px_-4px_rgba(56,189,248,0.45)]",
  liquidViolet:
    "border border-white/65 bg-gradient-to-r from-[#8b68ff]/95 via-[#6e48ff]/96 to-[#5850ec]/96 text-white [text-shadow:0_1px_2px_rgba(30,20,85,0.32)] backdrop-blur-xl shadow-[inset_0_1.5px_1.5px_rgba(255,255,255,0.72),inset_0_-3px_8px_rgba(67,56,202,0.48),0_16px_34px_-6px_rgba(109,72,255,0.58),0_0_28px_-4px_rgba(139,104,255,0.62)] hover:shadow-[inset_0_2px_2px_rgba(255,255,255,0.85),0_20px_40px_-6px_rgba(109,72,255,0.74),0_0_36px_0px_rgba(139,104,255,0.75)]",
  liquidAqua:
    "border border-white/70 bg-gradient-to-r from-[#6ee7d8]/92 via-[#2dd4bf]/92 to-[#38bdf8]/92 text-[#0f2933] backdrop-blur-xl shadow-[inset_0_2px_2px_rgba(255,255,255,0.84),inset_0_-3px_8px_rgba(13,148,136,0.26),0_16px_34px_-6px_rgba(45,212,191,0.55),0_0_26px_-4px_rgba(94,234,212,0.58)] hover:shadow-[inset_0_2px_2.5px_rgba(255,255,255,0.94),0_20px_40px_-6px_rgba(45,212,191,0.7),0_0_34px_0px_rgba(94,234,212,0.72)]",
  liquidGlass:
    "border border-white/85 bg-white/52 text-[#1f1b38] backdrop-blur-2xl shadow-[inset_0_2px_2px_rgba(255,255,255,0.96),inset_0_-1.5px_3px_rgba(124,92,255,0.16),0_14px_30px_-10px_rgba(124,92,255,0.24),0_8px_20px_-8px_rgba(45,212,191,0.22)] hover:bg-white/68 hover:shadow-[inset_0_2px_2px_rgba(255,255,255,1),0_18px_36px_-10px_rgba(124,92,255,0.34),0_0_24px_-4px_rgba(45,212,191,0.36)]",
};

const SIZE_CLASSES: Record<WaterGlowSize, string> = {
  sm: "min-h-[40px] rounded-full px-4 py-2 text-xs font-bold",
  md: "min-h-[46px] rounded-full px-5 py-2.5 text-sm font-bold",
  lg: "min-h-[52px] rounded-full px-7 py-3 text-base font-extrabold",
  icon: "size-11 rounded-full p-0",
};

export function WaterGlowButton({
  variant = "ocean",
  size = "md",
  sound = "droplet",
  soundEnabled = true,
  glow = true,
  disabled,
  className,
  children,
  onClick,
  onPointerDown,
  type = "button",
  ...rest
}: WaterGlowButtonProps) {
  const [ripples, setRipples] = useState<RippleInstance[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current) {
        window.clearTimeout(timer);
      }
      timersRef.current = [];
    };
  }, []);

  const spawnRipple = useCallback((el: HTMLElement, clientX?: number, clientY?: number) => {
    const rect = el.getBoundingClientRect();
    const geom = computeWaterRippleGeometry(rect, clientX, clientY);
    const id = nextIdRef.current++;
    setRipples((prev) => [...prev.slice(-3), { id, ...geom }]);
    const timer = window.setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, 680);
    timersRef.current.push(timer);
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!disabled) {
        spawnRipple(e.currentTarget, e.clientX, e.clientY);
        if (sound !== "none") {
          playWaterSound(sound, soundEnabled);
        }
      }
      onPointerDown?.(e);
    },
    [disabled, onPointerDown, sound, soundEnabled, spawnRipple],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      // Also trigger ripple + sound on keyboard activation (Enter/Space) where detail === 0
      if (!disabled && e.detail === 0) {
        spawnRipple(e.currentTarget);
        if (sound !== "none") {
          playWaterSound(sound, soundEnabled);
        }
      }
      onClick?.(e);
    },
    [disabled, onClick, sound, soundEnabled, spawnRipple],
  );

  const isColoredVariant =
    variant === "ocean" ||
    variant === "cobalt" ||
    variant === "aurora" ||
    variant === "liquidViolet" ||
    variant === "liquidAqua";
  const isLiquidVariant = variant.startsWith("liquid");

  return (
    <motion.button
      type={type}
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      {...(!disabled
        ? { whileHover: { y: -2, scale: 1.025 }, whileTap: { y: 1.5, scale: 0.93 } }
        : {})}
      transition={{ type: "spring", stiffness: 460, damping: 14, mass: 0.78 }}
      className={cn(
        "group relative inline-flex cursor-pointer select-none items-center justify-center gap-2 overflow-hidden tracking-tight transition-[box-shadow,filter,background-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55",
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        className,
      )}
      {...rest}
    >
      {/* Ambient glowing halo & subtle water sheen */}
      {glow && !disabled && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100",
            isLiquidVariant
              ? "bg-[radial-gradient(circle_at_25%_0%,rgba(255,255,255,0.58),transparent_60%),radial-gradient(circle_at_80%_100%,rgba(45,212,191,0.3),transparent_62%)]"
              : isColoredVariant
                ? "bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.42),transparent_68%)]"
                : "bg-[radial-gradient(circle_at_50%_0%,rgba(56,189,248,0.22),transparent_70%)]",
          )}
        />
      )}

      {/* Top 3D liquid specular highlight strip */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-x-3 top-[2px] rounded-full",
          isLiquidVariant
            ? "h-[28%] bg-gradient-to-b from-white/45 via-white/12 to-transparent"
            : isColoredVariant
              ? "h-[36%] bg-gradient-to-b from-white/32 to-transparent"
              : "h-[38%] bg-gradient-to-b from-white/55 to-transparent",
        )}
      />

      {/* Expanding water-droplet concentric ripple waves */}
      {ripples.map((r) => (
        <span
          key={r.id}
          aria-hidden="true"
          style={{
            left: `${r.x}px`,
            top: `${r.y}px`,
            width: `${r.diameter}px`,
            height: `${r.diameter}px`,
          }}
          className="pointer-events-none absolute inset-auto"
        >
          <span
            style={{
              width: "100%",
              height: "100%",
              animation: "waterRippleWave 0.62s cubic-bezier(0.16, 1, 0.3, 1) forwards",
            }}
            className={cn(
              "block rounded-full border-2",
              variant === "liquidGlass"
                ? "border-violet-400/75 bg-violet-400/20"
                : isColoredVariant
                  ? "border-white/75 bg-white/25"
                  : "border-sky-400/70 bg-sky-400/20",
            )}
          />
        </span>
      ))}

      <span className="relative z-10 inline-flex items-center justify-center gap-2">
        {children}
      </span>
    </motion.button>
  );
}
