import React, { useState } from "react";
import { ActivityIndicator, Text } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { AuthScreenShell, InputField, PrimaryButton } from "../components/auth/AuthUI";
import { useAuth } from "../context/AuthContext";
import { useAuthPalette } from "../theme/authTheme";
import { safeGoBack } from "../utils/navigation";

type Props = NativeStackScreenProps<RootStackParamList, "ForgotPassword">;

export function ForgotPasswordScreen({ navigation }: Props) {
  const c = useAuthPalette();
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isValidEmail = (text: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());
  const isDisabled = !email.trim() || !isValidEmail(email) || busy;

  const onSubmit = async () => {
    if (isDisabled) return;
    setBusy(true);
    setError("");
    try {
      await forgotPassword(email.trim());
      navigation.navigate("ResetEmailSent");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setError(/no account|not found/i.test(msg) ? "No account found with this email" : "Connection failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreenShell
      title="Forget Password"
      subtitle="Enter your email address to reset password."
      onBack={() => safeGoBack(navigation, "Login")}
    >
      <InputField
        label="Email Address"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      {error ? <Text style={{ color: c.borderError, marginTop: 8, fontSize: 12 }}>{error}</Text> : null}
      <PrimaryButton title={busy ? "Resetting..." : "Reset Password"} onPress={onSubmit} disabled={isDisabled} />
      {busy ? <ActivityIndicator color={c.accentOrange} style={{ marginTop: 8 }} /> : null}
    </AuthScreenShell>
  );
}
