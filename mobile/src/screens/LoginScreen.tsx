import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useAuth } from "../context/AuthContext";
import { useAuthPalette } from "../theme/authTheme";
import {
  AuthScreenShell,
  CheckboxRow,
  DividerOr,
  GoogleButton,
  InputField,
  PrimaryButton,
  RoleSwitch,
} from "../components/auth/AuthUI";
import { safeGoBack } from "../utils/navigation";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;

export function LoginScreen({ navigation }: Props) {
  const c = useAuthPalette();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userType, setUserType] = useState<"explorer" | "organisor">("explorer");
  const [rememberMe, setRememberMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [wrongPassword, setWrongPassword] = useState(false);
  const [errorText, setErrorText] = useState("");

  const onSubmit = async () => {
    if (!email.trim() || !password || wrongPassword) return;
    setBusy(true);
    setErrorText("");
    try {
      await login(email.trim(), password, userType, rememberMe);
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
      <RoleSwitch value={userType} onChange={setUserType} />

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
      <GoogleButton onPress={() => {}} />

      <Pressable onPress={() => navigation.navigate("Signup")} style={{ marginTop: 14 }}>
        <Text style={{ textAlign: "center", color: c.textSecondary, fontSize: 13 }}>
          Don't have an account ? <Text style={{ color: c.accentOrange, fontWeight: "600" }}>Sign Up</Text>
        </Text>
      </Pressable>
    </AuthScreenShell>
  );
}
