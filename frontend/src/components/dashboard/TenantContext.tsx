"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, type Tenant } from "@/lib/api";

type Ctx = {
  tenants: Tenant[];
  current: Tenant | null;
  loading: boolean;
  error: string | null;
  select: (id: string) => void;
  create: (name: string) => Promise<void>;
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
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const select = useCallback((id: string) => {
    setCurrentId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {}
  }, []);

  const create = useCallback(
    async (name: string) => {
      const t = await api.createTenant(name);
      setTenants((prev) => [...prev, t]);
      select(t.id);
    },
    [select],
  );

  const current = tenants.find((t) => t.id === currentId) ?? null;
  return (
    <TenantCtx.Provider value={{ tenants, current, loading, error, select, create }}>{children}</TenantCtx.Provider>
  );
}

export function useTenant() {
  const ctx = useContext(TenantCtx);
  if (!ctx) throw new Error("useTenant must be used inside TenantProvider");
  return ctx;
}
