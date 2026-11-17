"use client";

import Link from "next/link";
import { motion, useMotionValueEvent, useScroll } from "motion/react";
import { useState } from "react";
import clsx from "clsx";
import { Logo } from "./Logo";

const links = [
  { href: "#features", label: "Features" },
  { href: "#how", label: "How it works" },
  { href: "#languages", label: "Languages" },
];

export function Navbar() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 24));

  return (
    <motion.header
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-x-0 top-4 z-40 flex justify-center px-4"
    >
      <nav
        className={clsx(
          "flex w-full max-w-5xl items-center justify-between rounded-full border px-5 py-2.5 transition-all duration-500",
          scrolled
            ? "border-line bg-black/50 backdrop-blur-xl shadow-[0_8px_40px_-12px_rgba(0,0,0,0.8)]"
            : "border-transparent bg-transparent",
        )}
      >
        <a href="#" aria-label="Rehber home"><Logo /></a>
        <ul className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                className="rounded-full px-4 py-1.5 text-sm text-muted transition-colors hover:bg-white/5 hover:text-foreground"
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        <Link
          href="/dashboard"
          className="group relative overflow-hidden rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-background"
        >
          <span className="relative z-10">Open dashboard</span>
          <span className="absolute inset-0 -translate-x-full bg-accent transition-transform duration-500 group-hover:translate-x-0" />
        </Link>
      </nav>
    </motion.header>
  );
}
