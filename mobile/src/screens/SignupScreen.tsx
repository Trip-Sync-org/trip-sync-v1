import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useAuth } from "../context/AuthContext";
import { useAuthPalette } from "../theme/authTheme";
import { AuthScreenShell, CheckboxRow, InputField, PrimaryButton, RoleSwitch } from "../components/auth/AuthUI";
import { safeGoBack } from "../utils/navigation";

type Props = NativeStackScreenProps<RootStackParamList, "Signup">;

export function SignupScreen({ navigation }: Props) {
  const { signup } = useAuth();
  const c = useAuthPalette();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [userType, setUserType] = useState<"explorer" | "organisor">("explorer");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");

  const passwordStatus = useMemo(() => {
    if (!confirmPassword.length) return "default";
    return confirmPassword === password ? "success" : "error";
  }, [confirmPassword, password]);

  const canContinue =
    !!name.trim() &&
    !!email.trim() &&
    !!password &&
    passwordStatus === "success" &&
    agreeTerms &&
    !busy;

  const onSubmit = async () => {
    if (!canContinue) {
      return;
    }
    setBusy(true);
    setFormError("");
    setFieldErrors({});
    try {
      await signup(email.trim(), password, name.trim() || email.split("@")[0] || "User", userType);
      navigation.navigate("Login");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Try again";
      if (/email/i.test(msg)) {
        setFieldErrors((prev) => ({ ...prev, email: msg }));
      } else {
        setFormError(/network|reach|fetch/i.test(msg) ? "Connection failed. Try again." : msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreenShell
      title="Getting Started"
      subtitle="Seems you are new here, Let's set up your profile."
      onBack={() => safeGoBack(navigation, "Login")}
    >
      <InputField label="Full Name" value={name} onChangeText={setName} autoCapitalize="words" />
      <InputField
        label="Email Address"
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          setFieldErrors((prev) => ({ ...prev, email: "" }));
        }}
        keyboardType="email-address"
        autoCapitalize="none"
        status={fieldErrors.email ? "error" : "default"}
      />
      {fieldErrors.email ? <Text style={{ color: c.borderError, marginTop: 6, fontSize: 12 }}>{fieldErrors.email}</Text> : null}
      <InputField label="Password" value={password} onChangeText={setPassword} secure />
      <InputField
        label="Confirm Password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secure
        status={passwordStatus}
        rightText={passwordStatus === "success" ? "✓" : undefined}
      />
      <RoleSwitch value={userType} onChange={setUserType} />

      <CheckboxRow
        checked={agreeTerms}
        onPress={() => setAgreeTerms((v) => !v)}
        label={
          <Text style={{ color: c.textSecondary, fontSize: 11 }}>
            By creating an account, you agree to our{" "}
            <Text style={{ color: c.accentOrange, fontWeight: "600" }}>Term and Conditions</Text>
          </Text>
        }
      />

      <PrimaryButton title={busy ? "Please wait..." : "Continue"} onPress={onSubmit} disabled={!canContinue} />
      {busy ? <ActivityIndicator color={c.accentOrange} style={{ marginTop: 8 }} /> : null}
      {formError ? <Text style={{ color: c.borderError, marginTop: 8, fontSize: 12 }}>{formError}</Text> : null}
      <Pressable onPress={() => navigation.navigate("Login")} style={{ marginTop: 14 }}>
        <Text style={{ textAlign: "center", color: c.textSecondary, fontSize: 13 }}>
          Already have an account ? <Text style={{ color: c.accentOrange, fontWeight: "600" }}>Login</Text>
        </Text>
      </Pressable>
    </AuthScreenShell>
  );
}
