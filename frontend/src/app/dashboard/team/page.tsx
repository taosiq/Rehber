"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import {
  AlertTriangle, Check, Copy, Crown, Link2, Loader2, LogOut, Mail, Shield, Trash2, UserPlus, UserRound, Users, X,
} from "lucide-react";
import { useTenant } from "@/components/dashboard/TenantContext";
import { teamApi, type Invitation, type Member, type Role } from "@/lib/api";
import { initials, timeAgo } from "@/lib/format";

const ROLE_INFO: Record<Role, { label: string; icon: typeof Crown; color: string; can: string }> = {
  owner: { label: "Owner", icon: Crown, color: "text-accent bg-accent/15", can: "Everything, including deleting the business and managing owners." },
  admin: { label: "Admin", icon: Shield, color: "text-violet bg-violet/15", can: "Documents, agent tools, widget, API keys and the team (except owners)." },
  member: { label: "Member", icon: UserRound, color: "text-cyan bg-cyan/15", can: "Read and answer conversations, use the playground, see analytics." },
};
const RANK: Record<Role, number> = { member: 1, admin: 2, owner: 3 };

function Card({ title, icon: Icon, children, action, i = 0 }: { title: string; icon: typeof Users; children: React.ReactNode; action?: React.ReactNode; i?: number }) {
  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.06 }}
      className="rounded-3xl border border-line bg-card p-6 backdrop-blur-xl">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-medium"><Icon size={18} className="text-accent" />{title}</h2>
        {action}
      </div>
      {children}
    </motion.section>
  );
}

export default function TeamPage() {
  const { current, role: myRole, reload } = useTenant();
  const tid = current?.id;
  const canManage = RANK[myRole] >= RANK.admin;
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);

  const load = useCallback(async () => {
    if (!tid) return;
    const [m, i] = await Promise.all([teamApi.members(tid), canManage ? teamApi.invitations(tid) : Promise.resolve([])]);
    setMembers(m);
    setInvites(i);
  }, [tid, canManage]);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => load().catch((e: Error) => alive && setError(e.message)), 0);
    return () => { alive = false; clearTimeout(t); };
  }, [load]);

  const run = async (fn: () => Promise<unknown>, after?: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      await (after ? after() : load());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!current) return null;
  const owners = members?.filter((m) => m.role === "owner").length ?? 0;

  return (
    <div className="mx-auto w-full max-w-[1300px] px-6 py-10 md:px-10 xl:px-14">
      <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <p className="font-mono text-sm uppercase tracking-[0.2em] text-accent">Team</p>
        <h1 className="mt-2 font-display text-5xl md:text-6xl">People who <span className="italic text-gradient">help</span></h1>
        <p className="mt-3 max-w-2xl text-lg text-muted">Invite colleagues to answer conversations when a customer needs a human, and decide what each person can change.</p>
      </motion.header>

      <AnimatePresence>
        {error && (
          <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="mt-6 flex items-center gap-2 overflow-hidden rounded-2xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
            <AlertTriangle size={16} className="shrink-0" />{error}
            <button onClick={() => setError(null)} className="ms-auto" aria-label="Dismiss"><X size={15} /></button>
          </motion.p>
        )}
      </AnimatePresence>

      <div className="mt-8 grid items-start gap-8 xl:grid-cols-[1.4fr_1fr]">
        <Card title={`Members${members ? ` (${members.length})` : ""}`} icon={Users}>
          {!members ? <Loader2 className="animate-spin text-muted" /> : (
            <ul className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {members.map((m) => (
                  <MemberRow key={m.user_id} m={m} myRole={myRole} lastOwner={m.role === "owner" && owners <= 1}
                    onRole={(r) => run(() => teamApi.setRole(current.id, m.user_id, r), m.is_you ? async () => { await load(); await reload(); } : undefined)}
                    onRemove={() => run(() => teamApi.remove(current.id, m.user_id), m.is_you ? () => reload() : undefined)} />
                ))}
              </AnimatePresence>
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-8">
          {canManage ? (
            <InviteCard myRole={myRole} onInvite={async (email, role) => {
              setError(null);
              try {
                const res = await teamApi.invite(current.id, email, role);
                setLink({ url: `${window.location.origin}/invite/${res.token}`, email: res.email });
                await load();
                return true;
              } catch (e) {
                setError((e as Error).message);
                return false;
              }
            }} />
          ) : (
            <Card title="Invite people" icon={UserPlus} i={1}>
              <p className="text-sm text-muted">Only owners and admins can invite people. Your role: <b className="text-foreground">{ROLE_INFO[myRole].label}</b>.</p>
            </Card>
          )}

          {canManage && invites.length > 0 && (
            <Card title="Pending invitations" icon={Mail} i={2}>
              <ul className="flex flex-col gap-2">
                <AnimatePresence initial={false}>
                  {invites.map((inv) => (
                    <motion.li key={inv.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }}
                      className="flex items-center gap-3 rounded-2xl border border-dashed border-line p-3">
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-white/5 text-muted"><Mail size={15} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{inv.email}</span>
                        <span className="text-xs text-muted">{ROLE_INFO[inv.role].label} · sent {timeAgo(inv.created_at)} · expires {new Date(inv.expires_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                      </span>
                      <button onClick={() => run(() => teamApi.revoke(current.id, inv.id))} title="Cancel invitation"
                        className="rounded-lg px-2.5 py-1.5 text-sm text-muted hover:bg-red-400/10 hover:text-red-300">Cancel</button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </Card>
          )}

          <Card title="What each role can do" icon={Shield} i={3}>
            <ul className="flex flex-col gap-3">
              {(Object.keys(ROLE_INFO) as Role[]).map((r) => {
                const info = ROLE_INFO[r];
                return (
                  <li key={r} className="flex gap-3">
                    <span className={clsx("grid h-9 w-9 shrink-0 place-items-center rounded-xl", info.color)}><info.icon size={16} /></span>
                    <span><b className="font-medium">{info.label}</b><span className="block text-sm text-muted">{info.can}</span></span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>

      <AnimatePresence>{link && <LinkModal link={link} onClose={() => setLink(null)} />}</AnimatePresence>
    </div>
  );
}

function MemberRow({ m, myRole, lastOwner, onRole, onRemove }: {
  m: Member; myRole: Role; lastOwner: boolean; onRole: (r: Role) => void; onRemove: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const info = ROLE_INFO[m.role];
  // Mirrors the server rules (the server enforces them; this only hides what would be refused).
  const canEdit = RANK[myRole] >= RANK.admin && (myRole === "owner" || m.role !== "owner") && !lastOwner;
  const options: Role[] = myRole === "owner" ? ["owner", "admin", "member"] : ["admin", "member"];
  const canRemove = m.is_you ? !lastOwner : canEdit;

  return (
    <motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }}
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white/[0.02] p-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet to-cyan text-sm font-semibold">{initials(m.name)}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{m.name}</span>
          {m.is_you && <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">You</span>}
        </span>
        <span className="block truncate text-sm text-muted">{m.email} · joined {timeAgo(m.joined_at)}</span>
      </span>
      {canEdit ? (
        <select value={m.role} onChange={(e) => onRole(e.target.value as Role)} aria-label={`Role of ${m.name}`}
          className="rounded-xl border border-line bg-[#111118] px-3 py-2 text-sm outline-none focus:border-accent">
          {options.map((r) => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}
        </select>
      ) : (
        <span className={clsx("inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm", info.color)} title={lastOwner ? "A business needs at least one owner" : undefined}>
          <info.icon size={14} />{info.label}
        </span>
      )}
      {canRemove && (
        <AnimatePresence mode="wait" initial={false}>
          {confirm ? (
            <motion.span key="c" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1">
              <button onClick={onRemove} className="rounded-lg bg-red-400/15 px-2.5 py-1.5 text-sm text-red-200 hover:bg-red-400/25">{m.is_you ? "Leave" : "Remove"}</button>
              <button onClick={() => setConfirm(false)} className="rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-white/5">Keep</button>
            </motion.span>
          ) : (
            <motion.button key="b" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setConfirm(true)}
              title={m.is_you ? "Leave this business" : "Remove from team"}
              className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-red-400/10 hover:text-red-300">
              {m.is_you ? <LogOut size={16} /> : <Trash2 size={16} />}
            </motion.button>
          )}
        </AnimatePresence>
      )}
    </motion.li>
  );
}

function InviteCard({ myRole, onInvite }: { myRole: Role; onInvite: (email: string, role: Role) => Promise<boolean> }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Invite someone" icon={UserPlus} i={1}>
      <form className="flex flex-col gap-3" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        if (await onInvite(email.trim(), role)) setEmail("");
        setBusy(false);
      }}>
        <div className="relative">
          <Mail size={16} className="absolute start-4 top-1/2 -translate-y-1/2 text-muted" />
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@business.com"
            className="w-full rounded-xl border border-line bg-white/[0.03] py-3 pe-4 ps-11 outline-none focus:border-accent" />
        </div>
        <div className="flex gap-2">
          {(["member", "admin"] as Role[]).map((r) => (
            <button type="button" key={r} onClick={() => setRole(r)}
              className={clsx("relative flex-1 rounded-xl border px-3 py-2.5 text-sm transition-colors",
                role === r ? "border-accent/50 text-foreground" : "border-line text-muted hover:text-foreground")}>
              {role === r && <motion.span layoutId="invite-role" className="absolute inset-0 rounded-xl bg-accent/10" />}
              <span className="relative">{ROLE_INFO[r].label}</span>
            </button>
          ))}
        </div>
        <motion.button whileTap={{ scale: 0.97 }} disabled={busy}
          className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-accent py-3 font-semibold text-black disabled:opacity-60">
          {busy ? <Loader2 size={17} className="animate-spin" /> : <Link2 size={17} />} Create invite link
        </motion.button>
        <p className="text-xs text-muted">
          You get a private link to send by WhatsApp or email. It works once, for 7 days, and only for an account with this email.
          {myRole !== "owner" && " Only owners can add other owners."}
        </p>
      </form>
    </Card>
  );
}

function LinkModal({ link, onClose }: { link: { url: string; email: string }; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-6 backdrop-blur-sm">
      <motion.div initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }} className="glow-border w-full max-w-xl rounded-3xl bg-[#0d0d14] p-8">
        <div className="flex items-center gap-3">
          <motion.span initial={{ rotate: -20, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", delay: 0.1 }}
            className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-400/15 text-emerald-300"><Link2 size={20} /></motion.span>
          <h2 className="font-display text-3xl">Invite link ready</h2>
        </div>
        <p className="mt-4 text-muted">Send this link to <b className="text-foreground">{link.email}</b>. They sign up or log in with that email and join your team.</p>
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> Copy it now: for security we only keep a fingerprint of it, so it can&apos;t be shown again.
        </p>
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-line bg-black/40 p-3">
          <code className="min-w-0 flex-1 break-all font-mono text-sm text-accent">{link.url}</code>
          <button onClick={async () => { await navigator.clipboard.writeText(link.url); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20">
            {copied ? <><Check size={14} className="text-emerald-300" /> Copied</> : <><Copy size={14} /> Copy</>}
          </button>
        </div>
        <button onClick={onClose} className="mt-6 w-full rounded-xl bg-accent py-3 font-semibold text-black">Done</button>
      </motion.div>
    </motion.div>
  );
}
