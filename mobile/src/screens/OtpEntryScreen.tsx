import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useAuth } from "../context/AuthContext";
import { useAuthPalette } from "../theme/authTheme";
import { AuthScreenShell, InputField, PrimaryButton } from "../components/auth/AuthUI";

type Props = NativeStackScreenProps<RootStackParamList, "OtpEntry">;

const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Email OTP entry for email/password signups. Reached right after
 * signup() in SignupScreen, which already sent the first code via
 * AuthContext.signup() -> prepareEmailAddressVerification().
 *
 * Google signups never hit this screen — Google's email arrives
 * pre-verified, so those signups complete in one step inside
 * SignupScreen's Google handler.
 */
export function OtpEntryScreen({ navigation }: Props) {
  const c = useAuthPalette();
  const { verifyEmailOtp, resendEmailOtp } = useAuth();

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Start the resend cooldown as soon as this screen mounts, since the
  // first code was already sent by SignupScreen's call to signup().
  useEffect(() => {
    setCooldown(RESEND_COOLDOWN_SECONDS);
  }, []);

  const onVerify = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setErrorText("");
    try {
      const result = await verifyEmailOtp(code.trim());
      if (result.step === "complete") {
        navigation.reset({ index: 0, routes: [{ name: "AuthBootstrap" }] });
      } else {
        setErrorText("That code didn't work. Please try again.");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Verification failed";
      setErrorText(/incorrect|invalid/i.test(msg) ? "Incorrect code. Please try again." : msg);
    } finally {
      setBusy(false);
    }
  };

  const onResend = async () => {
    if (cooldown > 0 || busy) return;
    setBusy(true);
    setErrorText("");
    try {
      await resendEmailOtp();
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
      title="Verify Your Email"
      subtitle="Enter the 6-digit code we just sent to your email."
      onBack={() => navigation.goBack()}
    >
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
        title={busy ? "Verifying..." : "Verify"}
        onPress={onVerify}
        disabled={busy || code.trim().length < 6}
      />
      {busy ? <ActivityIndicator color={c.accentOrange} style={{ marginTop: 8 }} /> : null}

      <Pressable onPress={onResend} disabled={cooldown > 0 || busy} style={{ marginTop: 16 }}>
        <Text style={{ textAlign: "center", color: cooldown > 0 ? c.textSecondary : c.accentOrange, fontSize: 13, fontWeight: "600" }}>
          {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </Text>
      </Pressable>
    </AuthScreenShell>
  );
}