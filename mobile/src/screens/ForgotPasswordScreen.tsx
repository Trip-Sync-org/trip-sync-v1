import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { AuthScreenShell, InputField, PrimaryButton } from "../components/auth/AuthUI";
import { useAuth } from "../context/AuthContext";
import { useAuthPalette } from "../theme/authTheme";
import { safeGoBack } from "../utils/navigation";

type Props = NativeStackScreenProps<RootStackParamList, "ForgotPassword">;

const RESEND_COOLDOWN_SECONDS = 30;

export function ForgotPasswordScreen({ navigation }: Props) {
  const c = useAuthPalette();
  const { requestPasswordReset, confirmPasswordReset, resendPasswordReset } = useAuth();

  // Step 1: email
  const [email, setEmail] = useState("");
  const [codeSent, setCodeSent] = useState(false);

  // Step 2: code + new password
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const passwordStatus = useMemo(() => {
    if (!confirmPassword.length) return "default";
    return confirmPassword === password ? "success" : "error";
  }, [confirmPassword, password]);

  const onSendCode = async () => {
    if (!email.trim() || busy) return;
    setBusy(true);
    setErrorText("");
    try {
      await requestPasswordReset(email.trim());
      setCodeSent(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setErrorText(/no account|not found/i.test(msg) ? "No account found with this email" : "Couldn't send the code. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const onReset = async () => {
    if (!code.trim() || !password || passwordStatus === "error" || busy) return;
    setBusy(true);
    setErrorText("");
    try {
      await confirmPasswordReset(code.trim(), password);
      // On success, confirmPasswordReset calls setActive() which signs the user in.
      // The app's auth-state listener takes over navigation automatically.
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Reset failed";
      if (/code|incorrect|invalid/i.test(msg)) {
        setErrorText("Incorrect code. Please try again.");
      } else {
        setErrorText(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const onResend = async () => {
    if (cooldown > 0 || busy) return;
    setBusy(true);
    setErrorText("");
    try {
      await resendPasswordReset();
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't resend the code";
      setErrorText(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreenShell
      title="Reset Password"
      subtitle={codeSent ? "Enter the code we sent and your new password." : "Enter your email to receive a reset code."}
      onBack={() => safeGoBack(navigation, "Login")}
    >
      {!codeSent ? (
        <>
          <InputField
            label="Email Address"
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setErrorText("");
            }}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          {errorText ? (
            <Text style={{ color: c.borderError, marginTop: 6, fontSize: 12 }}>{errorText}</Text>
          ) : null}
          <PrimaryButton title={busy ? "Sending..." : "Send Reset Code"} onPress={onSendCode} disabled={busy || !email.trim()} />
        </>
      ) : (
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
          <InputField
            label="New Password"
            value={password}
            onChangeText={setPassword}
            secure
          />
          <InputField
            label="Confirm Password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secure
            status={passwordStatus}
            rightText={passwordStatus === "success" ? "✓" : undefined}
          />
          {errorText ? (
            <Text style={{ color: c.borderError, marginTop: 6, fontSize: 12 }}>{errorText}</Text>
          ) : null}
          <PrimaryButton
            title={busy ? "Resetting..." : "Reset & Sign In"}
            onPress={onReset}
            disabled={busy || code.trim().length < 6 || !password || passwordStatus === "error"}
          />

          <Pressable onPress={onResend} disabled={cooldown > 0 || busy} style={{ marginTop: 16 }}>
            <Text style={{ textAlign: "center", color: cooldown > 0 ? c.textSecondary : c.accentOrange, fontSize: 13, fontWeight: "600" }}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
            </Text>
          </Pressable>
        </>
      )}
      {busy ? <ActivityIndicator color={c.accentOrange} style={{ marginTop: 8 }} /> : null}
    </AuthScreenShell>
  );
}