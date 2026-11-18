"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { BarChart3, Bot, Check, ChevronsUpDown, FileText, LayoutGrid, MessagesSquare, Plus, Settings } from "lucide-react";
import { Logo } from "@/components/landing/Logo";
import { useTenant } from "./TenantContext";

const nav: { label: string; icon: typeof FileText; href?: string; soon?: boolean }[] = [
  { label: "Overview", icon: LayoutGrid, soon: true },
  { label: "Knowledge", icon: FileText, href: "/dashboard" },
  { label: "Chat Playground", icon: Bot, href: "/dashboard/chat" },
  { label: "Conversations", icon: MessagesSquare, soon: true },
  { label: "Analytics", icon: BarChart3, soon: true },
  { label: "Settings", icon: Settings, soon: true },
];

function TenantSwitcher() {
  const { tenants, current, select, create } = useTenant();
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
          <span className="block text-xs text-muted">Business</span>
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

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-[290px] shrink-0 flex-col border-r border-line bg-black/20 px-5 py-7 backdrop-blur-xl lg:flex">
      <Link href="/" className="mb-8 px-2"><Logo size={40} /></Link>
      <TenantSwitcher />
      <nav className="mt-8 flex flex-col gap-1">
        {nav.map((item, i) => {
          const active = item.href === pathname;
          const inner = (
            <>
              {active && (
                <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl border border-line bg-white/[0.06]" transition={{ type: "spring", stiffness: 400, damping: 34 }} />
              )}
              <item.icon size={19} className={clsx("relative", active && "text-accent")} />
              <span className="relative">{item.label}</span>
              {item.soon && <span className="relative ml-auto rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">Soon</span>}
            </>
          );
          const cls = clsx(
            "relative flex items-center gap-3 rounded-xl px-4 py-3 text-base transition-colors",
            active ? "text-foreground" : "text-muted",
            item.soon ? "cursor-not-allowed opacity-60" : "hover:text-foreground",
          );
          return (
            <motion.div key={item.label} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}>
              {item.href ? <Link href={item.href} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>}
            </motion.div>
          );
        })}
      </nav>
      <div className="mt-auto rounded-2xl border border-line bg-gradient-to-br from-violet/15 to-accent/10 p-4 text-sm text-muted">
        <p className="font-medium text-foreground">Phase 3 · Chat</p>
        <p className="mt-1">Streaming answers with citations, in 8 languages. Tools come in Phase 4.</p>
      </div>
    </aside>
  );
}
