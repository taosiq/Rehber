"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { AuthShell, Field, inputCls, safeNext } from "@/components/auth/AuthShell";
import { authApi, session } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await authApi.login(email, password);
      session.setCsrf(me.csrf_token);
      router.replace(safeNext());
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to manage your AI support agent."
      footer={<>New to Rehber? <Link href="/signup" className="text-accent hover:underline">Create an account</Link></>}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Email">
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@business.com" className={inputCls} />
        </Field>
        <Field label="Password" hint={<Link href="/forgot-password" className="mt-2 inline-block text-sm text-accent hover:underline">Forgot your password?</Link>}>
          <div className="relative">
            <input type={show ? "text" : "password"} autoComplete="current-password" required value={password}
              onChange={(e) => setPassword(e.target.value)} className={`${inputCls} pe-12`} />
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
          {busy ? <Loader2 size={18} className="animate-spin" /> : null}
          Log in
          {!busy && <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />}
        </motion.button>
      </form>
    </AuthShell>
  );
}
