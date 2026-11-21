"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, ArrowRight, Building2, Loader2, Mail, Sparkles } from "lucide-react";
import { useAuth } from "@/components/auth/AuthContext";
import { useTenant } from "./TenantContext";

/** Every dashboard page works on one business. Until the account has one, show how to get started
 *  instead of an empty page. */
export function BusinessGate({ children }: { children: React.ReactNode }) {
  const { current, loading, error } = useTenant();
  // Settings also holds personal account settings (name, password), which work without a business.
  if (usePathname().startsWith("/dashboard/settings")) return <>{children}</>;
  if (loading) return <div className="grid min-h-[70vh] place-items-center text-muted"><Loader2 className="animate-spin" /></div>;
  if (error && !current) {
    return (
      <div className="grid min-h-[70vh] place-items-center p-6 text-center">
        <p className="flex items-center gap-2 text-red-200"><AlertTriangle size={18} /> {error}</p>
      </div>
    );
  }
  return current ? <>{children}</> : <Welcome />;
}

function Welcome() {
  const { me } = useAuth();
  const { create } = useTenant();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return setError("Enter your business name (at least 2 characters).");
    setBusy(true);
    setError(null);
    try {
      await create(name.trim());
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center px-6 py-12 lg:min-h-screen">
      <motion.div initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 24 }}
        className="w-full max-w-xl rounded-[2rem] border border-line bg-card p-8 text-center backdrop-blur-xl md:p-10">
        <motion.div initial={{ rotate: -12, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.1 }}
          className="relative mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-accent to-violet text-black shadow-[0_0_60px_-10px_rgba(245,181,68,0.7)]">
          <Building2 size={34} />
          <motion.span className="absolute -right-2 -top-2 grid h-8 w-8 place-items-center rounded-full bg-[#111119] text-accent"
            animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 2.4, repeat: Infinity }}>
            <Sparkles size={16} />
          </motion.span>
        </motion.div>
        <h1 className="mt-7 font-display text-4xl md:text-5xl">Welcome, {me.name.split(" ")[0]}</h1>
        <p className="mx-auto mt-3 max-w-md text-lg text-muted">
          Your account isn&apos;t part of a business yet. Create one to set up your AI agent. It takes a few seconds.
        </p>
        <form onSubmit={submit} className="mt-8 flex flex-col gap-3 sm:flex-row">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus
            placeholder="e.g. Lumen Dental Clinic"
            className="min-w-0 flex-1 rounded-xl border border-line bg-white/[0.03] px-4 py-3 text-base outline-none transition-colors focus:border-accent" />
          <motion.button whileTap={{ scale: 0.97 }} disabled={busy}
            className="group inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 font-semibold text-black shadow-[0_0_40px_-8px_rgba(245,181,68,0.7)] disabled:opacity-60">
            {busy ? <Loader2 size={18} className="animate-spin" /> : null} Create business
            {!busy && <ArrowRight size={17} className="transition-transform group-hover:translate-x-1" />}
          </motion.button>
        </form>
        <AnimatePresence>
          {error && (
            <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
              className="mt-3 text-sm text-red-300">{error}</motion.p>
          )}
        </AnimatePresence>
        <p className="mt-8 flex items-start justify-center gap-2 border-t border-line pt-6 text-sm text-muted">
          <Mail size={15} className="mt-0.5 shrink-0" />
          <span>Joining a colleague&apos;s business instead? Open the invite link they sent you while logged in as <b className="font-medium text-foreground/90">{me.email}</b>.</span>
        </p>
      </motion.div>
    </div>
  );
}
