"use client";

import { motion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/landing/Logo";

export default function DashboardPlaceholder() {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-6">
      <div className="bg-grid absolute inset-0 -z-10" />
      <div className="aurora-blob -z-10 left-1/3 top-1/4 h-96 w-96 bg-violet" />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="glow-border max-w-md rounded-3xl bg-[#0d0d14]/90 p-10 text-center"
      >
        <div className="flex justify-center"><Logo size={40} /></div>
        <h1 className="mt-6 font-display text-4xl">Dashboard is being built</h1>
        <p className="mt-3 text-sm text-muted">
          Document upload, conversations, analytics and settings will land here soon.
        </p>
        <Link href="/" className="mt-8 inline-flex items-center gap-2 text-sm text-accent hover:underline">
          <ArrowLeft size={14} /> Back home
        </Link>
      </motion.div>
    </main>
  );
}
