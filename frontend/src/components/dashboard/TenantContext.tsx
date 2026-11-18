"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthContext";
import { api, type Role, type Tenant } from "@/lib/api";

type Ctx = {
  tenants: Tenant[];
  current: Tenant | null;
  /** The signed-in user's role in the current business. */
  role: Role;
  loading: boolean;
  error: string | null;
  select: (id: string) => void;
  create: (name: string) => Promise<void>;
  /** Re-read the business list (after a rename, delete, or accepting an invite). */
  reload: (selectId?: string) => Promise<void>;
};

const TenantCtx = createContext<Ctx | null>(null);
const STORAGE_KEY = "rehber.tenant";

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { me, refresh } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const select = useCallback((id: string) => {
    setCurrentId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {}
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .listTenants()
      .then((list) => {
        if (!alive) return;
        setTenants(list);
        const stored = readStored();
        setCurrentId(list.find((t) => t.id === stored)?.id ?? list[0]?.id ?? null);
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const reload = useCallback(
    async (selectId?: string) => {
      const [list] = await Promise.all([api.listTenants(), refresh()]);
      setTenants(list);
      const keep = selectId ?? readStored();
      const next = list.find((t) => t.id === keep)?.id ?? list[0]?.id ?? null;
      if (next) select(next);
      else setCurrentId(null);
    },
    [refresh, select],
  );

  const create = useCallback(
    async (name: string) => {
      const t = await api.createTenant(name);
      await reload(t.id); // also refreshes roles (the creator is the owner)
    },
    [reload],
  );

  const current = tenants.find((t) => t.id === currentId) ?? null;
  const role = (me.tenants.find((t) => t.id === current?.id)?.role ?? "member") as Role;
  return (
    <TenantCtx.Provider value={{ tenants, current, role, loading, error, select, create, reload }}>{children}</TenantCtx.Provider>
  );
}

export function useTenant() {
  const ctx = useContext(TenantCtx);
  if (!ctx) throw new Error("useTenant must be used inside TenantProvider");
  return ctx;
}
