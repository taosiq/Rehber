"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { AuthShell, Field, inputCls, safeNext } from "@/components/auth/AuthShell";
import { authApi, session } from "@/lib/api";

/** 0-4: length plus character variety. Mirrors the server rule (10+ chars, some variety). */
function strength(pw: string): number {
  if (pw.length < 10 || new Set(pw).size < 5) return pw ? 1 : 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  return Math.min(4, 1 + (pw.length >= 14 ? 1 : 0) + (classes >= 3 ? 1 : 0) + (classes === 4 || pw.length >= 20 ? 1 : 0));
}
const LEVELS = ["", "Too weak", "Okay", "Strong", "Excellent"];
const COLORS = ["bg-white/10", "bg-red-400", "bg-amber-300", "bg-emerald-400", "bg-emerald-300"];

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const score = strength(password);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (score < 2) {
      setError("Use at least 10 characters with some variety (letters, numbers, symbols).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const me = await authApi.signup(name, email, password);
      session.setCsrf(me.csrf_token);
      router.replace(safeNext());
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Set up an AI agent that knows your business in minutes."
      footer={<>Already have an account? <Link href="/login" className="text-accent hover:underline">Log in</Link></>}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Your name">
          <input autoComplete="name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Ayşe Yılmaz" className={inputCls} />
        </Field>
        <Field label="Work email">
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@business.com" className={inputCls} />
        </Field>
        <Field
          label="Password"
          hint={
            <div className="mt-2.5">
              <div className="flex gap-1.5">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                    <motion.div className={clsx("h-full rounded-full", COLORS[score])}
                      initial={false} animate={{ width: score >= i ? "100%" : "0%" }} transition={{ duration: 0.3 }} />
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted">{password ? LEVELS[score] : "At least 10 characters"}</p>
            </div>
          }
        >
          <div className="relative">
            <input type={show ? "text" : "password"} autoComplete="new-password" required minLength={10} maxLength={128}
              value={password} onChange={(e) => setPassword(e.target.value)} className={`${inputCls} pe-12`} />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}
              className="absolute end-3 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-foreground">
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </Field>

        <AnimatePresence>
          {error && (
            <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-2 overflow-hidden rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
              <AlertCircle size={16} className="shrink-0" /> {error}
            </motion.p>
          )}
        </AnimatePresence>

        <motion.button whileTap={{ scale: 0.98 }} disabled={busy}
          className="group mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-accent py-3.5 text-lg font-semibold text-black shadow-[0_0_40px_-8px_rgba(245,181,68,0.7)] disabled:opacity-60">
          {busy && <Loader2 size={18} className="animate-spin" />}
          Create account
          {!busy && <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />}
        </motion.button>
      </form>
    </AuthShell>
  );
}
