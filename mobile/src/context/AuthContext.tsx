//authcontext.tsx
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

/**
 * What SignupScreen / OtpEntryScreen need to know after any signup-related
 * call, to decide what to render next. We never throw for "needs more
 * steps" — only for genuine errors (bad password, etc).
 */
export type SignupStepResult =
  | { step: "complete" }
  | { step: "needs_email_otp" };

/**
 * Result of a login-via-email-code step. Distinct from SignupStepResult —
 * this is for SIGNING IN an existing user with a code instead of a
 * password, not for verifying a new account. Different Clerk strategy
 * under the hood (email_code on signIn, not signUp).
 */
export type LoginOtpStepResult =
  | { step: "complete" }
  | { step: "needs_code" }
  | { step: "needs_second_factor" };

type AuthContextValue = {
  user: User | null;
  accessToken: string | null;
  loading: boolean;
  login: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  // --- Login via email OTP (alternative to password, NOT signup) ---
  requestLoginOtp: (email: string) => Promise<LoginOtpStepResult>;
  verifyLoginOtp: (code: string) => Promise<LoginOtpStepResult>;
  resendLoginOtp: () => Promise<void>;
  signup: (
    email: string,
    password: string,
    name: string,
    userType: "explorer" | "organisor",
  ) => Promise<SignupStepResult>;
  // --- Email verification step methods (signup flow) ---
  verifyEmailOtp: (code: string) => Promise<SignupStepResult>;
  resendEmailOtp: () => Promise<void>;
  // --- Forgot password flow (Clerk reset_password_email_code) ---
  requestPasswordReset: (email: string) => Promise<void>;
  confirmPasswordReset: (code: string, newPassword: string) => Promise<void>;
  resendPasswordReset: () => Promise<void>;
  // --- Existing ---
  switchRole: (newRole: "explorer" | "organisor") => Promise<void>;
  addRole: (newRole: "explorer" | "organisor") => Promise<void>;
  logout: () => Promise<void>;
  setPendingGoogleRole: (role: "explorer" | "organisor" | null) => void;
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

/**
 * Inspects a Clerk SignUp resource's status to decide what UI step comes
 * next. Email/password signups need email OTP. Google signups arrive with
 * email already verified, so they reach "complete" directly — no extra
 * step needed for them at all.
 */
function resolveNextStep(signUpResource: {
  status: string | null;
  verifications?: {
    emailAddress?: { status: string | null } | null;
  } | null;
}): SignupStepResult {
  if (signUpResource.status === "complete") return { step: "complete" };

  const emailVerified = signUpResource.verifications?.emailAddress?.status === "verified";
  if (!emailVerified) return { step: "needs_email_otp" };

  // Status isn't complete but email is verified — shouldn't normally
  // happen once phone is no longer a requirement. Surface email OTP again
  // as the safest fallback rather than silently stalling.
  return { step: "needs_email_otp" };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { user: clerkUser, isLoaded: clerkUserLoaded } = useClerkUser();
  const { getToken, isSignedIn, signOut: clerkSignOut } = useClerkAuth();
  const { signUp, setActive: setActiveSignUp } = useSignUp() as ReturnType<typeof useSignUp> & { setActive: (p: { session: string }) => Promise<void> };
  const { signIn, setActive: setActiveSignIn } = useSignIn() as ReturnType<typeof useSignIn> & { setActive: (p: { session: string }) => Promise<void> };

  const [appUser, setAppUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /** Set by SignupScreen before triggering Google OAuth — the role the user selected on the toggle. */
  const pendingGoogleRoleRef = React.useRef<"explorer" | "organisor" | null>(null);

  /**
   * Set once an email/password signup is known to need email OTP. Lets
   * resendEmailOtp/verifyEmailOtp work without re-deriving role/email each
   * time, and lets us finish the Supabase sync + setActive only once
   * verification actually completes.
   */
  const pendingSignupRoleRef = React.useRef<{ userType: "explorer" | "organisor"; name: string; email: string } | null>(null);

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

  const setPendingGoogleRole = useCallback((role: "explorer" | "organisor" | null) => {
    pendingGoogleRoleRef.current = role;
  }, []);

  /**
   * Finalizes a signup once Clerk reports status === "complete": activates
   * the session, syncs to Supabase, stores the numeric id, sets appUser.
   */
  const finalizeSignup = useCallback(
    async (sessionId: string, email: string, name: string, mappedRole: string, createdUserId?: string | null) => {
      await setActiveSignUp({ session: sessionId });
      try {
        const syncRes = await apiFetch("/api/auth/sync", {
          method: "POST",
          body: JSON.stringify({ email, name, role: mappedRole, roles: [mappedRole], auth_user_id: createdUserId }),
        });
        if (syncRes.ok) {
          const body = await syncRes.json();
          const parsed = Number(body.id);
          if (Number.isFinite(parsed) && parsed > 0) {
            setNumericId(parsed);
            await AsyncStorage.setItem(NUMERIC_ID_KEY, String(parsed));
          }
        }
      } catch {
        console.warn("[Auth] Failed to sync profile to backend");
      }
      pendingSignupRoleRef.current = null;
    },
    [setActiveSignUp],
  );

  const prevClerkIdRef = React.useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!clerkUserLoaded) return;
    (async () => {
      try {
        if (clerkUser && isSignedIn) {
          const clerkId = clerkUser.id;
          if (prevClerkIdRef.current !== clerkId) {
            prevClerkIdRef.current = clerkId;

            // ---- First-time Google sign-up: set roles from pre-selected toggle ----
            const existingRoles = (clerkUser.unsafeMetadata?.roles as string[]) ?? [];
            const pendingRole = pendingGoogleRoleRef.current;
            console.log("[Auth] Checking Google role — pendingRole:", pendingRole, "existingRoles:", existingRoles);
            if (pendingRole && (!existingRoles || existingRoles.length === 0)) {
              const mappedRole = mapTypeToRole(pendingRole);
              console.log("[Auth] Setting first-time Google role:", mappedRole);
              try {
                await clerkUser.update({
                  unsafeMetadata: {
                    ...clerkUser.unsafeMetadata,
                    role: pendingRole,
                    userType: pendingRole,
                    roles: [mappedRole],
                    activeRole: mappedRole,
                  },
                });
                console.log("[Auth] Unsafe metadata updated successfully");
              } catch (e) {
                console.warn("[Auth] Failed to set role from Google signup", e);
              }
            } else {
              console.log("[Auth] Skipping role set — pendingRole:", !!pendingRole, "existingRolesLen:", existingRoles?.length);
            }
            pendingGoogleRoleRef.current = null;

            // Single sync call — uses the definitive metadata from clerkUser now,
            // which includes any roles just set by the pendingRole block above.
            const currentRole = (clerkUser.unsafeMetadata?.role as string) ?? "explorer";
            const currentRoles = (clerkUser.unsafeMetadata?.roles as string[]) ?? [mapTypeToRole("explorer")];
            const mappedCurrentRole = currentRole === "organisor" || currentRole === "organizer" ? "organizer" : "user";
            const mappedRoles = currentRoles.map(r => r === "organisor" || r === "organizer" ? "organizer" : "user");

            let nid = numericId;
            try {
              const syncRes = await apiFetch("/api/auth/sync", {
                method: "POST",
                body: JSON.stringify({
                  email: clerkUser.primaryEmailAddress?.emailAddress,
                  name: clerkUser.fullName,
                  role: mappedCurrentRole,
                  roles: mappedRoles,
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

  /**
   * Starts a login-via-email-code attempt. IMPORTANT: signIn.create() with
   * strategy: "email_code" already sends the first code itself — do NOT
   * follow this with a separate prepareFirstFactor() call, that's a
   * confirmed double-send bug (two emails, two different codes, first one
   * invalid). prepareFirstFactor is only used later, for resend.
   */
  const requestLoginOtp = useCallback(
    async (email: string): Promise<LoginOtpStepResult> => {
      if (!signIn) throw new Error("SignIn not ready");
      if (isSignedIn) return { step: "complete" };
      const result = await signIn.create({ identifier: email, strategy: "email_code" });
      if (result.status === "complete") return { step: "complete" };
      if (result.status === "needs_second_factor") return { step: "needs_second_factor" };
      // needs_first_factor (or similar pending state) — code was just sent.
      return { step: "needs_code" };
    },
    [signIn, isSignedIn],
  );

  /** Verifies the email code for a login-via-OTP attempt. */
  const verifyLoginOtp = useCallback(
    async (code: string): Promise<LoginOtpStepResult> => {
      if (!signIn) throw new Error("SignIn not ready");
      const result = await signIn.attemptFirstFactor({ strategy: "email_code", code });
      if (result.status === "complete") {
        const sessionId = result.createdSessionId;
        if (!sessionId) throw new Error("No session ID returned from signIn");
        await setActiveSignIn({ session: sessionId });
        return { step: "complete" };
      }
      if (result.status === "needs_second_factor") return { step: "needs_second_factor" };
      return { step: "needs_code" };
    },
    [signIn, setActiveSignIn],
  );

  /**
   * Resends the login OTP code. Unlike requestLoginOtp's initial send
   * (which happens implicitly inside signIn.create()), a genuine resend
   * needs the explicit prepareFirstFactor call — there's no "create"
   * step to repeat since the signIn attempt already exists.
   */
  const resendLoginOtp = useCallback(async () => {
    if (!signIn) throw new Error("SignIn not ready");
    const emailFactor = signIn.supportedFirstFactors?.find(
      (f: { strategy: string }) => f.strategy === "email_code",
    ) as { strategy: "email_code"; emailAddressId: string } | undefined;
    if (!emailFactor) throw new Error("Email code isn't available for this sign-in attempt");
    await signIn.prepareFirstFactor({ strategy: "email_code", emailAddressId: emailFactor.emailAddressId });
  }, [signIn]);

  /**
   * Starts (or restarts) email/password signup. With email verification
   * required, Clerk comes back with "missing_requirements" first — we
   * tell the caller (SignupScreen) to show the OTP screen instead of
   * throwing.
   */
  const signup = useCallback(
    async (email: string, password: string, name: string, userType: "explorer" | "organisor"): Promise<SignupStepResult> => {
      if (!signUp) throw new Error("SignUp not ready");
      const { firstName, lastName } = splitName(name || email.split("@")[0] || "User");
      const mappedRole = mapTypeToRole(userType);

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

      if (result.status === "complete") {
        const sessionId = result.createdSessionId;
        if (!sessionId) throw new Error("No session ID returned from signUp");
        await finalizeSignup(sessionId, email, name || email.split("@")[0], mappedRole, result.createdUserId);
        return { step: "complete" };
      }

      // Not complete yet — remember who's signing up so the OTP screen
      // (which only carries a code, not the full identity) can finish the
      // job later via finalizeSignup.
      pendingSignupRoleRef.current = { userType, name: name || email.split("@")[0], email };

      const next = resolveNextStep(result);
      if (next.step === "needs_email_otp") {
        await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      }
      return next;
    },
    [signUp, finalizeSignup],
  );

  /** Verifies the email OTP code and finalizes the signup. */
  const verifyEmailOtp = useCallback(
    async (code: string): Promise<SignupStepResult> => {
      if (!signUp) throw new Error("SignUp not ready");
      const result = await signUp.attemptEmailAddressVerification({ code });

      if (result.status === "complete") {
        const pending = pendingSignupRoleRef.current;
        const sessionId = result.createdSessionId;
        if (sessionId && pending) {
          await finalizeSignup(sessionId, pending.email, pending.name, mapTypeToRole(pending.userType), result.createdUserId);
        }
        return { step: "complete" };
      }

      return resolveNextStep(result);
    },
    [signUp, finalizeSignup],
  );

  const resendEmailOtp = useCallback(async () => {
    if (!signUp) throw new Error("SignUp not ready");
    await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
  }, [signUp]);

  const switchRole = useCallback(
    async (newRole: "explorer" | "organisor") => {
      if (!clerkUser) throw new Error("Not signed in");
      const mapped = mapTypeToRole(newRole);
      const currentRoles = (clerkUser.unsafeMetadata?.roles as string[]) ?? [];
      if (!currentRoles.includes(mapped)) throw new Error(`User doesn't have the ${mapped} role`);
      await clerkUser.update({ unsafeMetadata: { ...clerkUser.unsafeMetadata, activeRole: mapped } });
      // Sync active role to Supabase so backend checks (e.g. trip creation) use the correct role
      try {
        await apiFetch("/api/auth/sync", {
          method: "POST",
          body: JSON.stringify({
            email: clerkUser.primaryEmailAddress?.emailAddress,
            name: clerkUser.fullName,
            role: mapped,
            roles: currentRoles,
            auth_user_id: clerkUser.id,
          }),
        });
      } catch {
        console.warn("[Auth] Supabase sync failed after role switch");
      }
      if (appUser) {
        // Also update the legacy role field so CreateEventScreen / role checks see the active role immediately
        const typedRole = mapped === "organizer" ? "organizer" as const : "user" as const;
        const updated = { ...appUser, role: typedRole, activeRole: mapped };
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

  /**
   * Starts a password reset flow via email code. Uses signIn.create()
   * with strategy: "reset_password_email_code" — this sends the code
   * AND creates an in-progress sign-in attempt simultaneously.
   */
  const requestPasswordReset = useCallback(async (email: string) => {
    if (!signIn) throw new Error("SignIn not ready");
    const result = await signIn.create({ identifier: email, strategy: "reset_password_email_code" });
    if (result.status === "complete") {
      // Edge case: somehow already signed in — nothing to do.
      return;
    }
    // status is "needs_first_factor" — code was sent, UI should show code input.
  }, [signIn]);

  /**
   * Verifies the reset code AND sets the new password in one step.
   * Clerk's reset_password_email_code strategy handles both in a single
   * attemptFirstFactor call. On success, setActive() signs the user in.
   */
  const confirmPasswordReset = useCallback(async (code: string, newPassword: string) => {
    if (!signIn) throw new Error("SignIn not ready");
    const result = await signIn.attemptFirstFactor({
      strategy: "reset_password_email_code",
      code,
      password: newPassword,
    });
    if (result.status === "complete") {
      const sessionId = result.createdSessionId;
      if (!sessionId) throw new Error("No session ID returned");
      await setActiveSignIn({ session: sessionId });
    }
  }, [signIn, setActiveSignIn]);

  /**
   * Resends the password reset code. Sign-in attempt exists already
   * (created by requestPasswordReset), so we use prepareFirstFactor.
   */
  const resendPasswordReset = useCallback(async () => {
    if (!signIn) throw new Error("SignIn not ready");
    const factor = signIn.supportedFirstFactors?.find(
      (f: { strategy: string }) => f.strategy === "reset_password_email_code",
    ) as { strategy: "reset_password_email_code"; emailAddressId: string } | undefined;
    if (!factor) throw new Error("Reset code isn't available for this attempt");
    await signIn.prepareFirstFactor({ strategy: "reset_password_email_code", emailAddressId: factor.emailAddressId });
  }, [signIn]);

  const logout = useCallback(async () => {
    await clerkSignOut();
    setAppUser(null);
    setAccessToken(null);
    setNumericId(undefined);
    pendingSignupRoleRef.current = null;
    await AsyncStorage.multiRemove([STORAGE_KEY, NUMERIC_ID_KEY]);
  }, [clerkSignOut]);

  const value = useMemo(
    () => ({
      user: appUser,
      accessToken,
      loading: loading || !clerkUserLoaded,
      login,
      requestLoginOtp,
      verifyLoginOtp,
      resendLoginOtp,
      signup,
      verifyEmailOtp,
      resendEmailOtp,
      switchRole,
      addRole,
      requestPasswordReset,
      confirmPasswordReset,
      resendPasswordReset,
      logout,
      setPendingGoogleRole,
    }),
    [
      appUser, accessToken, loading, clerkUserLoaded, login,
      requestLoginOtp, verifyLoginOtp, resendLoginOtp,
      signup, verifyEmailOtp, resendEmailOtp,
      switchRole, addRole, requestPasswordReset, confirmPasswordReset, resendPasswordReset, logout, setPendingGoogleRole,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}