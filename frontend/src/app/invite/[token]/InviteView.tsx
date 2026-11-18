"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Building2, Crown, Loader2, LogOut, Shield, UserRound } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { authApi, session, teamApi, type InvitationPreview, type Me } from "@/lib/api";

const ROLE_ICON = { owner: Crown, admin: Shield, member: UserRound };

/** Landing page for an invitation link: shows the business, then log in / sign up / accept. */
export function InviteView() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [invite, setInvite] = useState<InvitationPreview | null>(null);
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = still checking
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    teamApi.preview(token).then((p) => alive && setInvite(p), (e: Error) => alive && setError(e.message));
    authApi.me().then((m) => {
      if (!alive) return;
      session.setCsrf(m.csrf_token);
      setMe(m);
    }, () => alive && setMe(null));
    return () => { alive = false; };
  }, [token]);

  const next = encodeURIComponent(`/invite/${token}`);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const { tenant_id } = await teamApi.accept(token);
      try { localStorage.setItem("rehber.tenant", tenant_id); } catch {}
      router.replace("/dashboard");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const logout = async () => {
    await authApi.logout().catch(() => {});
    session.setCsrf(null);
    setMe(null);
  };

  const RoleIcon = invite ? ROLE_ICON[invite.role] : UserRound;

  return (
    <AuthShell title={invite ? `Join ${invite.business}` : "Team invitation"}
      subtitle={invite ? `${invite.invited_by ?? "A colleague"} invited you to help answer customers on Rehber.` : "Checking your invitation…"}
      footer={<Link href="/" className="text-accent hover:underline">What is Rehber?</Link>}>
      {error && !invite ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-red-100">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />{error}
        </motion.div>
      ) : !invite || me === undefined ? (
        <div className="grid h-32 place-items-center"><Loader2 className="animate-spin text-accent" /></div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5">
          <div className="flex items-center gap-4 rounded-2xl border border-line bg-white/[0.03] p-4">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-accent to-violet text-black"><Building2 size={22} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-lg font-medium">{invite.business}</span>
              <span className="flex items-center gap-1.5 text-sm text-muted"><RoleIcon size={14} /> <span className="capitalize">{invite.role}</span> · for {invite.email}</span>
            </span>
          </div>

          {me === null ? (
            <>
              <p className="text-muted">Create an account with <b className="text-foreground">{invite.email}</b>, or log in if you already have one.</p>
              <Link href={`/signup?next=${next}&email=${encodeURIComponent(invite.email)}`}
                className="group inline-flex items-center justify-center gap-2 rounded-xl bg-accent py-3.5 text-lg font-semibold text-black shadow-[0_0_40px_-8px_rgba(245,181,68,0.7)]">
                Create account <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
              </Link>
              <Link href={`/login?next=${next}`} className="rounded-xl border border-line py-3.5 text-center hover:bg-white/5">I already have an account</Link>
            </>
          ) : me.email !== invite.email ? (
            <>
              <p className="flex items-start gap-2 rounded-xl border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                You&apos;re logged in as {me.email}, but this invitation is for {invite.email}.
              </p>
              <button onClick={logout} className="inline-flex items-center justify-center gap-2 rounded-xl border border-line py-3.5 hover:bg-white/5">
                <LogOut size={17} /> Log out and switch account
              </button>
            </>
          ) : (
            <>
              <p className="text-muted">Logged in as <b className="text-foreground">{me.name}</b>.</p>
              {error && <p className="text-sm text-red-300">{error}</p>}
              <motion.button whileTap={{ scale: 0.98 }} onClick={accept} disabled={busy}
                className="group inline-flex items-center justify-center gap-2 rounded-xl bg-accent py-3.5 text-lg font-semibold text-black shadow-[0_0_40px_-8px_rgba(245,181,68,0.7)] disabled:opacity-60">
                {busy ? <Loader2 size={18} className="animate-spin" /> : null} Accept and open dashboard
                {!busy && <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />}
              </motion.button>
            </>
          )}
        </motion.div>
      )}
    </AuthShell>
  );
}
