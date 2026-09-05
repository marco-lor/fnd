import React from "react";
import { FiLogIn } from "react-icons/fi";
import AuroraBackground from "./backgrounds/AuroraBackground";
import PerformanceProfiler from "../performance/PerformanceProfiler";

export const LoginDecorativeBackground = React.memo(function LoginDecorativeBackground() {
  return (
    <PerformanceProfiler id="LoginDecorativeBackground">
      <AuroraBackground />
    </PerformanceProfiler>
  );
});

export const LoginDecorativeOrbs = React.memo(function LoginDecorativeOrbs() {
  return (
    <PerformanceProfiler id="LoginDecorativeOrbs">
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-cyan-400/20 blur-3xl" />
      </div>
    </PerformanceProfiler>
  );
});

export const LoginCardBorder = React.memo(function LoginCardBorder() {
  return (
    <PerformanceProfiler id="LoginCardBorder">
      <div className="pointer-events-none absolute -inset-[1px] rounded-2xl bg-[conic-gradient(from_90deg_at_50%_50%,#5eead4_0%,#60a5fa_40%,#f472b6_70%,#5eead4_100%)] opacity-30 blur-[6px] animate-slow-spin" />
    </PerformanceProfiler>
  );
});

export const LoginHeader = React.memo(function LoginHeader() {
  return (
    <PerformanceProfiler id="LoginHeader">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-2 h-12 w-12 rounded-xl bg-gradient-to-br from-cyan-400/70 to-fuchsia-500/70 grid place-items-center shadow-[0_0_30px_rgba(99,102,241,0.3)]">
          <FiLogIn className="text-white/90" size={26} />
        </div>
        <h1 className="text-2xl font-semibold tracking-wide text-white drop-shadow-[0_2px_12px_rgba(59,130,246,0.45)]">
          Enter Etherium
        </h1>
        <p className="mt-1 text-sm text-white/70">Forge your legend and continue the journey.</p>
      </div>
    </PerformanceProfiler>
  );
});
