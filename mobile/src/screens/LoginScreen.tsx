import React, { useState } from "react";
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

type Props = NativeStackScreenProps<RootStackParamList, "Login">;

export function LoginScreen({ navigation }: Props) {
  const c = useAuthPalette();
  const { login } = useAuth();
  const { startSSOFlow } = useSSO();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [wrongPassword, setWrongPassword] = useState(false);
  const [errorText, setErrorText] = useState("");

  const onSubmit = async () => {
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

  return (
    <AuthScreenShell
      title="Let's Sign You In"
      subtitle="Welcome back, you've been missed!"
      onBack={() => safeGoBack(navigation, "Onboarding")}
    >
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
        onPress={onSubmit}
        disabled={busy || !email.trim() || !password || wrongPassword}
      />
      {busy ? <ActivityIndicator color={c.accentOrange} style={{ marginTop: 8 }} /> : null}
      <DividerOr />
      <GoogleButton onPress={async () => {
        if (busy) return;
        setBusy(true);
        setErrorText("");
        try {
          const { createdSessionId, setActive } = await startSSOFlow({ strategy: "oauth_google" });
          if (createdSessionId && setActive) {
            await setActive({ session: createdSessionId });
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "Google sign-in failed";
          setErrorText(msg);
        } finally {
          setBusy(false);
        }
      }} />

      <Pressable onPress={() => navigation.navigate("Signup")} style={{ marginTop: 14 }}>
        <Text style={{ textAlign: "center", color: c.textSecondary, fontSize: 13 }}>
          Don't have an account ? <Text style={{ color: c.accentOrange, fontWeight: "600" }}>Sign Up</Text>
        </Text>
      </Pressable>
    </AuthScreenShell>
  );
}