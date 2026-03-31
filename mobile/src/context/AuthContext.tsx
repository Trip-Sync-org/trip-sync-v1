import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { User } from "../types";
import { apiFetch } from "../api/client";
import { supabase } from "../lib/supabase";

const STORAGE_KEY = "tripsync_user";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, role: "user" | "organizer") => Promise<void>;
  signup: (
    email: string,
    password: string,
    name: string,
    role: "user" | "organizer",
  ) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          setUser(JSON.parse(raw) as User);
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /** Optional: sync Supabase OAuth user to public.users (same as web). */
  useEffect(() => {
    (async () => {
      try {
        if (!supabase) return;
        const { data: authData } = await supabase.auth.getUser();
        const authUser = authData.user;
        if (!authUser?.email) return;
        const displayName =
          (authUser.user_metadata?.full_name as string) ||
          (authUser.user_metadata?.name as string) ||
          authUser.email.split("@")[0];
        const res = await apiFetch("/api/auth/sync", {
          method: "POST",
          body: JSON.stringify({
            email: authUser.email,
            name: displayName,
            role: "user",
            auth_user_id: authUser.id,
          }),
        });
        if (!res.ok) return;
        const profile = await res.json();
        const hydrated: User = {
          id: String(profile.id ?? authUser.id),
          name: profile.name ?? displayName,
          email: profile.email ?? authUser.email,
          role: profile.role ?? "user",
          level: profile.level ?? 1,
          xp: profile.xp ?? 0,
        };
        setUser(hydrated);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(hydrated));
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const persist = useCallback(async (u: User | null) => {
    if (u) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    else await AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  const login = useCallback(
    async (email: string, password: string, role: "user" | "organizer") => {
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Login failed");
      }
      const u: User = {
        id: String(body.id ?? email),
        name: body.name || email.split("@")[0] || "Explorer",
        email: body.email || email,
        role: body.role || role,
        level: body.level ?? 1,
        xp: body.xp ?? 0,
      };
      setUser(u);
      await persist(u);
    },
    [persist],
  );

  const signup = useCallback(
    async (email: string, password: string, name: string, role: "user" | "organizer") => {
      const res = await apiFetch("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email, password, name, role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const isRateLimited =
          body?.code === "over_email_send_rate_limit" || Number(res.status) === 429;
        const waitSecs =
          typeof body?.retry_after_seconds === "number" && Number.isFinite(body.retry_after_seconds)
            ? Math.max(1, Math.floor(body.retry_after_seconds))
            : 60;
        const msg = isRateLimited
          ? `Too many sign-up attempts. Please wait ${waitSecs}s and try again.`
          : [body.error, body.hint].filter(Boolean).join(" — ") || "Sign up failed";
        throw new Error(msg);
      }
      const u: User = {
        id: String(body.id ?? email),
        name: body.name || name || email.split("@")[0] || "Explorer",
        email: body.email || email,
        role: body.role || role,
        level: body.level ?? 1,
        xp: body.xp ?? 0,
      };
      setUser(u);
      await persist(u);
    },
    [persist],
  );

  const logout = useCallback(async () => {
    setUser(null);
    await persist(null);
    try {
      await supabase?.auth.signOut();
    } catch {
      /* ignore */
    }
  }, [persist]);

  const value = useMemo(
    () => ({ user, loading, login, signup, logout }),
    [user, loading, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
