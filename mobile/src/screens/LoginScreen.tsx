import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useAuth } from "../context/AuthContext";
import { useSSO } from "@clerk/clerk-expo";
import { useAuthPalette } from "../theme/authTheme";
import {
  AuthScreenShell,
  CheckboxRow,
  DividerOr,
  GoogleButton,
  InputField,
  PrimaryButton,
} from "../components/auth/AuthUI";
import { safeGoBack } from "../utils/navigation";
import { polyfillBrowserApis } from "../utils/polyfillBrowserApis";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;

const RESEND_COOLDOWN_SECONDS = 30;
type LoginMode = "password" | "code";

export function LoginScreen({ navigation }: Props) {
  const c = useAuthPalette();
  const { login, requestLoginOtp, verifyLoginOtp, resendLoginOtp } = useAuth();
  const { startSSOFlow } = useSSO();

  const [mode, setMode] = useState<LoginMode>("password");

  // --- Password mode state ---
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [wrongPassword, setWrongPassword] = useState(false);

  // --- Email code mode state ---
  const [codeEmail, setCodeEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const switchMode = (next: LoginMode) => {
    if (next === mode || busy) return;
    setMode(next);
    setErrorText("");
    setWrongPassword(false);
    setCodeSent(false);
    setCode("");
    setCooldown(0);
  };

  const onSubmitPassword = async () => {
    if (!email.trim() || !password || wrongPassword) return;
    setBusy(true);
    setErrorText("");
    try {
      await login(email.trim(), password, rememberMe);
      setWrongPassword(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Try again";
      setWrongPassword(true);
      setErrorText(
        /invalid credentials/i.test(msg)
          ? "Incorrect password. Please try again."
          : "Connection failed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const onSendCode = async () => {
    if (!codeEmail.trim() || busy) return;
    setBusy(true);
    setErrorText("");
    try {
      const result = await requestLoginOtp(codeEmail.trim());
      if (result.step === "complete") {
        // Edge case: somehow already signed in — nothing further to do,
        // the auth-state listener elsewhere in the app will navigate.
        return;
      }
      if (result.step === "needs_second_factor") {
        setErrorText("This account has two-factor authentication enabled, which isn't supported here yet. Please use your password to sign in.");
        return;
      }
      setCodeSent(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't send the code";
      setErrorText(/not found|no account/i.test(msg) ? "No account found with that email." : msg);
    } finally {
      setBusy(false);
    }
  };

  const onVerifyCode = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setErrorText("");
    try {
      const result = await verifyLoginOtp(code.trim());
      if (result.step === "needs_second_factor") {
        setErrorText("This account has two-factor authentication enabled, which isn't supported here yet.");
      } else if (result.step === "needs_code") {
        setErrorText("Incorrect code. Please try again.");
      }
      // step === "complete": session is active, the app's root auth-state
      // listener takes over navigation from here — nothing more to do.
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Verification failed";
      setErrorText(/incorrect|invalid/i.test(msg) ? "Incorrect code. Please try again." : msg);
    } finally {
      setBusy(false);
    }
  };

  const onResendCode = async () => {
    if (cooldown > 0 || busy) return;
    setBusy(true);
    setErrorText("");
    try {
      await resendLoginOtp();
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't resend the code";
      setErrorText(msg);
    } finally {
      setBusy(false);
    }
  };

  const onGooglePress = async () => {
    if (busy) return;
    setBusy(true);
    setErrorText("");
    try {
      polyfillBrowserApis();
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: "oauth_google",
        redirectUrl: "tripsync://oauth/callback",
      });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Google sign-in failed";
      setErrorText(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreenShell
      title="Let's Sign You In"
      subtitle="Welcome back, you've been missed!"
      onBack={() => safeGoBack(navigation, "Onboarding")}
    >
      {/* Mode tabs */}
      <View style={{ flexDirection: "row", marginBottom: 18, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: c.borderDefault }}>
        <Pressable
          onPress={() => switchMode("password")}
          style={{
            flex: 1,
            paddingVertical: 10,
            alignItems: "center",
            backgroundColor: mode === "password" ? c.accentOrange : "transparent",
          }}
        >
          <Text style={{ color: mode === "password" ? "#fff" : c.textSecondary, fontWeight: "600", fontSize: 13 }}>
            Password
          </Text>
        </Pressable>
        <Pressable
          onPress={() => switchMode("code")}
          style={{
            flex: 1,
            paddingVertical: 10,
            alignItems: "center",
            backgroundColor: mode === "code" ? c.accentOrange : "transparent",
          }}
        >
          <Text style={{ color: mode === "code" ? "#fff" : c.textSecondary, fontWeight: "600", fontSize: 13 }}>
            Email Code
          </Text>
        </Pressable>
      </View>

      {mode === "password" ? (
        <>
          <InputField
            label="Email Address"
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setWrongPassword(false);
              setErrorText("");
            }}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <InputField
            label="Password"
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setWrongPassword(false);
              setErrorText("");
            }}
            secure
            status={wrongPassword ? "error" : "default"}
          />
          {errorText ? (
            <Text style={{ color: c.borderError, marginTop: 6, fontSize: 12 }}>{errorText}</Text>
          ) : null}

          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 14 }}>
            <View style={{ flex: 1 }}>
              <CheckboxRow
                checked={rememberMe && !wrongPassword}
                onPress={() => setRememberMe((v) => !v)}
                label={<Text style={{ color: c.textPrimary, fontSize: 13, fontWeight: "600" }}>Remember Me</Text>}
              />
            </View>
            <Pressable onPress={() => navigation.navigate("ForgotPassword")}>
              <Text style={{ color: c.accentOrange, fontSize: 12, fontWeight: "500" }}>Forgot Password ?</Text>
            </Pressable>
          </View>

          <PrimaryButton
            title={busy ? "Logging in..." : "Login"}
            onPress={onSubmitPassword}
            disabled={busy || !email.trim() || !password || wrongPassword}
          />
        </>
      ) : (
        <>
          <InputField
            label="Email Address"
            value={codeEmail}
            onChangeText={(v) => {
              setCodeEmail(v);
              setErrorText("");
            }}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          {codeSent ? (
            <>
              <InputField
                label="Verification Code"
                value={code}
                onChangeText={(v) => {
                  setCode(v.replace(/[^0-9]/g, "").slice(0, 6));
                  setErrorText("");
                }}
                keyboardType="number-pad"
                autoCapitalize="none"
              />
              {errorText ? (
                <Text style={{ color: c.borderError, marginTop: 6, fontSize: 12 }}>{errorText}</Text>
              ) : null}

              <PrimaryButton
                title={busy ? "Verifying..." : "Verify & Sign In"}
                onPress={onVerifyCode}
                disabled={busy || code.trim().length < 6}
              />

              <Pressable onPress={onResendCode} disabled={cooldown > 0 || busy} style={{ marginTop: 16 }}>
                <Text style={{ textAlign: "center", color: cooldown > 0 ? c.textSecondary : c.accentOrange, fontSize: 13, fontWeight: "600" }}>
                  {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              {errorText ? (
                <Text style={{ color: c.borderError, marginTop: 6, fontSize: 12 }}>{errorText}</Text>
              ) : null}
              <PrimaryButton
                title={busy ? "Sending..." : "Send Code"}
                onPress={onSendCode}
                disabled={busy || !codeEmail.trim()}
              />
            </>
          )}
        </>
      )}

      {busy ? <ActivityIndicator color={c.accentOrange} style={{ marginTop: 8 }} /> : null}
      <DividerOr />
      <GoogleButton onPress={onGooglePress} />

      <Pressable onPress={() => navigation.navigate("Signup")} style={{ marginTop: 14 }}>
        <Text style={{ textAlign: "center", color: c.textSecondary, fontSize: 13 }}>
          Don't have an account ? <Text style={{ color: c.accentOrange, fontWeight: "600" }}>Sign Up</Text>
        </Text>
      </Pressable>
    </AuthScreenShell>
  );
}