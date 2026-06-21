import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  useUser as useClerkUser,
  useAuth as useClerkAuth,
  useSignUp,
  useSignIn,
} from "@clerk/clerk-expo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { User } from "../types";
import { apiFetch } from "../api/client";

const STORAGE_KEY = "tripsync_user";
const NUMERIC_ID_KEY = "tripsync_numeric_id";

type AuthContextValue = {
  user: User | null;
  accessToken: string | null;
  loading: boolean;
  login: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  signup: (email: string, password: string, name: string, userType: "explorer" | "organisor") => Promise<void>;
  switchRole: (newRole: "explorer" | "organisor") => Promise<void>;
  addRole: (newRole: "explorer" | "organisor") => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function clerkUserToAppUser(cu: NonNullable<ReturnType<typeof useClerkUser>["user"]>, numericId?: number): User {
  const metadata = cu.unsafeMetadata ?? {};
  const roleRaw = (metadata.role as string) ?? (metadata.userType as string) ?? "explorer";
  const roles = (metadata.roles as string[]) ?? [roleRaw];
  const appRole = roleRaw === "organisor" || roleRaw === "organizer" ? "organizer" : "user";
  return {
    id: numericId != null ? String(numericId) : cu.id,
    authUserId: cu.id,
    name: cu.fullName ?? cu.primaryEmailAddress?.emailAddress?.split("@")[0] ?? "User",
    email: cu.primaryEmailAddress?.emailAddress ?? "",
    role: appRole,
    roles: roles.map(r => r === "organisor" || r === "organizer" ? "organizer" : "user"),
    activeRole: (metadata.activeRole as string) ?? appRole,
    level: (metadata.level as number) ?? 1,
    xp: (metadata.xp as number) ?? 0,
  };
}

function mapTypeToRole(userType: "explorer" | "organisor"): string {
  return userType === "organisor" ? "organizer" : "user";
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) return { firstName: trimmed, lastName: "" };
  return {
    firstName: trimmed.slice(0, spaceIdx).trim(),
    lastName: trimmed.slice(spaceIdx + 1).trim(),
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { user: clerkUser, isLoaded: clerkUserLoaded } = useClerkUser();
  const { getToken, isSignedIn, signOut: clerkSignOut } = useClerkAuth();
  const { signUp, setActive: setActiveSignUp } = useSignUp() as ReturnType<typeof useSignUp> & { setActive: (p: { session: string }) => Promise<void> };
  const { signIn, setActive: setActiveSignIn } = useSignIn() as ReturnType<typeof useSignIn> & { setActive: (p: { session: string }) => Promise<void> };

  const [appUser, setAppUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load numeric id from storage on mount
  const [numericId, setNumericId] = useState<number | undefined>(undefined);
  useEffect(() => {
    AsyncStorage.getItem(NUMERIC_ID_KEY).then(v => {
      if (v) {
        const n = Number(v);
        if (Number.isFinite(n)) setNumericId(n);
      }
    });
  }, []);

  const prevClerkIdRef = React.useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!clerkUserLoaded) return;
    (async () => {
      try {
        if (clerkUser && isSignedIn) {
          const clerkId = clerkUser.id;
          if (prevClerkIdRef.current !== clerkId) {
            prevClerkIdRef.current = clerkId;
            // Try to get numeric id from sync response
            let nid = numericId;
            try {
              const syncRes = await apiFetch("/api/auth/sync", {
                method: "POST",
                body: JSON.stringify({
                  email: clerkUser.primaryEmailAddress?.emailAddress,
                  name: clerkUser.fullName,
                  role: (clerkUser.unsafeMetadata?.role as string) ?? "explorer",
                  auth_user_id: clerkUser.id,
                }),
              });
              if (syncRes.ok) {
                const body = await syncRes.json();
                const parsed = Number(body.id);
                if (Number.isFinite(parsed) && parsed > 0) {
                  nid = parsed;
                  await AsyncStorage.setItem(NUMERIC_ID_KEY, String(parsed));
                }
              }
            } catch {
              // Sync is best-effort
            }
            const u = clerkUserToAppUser(clerkUser, nid);
            setAppUser(u);
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(u));
            const token = await getToken({ template: "supabase" });
            setAccessToken(token ?? null);
          }
        } else {
          if (prevClerkIdRef.current !== undefined) {
            prevClerkIdRef.current = undefined;
            setAppUser(null);
            setAccessToken(null);
            await AsyncStorage.multiRemove([STORAGE_KEY, NUMERIC_ID_KEY]);
          }
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, [clerkUser?.id, isSignedIn, clerkUserLoaded, numericId]);

  const login = useCallback(
    async (email: string, password: string, _rememberMe: boolean) => {
      if (!signIn) throw new Error("SignIn not ready");
      if (isSignedIn) return;
      try {
        const result = await signIn.create({ identifier: email, password });
        if (result.status !== "complete") throw new Error("Sign in failed");
        const sessionId = result.createdSessionId;
        if (!sessionId) throw new Error("No session ID returned from signIn");
        await setActiveSignIn({ session: sessionId });
      } catch (e: unknown) {
        throw e;
      }
    },
    [signIn, setActiveSignIn],
  );

  const signup = useCallback(
    async (email: string, password: string, name: string, userType: "explorer" | "organisor") => {
      if (!signUp) throw new Error("SignUp not ready");
      const { firstName, lastName } = splitName(name || email.split("@")[0] || "User");
      const mappedRole = mapTypeToRole(userType);
      try {
        const result = await signUp.create({
          emailAddress: email,
          password,
          firstName,
          lastName,
          unsafeMetadata: {
            role: userType,
            userType,
            roles: [mappedRole],
            activeRole: mappedRole,
          },
        });
        if (result.status !== "complete") throw new Error(`Signup incomplete: ${result.status}`);
        const sessionId = result.createdSessionId;
        if (!sessionId) throw new Error("No session ID returned from signUp");
        await setActiveSignUp({ session: sessionId });
        try {
          const syncRes = await apiFetch("/api/auth/sync", {
            method: "POST",
            body: JSON.stringify({ email, name: name || email.split("@")[0], role: mappedRole, roles: [mappedRole], auth_user_id: result.createdUserId }),
          });
          if (syncRes.ok) {
            const body = await syncRes.json();
            const parsed = Number(body.id);
            if (Number.isFinite(parsed) && parsed > 0) {
              setNumericId(parsed);
              await AsyncStorage.setItem(NUMERIC_ID_KEY, String(parsed));
            }
          }
        } catch { console.warn("[Auth] Failed to sync profile to backend"); }
      } catch (e: unknown) { throw e; }
    },
    [signUp, setActiveSignUp],
  );

  const switchRole = useCallback(
    async (newRole: "explorer" | "organisor") => {
      if (!clerkUser) throw new Error("Not signed in");
      const mapped = mapTypeToRole(newRole);
      const currentRoles = (clerkUser.unsafeMetadata?.roles as string[]) ?? [];
      if (!currentRoles.includes(mapped)) throw new Error(`User doesn't have the ${mapped} role`);
      await clerkUser.update({ unsafeMetadata: { ...clerkUser.unsafeMetadata, activeRole: mapped } });
      if (appUser) {
        const updated = { ...appUser, activeRole: mapped };
        setAppUser(updated);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      }
    },
    [clerkUser, appUser],
  );

  const addRole = useCallback(
    async (newRole: "explorer" | "organisor") => {
      if (!clerkUser) throw new Error("Not signed in");
      const mapped = mapTypeToRole(newRole);
      const currentRoles = (clerkUser.unsafeMetadata?.roles as string[]) ?? [];
      if (currentRoles.includes(mapped)) throw new Error(`Already has the ${mapped} role`);
      const newRoles = [...currentRoles, mapped];
      await clerkUser.update({ unsafeMetadata: { ...clerkUser.unsafeMetadata, roles: newRoles } });
      try {
        await apiFetch("/api/auth/sync", {
          method: "POST",
          body: JSON.stringify({
            email: clerkUser.primaryEmailAddress?.emailAddress,
            name: clerkUser.fullName,
            role: mapped,
            roles: newRoles,
            auth_user_id: clerkUser.id,
          }),
        });
      } catch {
        console.warn("[Auth] Supabase sync failed after role add");
      }
      if (appUser) {
        const updated = { ...appUser, roles: newRoles };
        setAppUser(updated);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      }
    },
    [clerkUser, appUser],
  );

  const forgotPassword = useCallback(async (email: string) => {
    const res = await apiFetch("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Reset password request failed");
  }, []);

  const resetPassword = useCallback(async (token: string, newPassword: string) => {
    const res = await apiFetch("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ token, newPassword }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Reset password failed");
  }, []);

  const logout = useCallback(async () => {
    await clerkSignOut();
    setAppUser(null);
    setAccessToken(null);
    setNumericId(undefined);
    await AsyncStorage.multiRemove([STORAGE_KEY, NUMERIC_ID_KEY]);
  }, [clerkSignOut]);

  const value = useMemo(
    () => ({
      user: appUser,
      accessToken,
      loading: loading || !clerkUserLoaded,
      login,
      signup,
      switchRole,
      addRole,
      forgotPassword,
      resetPassword,
      logout,
    }),
    [appUser, accessToken, loading, clerkUserLoaded, login, signup, switchRole, addRole, forgotPassword, resetPassword, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}