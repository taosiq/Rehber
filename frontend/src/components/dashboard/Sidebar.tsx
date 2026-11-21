"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  BarChart3, Bot, Check, ChevronsUpDown, FileText, Inbox, LayoutGrid, LogOut, Menu, MessageCircleMore, Plus, Settings,
  Users, Wrench, X,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthContext";
import { Logo } from "@/components/landing/Logo";
import { WhatsAppIcon } from "@/components/icons/WhatsAppIcon";
import { inboxApi, type InboxCounts } from "@/lib/api";
import { useTenant } from "./TenantContext";

type NavItem = { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; href: string; badge?: "inbox" };
const nav: NavItem[] = [
  { label: "Overview", icon: LayoutGrid, href: "/dashboard" },
  { label: "Conversations", icon: Inbox, href: "/dashboard/conversations", badge: "inbox" },
  { label: "Knowledge", icon: FileText, href: "/dashboard/knowledge" },
  { label: "Chat Playground", icon: Bot, href: "/dashboard/chat" },
  { label: "Agent Tools", icon: Wrench, href: "/dashboard/tools" },
  { label: "Website Widget", icon: MessageCircleMore, href: "/dashboard/widget" },
  { label: "WhatsApp", icon: WhatsAppIcon, href: "/dashboard/whatsapp" },
  { label: "Analytics", icon: BarChart3, href: "/dashboard/analytics" },
  { label: "Team", icon: Users, href: "/dashboard/team" },
  { label: "Settings", icon: Settings, href: "/dashboard/settings" },
];

/** Inbox badge numbers, refreshed every 20 seconds and when the tab becomes visible again. */
export function useInboxCounts(): InboxCounts | null {
  const { current } = useTenant();
  const tid = current?.id;
  const [counts, setCounts] = useState<{ tid: string; c: InboxCounts } | null>(null);
  useEffect(() => {
    if (!tid) return;
    let alive = true;
    const load = () => inboxApi.counts(tid).then((c) => alive && setCounts({ tid, c }), () => {});
    load();
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 20000);
    const onVisible = () => document.visibilityState === "visible" && load();
    const onChanged = () => load();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("rehber:inbox-changed", onChanged); // pages fire this after read/resolve
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("rehber:inbox-changed", onChanged);
    };
  }, [tid]);
  return counts && counts.tid === tid ? counts.c : null;
}

function Badge({ counts }: { counts: InboxCounts | null }) {
  if (!counts) return null;
  return (
    <span className="relative ml-auto flex items-center gap-1">
      <AnimatePresence>
        {counts.needs_human > 0 && (
          <motion.span key="h" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} title="Needs a human"
            className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-black">
            {counts.needs_human}
          </motion.span>
        )}
        {counts.unread > 0 && (
          <motion.span key="u" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} title="Unread"
            className="grid h-5 min-w-5 place-items-center rounded-full bg-violet px-1.5 text-[11px] font-bold text-white">
            {counts.unread}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

function TenantSwitcher() {
  const { tenants, current, role, select, create } = useTenant();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white/[0.03] p-3 text-left transition-colors hover:bg-white/[0.06]"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent to-violet text-base font-semibold text-black">
          {current?.name[0] ?? "?"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium">{current?.name ?? "No business yet"}</span>
          <span className="block text-xs text-muted">{current ? <span className="capitalize">{role} · business</span> : "Create one to start"}</span>
        </span>
        <ChevronsUpDown size={16} className="text-muted" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-x-0 top-full z-30 mt-2 rounded-2xl border border-line bg-[#111119] p-2 shadow-2xl"
          >
            {tenants.map((t) => (
              <button
                key={t.id}
                onClick={() => { select(t.id); setOpen(false); }}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm hover:bg-white/5"
              >
                <span className="truncate">{t.name}</span>
                {t.id === current?.id && <Check size={14} className="text-accent" />}
              </button>
            ))}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (name.trim().length < 2) return;
                await create(name.trim());
                setName("");
                setOpen(false);
              }}
              className="mt-1 flex gap-1.5 border-t border-line pt-2"
            >
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="New business name"
                className="min-w-0 flex-1 rounded-lg bg-white/5 px-3 py-1.5 text-sm outline-none placeholder:text-muted focus:ring-1 focus:ring-accent"
              />
              <button className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-black" aria-label="Create business">
                <Plus size={16} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const counts = useInboxCounts();
  return (
    <nav className="mt-8 flex flex-col gap-1">
      {nav.map((item, i) => {
        const active = item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <motion.div key={item.label} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i }}>
            <Link href={item.href} onClick={onNavigate}
              className={clsx("relative flex items-center gap-3 rounded-xl px-4 py-3 text-base transition-colors",
                active ? "text-foreground" : "text-muted hover:text-foreground")}>
              {active && (
                <motion.span layoutId={onNavigate ? "nav-active-m" : "nav-active"} className="absolute inset-0 rounded-xl border border-line bg-white/[0.06]"
                  transition={{ type: "spring", stiffness: 400, damping: 34 }} />
              )}
              <item.icon size={19} className={clsx("relative", active && "text-accent")} />
              <span className="relative">{item.label}</span>
              {item.badge === "inbox" && <Badge counts={counts} />}
            </Link>
          </motion.div>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const counts = useInboxCounts();
  const page = nav.find((n) => (n.href === "/dashboard" ? pathname === n.href : pathname.startsWith(n.href)));
  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-[290px] shrink-0 flex-col overflow-y-auto border-r border-line bg-black/20 px-5 py-7 backdrop-blur-xl lg:flex">
        <Link href="/" className="mb-8 px-2"><Logo size={40} /></Link>
        <TenantSwitcher />
        <NavLinks />
        <UserMenu />
      </aside>

      {/* Phones and tablets: top bar + slide-in menu */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-16 items-center gap-3 border-b border-line bg-[#07070b]/85 px-4 backdrop-blur-xl lg:hidden">
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="relative grid h-10 w-10 place-items-center rounded-xl hover:bg-white/5">
          <Menu size={20} />
          {counts && counts.needs_human + counts.unread > 0 && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-accent" />}
        </button>
        <Logo size={30} />
        <span className="ms-auto truncate text-sm text-muted">{page?.label}</span>
      </div>
      <AnimatePresence>
        {open && (
          <>
            <motion.div key="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden" />
            <motion.aside key="drawer" initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 38 }}
              className="fixed inset-y-0 left-0 z-50 flex w-[85vw] max-w-[320px] flex-col overflow-y-auto border-r border-line bg-[#0b0b11] px-5 py-6 lg:hidden">
              <div className="mb-6 flex items-center justify-between px-2">
                <Logo size={34} />
                <button onClick={() => setOpen(false)} aria-label="Close menu" className="grid h-10 w-10 place-items-center rounded-xl hover:bg-white/5"><X size={20} /></button>
              </div>
              <TenantSwitcher />
              <NavLinks onNavigate={() => setOpen(false)} />
              <UserMenu />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function UserMenu() {
  const { me, logout } = useAuth();
  const initials = me.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="mt-auto flex items-center gap-3 rounded-2xl border border-line bg-white/[0.03] p-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet to-cyan text-sm font-semibold">
        {initials}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{me.name}</p>
        <p className="truncate text-xs text-muted">{me.email}</p>
      </div>
      <button onClick={logout} title="Log out" aria-label="Log out"
        className="grid h-9 w-9 place-items-center rounded-lg text-muted transition-colors hover:bg-white/10 hover:text-foreground">
        <LogOut size={16} />
      </button>
    </div>
  );
}
