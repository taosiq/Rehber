"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { AuthShell, Field, inputCls } from "@/components/auth/AuthShell";
import { authApi } from "@/lib/api";

export function ResetView() {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError("The two passwords don't match.");
    if (password.length < 10 || new Set(password).size < 5) return setError("Use at least 10 characters with some variety.");
    setBusy(true);
    setError(null);
    try {
      await authApi.reset(token, password);
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Choose a new password" subtitle="After this, every device is signed out and you log in with the new password."
      footer={<Link href="/forgot-password" className="text-accent hover:underline">Need a new link?</Link>}>
      <AnimatePresence mode="wait">
        {done ? (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col gap-5">
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.07] p-5 text-emerald-50">
              <CheckCircle2 className="shrink-0 text-emerald-300" /> Your password has been changed.
            </div>
            <Link href="/login" className="group inline-flex items-center justify-center gap-2 rounded-xl bg-accent py-3.5 text-lg font-semibold text-black">
              Log in <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
            </Link>
          </motion.div>
        ) : (
          <motion.form key="form" exit={{ opacity: 0 }} onSubmit={submit} className="flex flex-col gap-4">
            <Field label="New password">
              <div className="relative">
                <input type={show ? "text" : "password"} autoComplete="new-password" required minLength={10} maxLength={128}
                  value={password} onChange={(e) => setPassword(e.target.value)} className={`${inputCls} pe-12`} />
                <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}
                  className="absolute end-3 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-foreground">
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </Field>
            <Field label="Repeat new password">
              <input type={show ? "text" : "password"} autoComplete="new-password" required value={confirm}
                onChange={(e) => setConfirm(e.target.value)} className={inputCls} />
            </Field>
            {error && (
              <p className="flex items-center gap-2 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                <AlertCircle size={16} className="shrink-0" /> {error}
              </p>
            )}
            <motion.button whileTap={{ scale: 0.98 }} disabled={busy}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-accent py-3.5 text-lg font-semibold text-black shadow-[0_0_40px_-8px_rgba(245,181,68,0.7)] disabled:opacity-60">
              {busy && <Loader2 size={18} className="animate-spin" />} Save new password
            </motion.button>
          </motion.form>
        )}
      </AnimatePresence>
    </AuthShell>
  );
}
