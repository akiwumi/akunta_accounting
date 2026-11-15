"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type SessionRole = "owner" | "accountant" | "viewer";

export type SessionBusiness = { id: string; name: string; role: SessionRole };

export type SessionInfo = {
  /** False until the first answer from the server. Treat "not ready" as "may write": the server decides anyway. */
  ready: boolean;
  user: { email: string; fullName: string | null } | null;
  current: SessionBusiness | null;
  businesses: SessionBusiness[];
  role: SessionRole | null;
  /** Owner or accountant. Use it to hide actions a read-only member cannot use. */
  canWrite: boolean;
  isOwner: boolean;
  refresh: () => Promise<void>;
};

const EMPTY: SessionInfo = {
  ready: false,
  user: null,
  current: null,
  businesses: [],
  role: null,
  canWrite: true,
  isOwner: false,
  refresh: async () => {}
};

const SessionContext = createContext<SessionInfo>(EMPTY);

/**
 * The signed-in person's business and role, for client components:
 *
 *   const { canWrite } = useSessionInfo();
 *   {canWrite && <button>Save</button>}
 *
 * Display only. Every request is checked on the server whatever the page shows.
 */
export const useSessionInfo = () => useContext(SessionContext);

// Well inside the 10 minute life of the signed role cookie that /api/session renews.
const REFRESH_MS = 4 * 60 * 1000;

type SessionPayload = Pick<SessionInfo, "user" | "current" | "businesses">;

const loadSession = async (): Promise<SessionPayload | null> => {
  try {
    const response = await fetch("/api/session", { cache: "no-store" });
    return response.ok ? ((await response.json()) as SessionPayload) : null;
  } catch {
    // Offline or mid-navigation: keep what we have.
    return null;
  }
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<SessionPayload | null>(null);

  const refresh = useCallback(async () => {
    const payload = await loadSession();
    if (payload) setData(payload);
  }, []);

  useEffect(() => {
    let active = true;
    const load = () => {
      void loadSession().then((payload) => {
        if (active && payload) setData(payload);
      });
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const value = useMemo<SessionInfo>(() => {
    const role = data?.current?.role ?? null;
    return {
      ready: data !== null,
      user: data?.user ?? null,
      current: data?.current ?? null,
      businesses: data?.businesses ?? [],
      role,
      canWrite: role === null ? true : role !== "viewer",
      isOwner: role === "owner",
      refresh
    };
  }, [data, refresh]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
