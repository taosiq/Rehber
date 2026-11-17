"use client";

import { motion } from "motion/react";

/** Compass-needle mark: "Rehber" means "guide". The needle settles on load. */
export function Logo({ size = 48 }: { size?: number }) {
  return (
    <span className="inline-flex items-center" style={{ gap: size * 0.3 }}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r="14.5" fill="none" stroke="url(#ring)" strokeWidth="1.5" />
        <motion.g
          initial={{ rotate: -140 }}
          animate={{ rotate: 0 }}
          transition={{ type: "spring", stiffness: 60, damping: 7, delay: 0.2 }}
          style={{ originX: "16px", originY: "16px" }}
        >
          <path d="M16 5 L19.5 16 L16 14.5 L12.5 16 Z" fill="#f5b544" />
          <path d="M16 27 L12.5 16 L16 17.5 L19.5 16 Z" fill="#8b5cf6" opacity="0.85" />
        </motion.g>
        <defs>
          <linearGradient id="ring" x1="0" y1="0" x2="32" y2="32">
            <stop offset="0" stopColor="#f5b544" />
            <stop offset="1" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
      </svg>
      <span className="font-display leading-none tracking-tight" style={{ fontSize: size * 0.85 }}>Rehber</span>
    </span>
  );
}
