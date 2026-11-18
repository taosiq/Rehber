"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, Loader2, MailCheck } from "lucide-react";
import { AuthShell, Field, inputCls } from "@/components/auth/AuthShell";
import { authApi } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.forgot(email);
      setSent(res.detail);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Forgot your password?" subtitle="Enter your email and we'll send you a link to choose a new one."
      footer={<>Remembered it? <Link href="/login" className="text-accent hover:underline">Log in</Link></>}>
      <AnimatePresence mode="wait">
        {sent ? (
          <motion.div key="sent" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-start gap-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.07] p-6">
            <motion.span initial={{ rotate: -15, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring" }}
              className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-400/15 text-emerald-300"><MailCheck size={22} /></motion.span>
            <p className="text-emerald-50">{sent}</p>
            <p className="text-sm text-muted">The link works once and expires in 1 hour. Check your spam folder if it doesn&apos;t arrive in a few minutes.</p>
          </motion.div>
        ) : (
          <motion.form key="form" exit={{ opacity: 0 }} onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Email">
              <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@business.com" className={inputCls} />
            </Field>
            {error && (
              <p className="flex items-center gap-2 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                <AlertCircle size={16} className="shrink-0" /> {error}
              </p>
            )}
            <motion.button whileTap={{ scale: 0.98 }} disabled={busy}
              className="group mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-accent py-3.5 text-lg font-semibold text-black shadow-[0_0_40px_-8px_rgba(245,181,68,0.7)] disabled:opacity-60">
              {busy && <Loader2 size={18} className="animate-spin" />} Send reset link
              {!busy && <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />}
            </motion.button>
          </motion.form>
        )}
      </AnimatePresence>
    </AuthShell>
  );
}
