"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { authApi, session, type Me } from "@/lib/api";

type Ctx = { me: Me; refresh: () => Promise<void>; logout: () => Promise<void> };
const AuthCtx = createContext<Ctx | null>(null);

/** Guards everything inside it: shows a loader, then either the page or a redirect to /login. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);

  const toLogin = useCallback(() => {
    session.setCsrf(null);
    router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [router, pathname]);

  useEffect(() => {
    let alive = true;
    session.onUnauthorized(toLogin); // any 401 later (expired session) also lands here
    authApi
      .me()
      .then((m) => {
        if (!alive) return;
        session.setCsrf(m.csrf_token);
        setMe(m);
      })
      .catch(() => alive && toLogin());
    return () => {
      alive = false;
      session.onUnauthorized(null);
    };
  }, [toLogin]);

  const refresh = useCallback(async () => {
    const m = await authApi.me();
    session.setCsrf(m.csrf_token);
    setMe(m);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      session.setCsrf(null);
      router.replace("/login");
    }
  }, [router]);

  if (!me) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="animate-spin text-accent" size={30} />
      </div>
    );
  }
  return <AuthCtx.Provider value={{ me, refresh, logout }}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside AuthGate");
  return ctx;
}
