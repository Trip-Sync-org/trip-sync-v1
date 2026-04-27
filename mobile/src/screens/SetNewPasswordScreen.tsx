import React, { useMemo, useState } from "react";
import { ActivityIndicator, Text } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { AuthScreenShell, InputField, PrimaryButton } from "../components/auth/AuthUI";
import { useAuth } from "../context/AuthContext";
import { useAuthPalette } from "../theme/authTheme";
import { safeGoBack } from "../utils/navigation";

type Props = NativeStackScreenProps<RootStackParamList, "SetNewPassword">;

export function SetNewPasswordScreen({ navigation, route }: Props) {
  const c = useAuthPalette();
  const { resetPassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const passwordStatus = useMemo(() => {
    if (!confirmPassword.length) return "default";
    return confirmPassword === password ? "success" : "error";
  }, [confirmPassword, password]);

  const hasMismatch = !!password && !!confirmPassword && password !== confirmPassword;
  const token = route.params?.token;

  const onSave = async () => {
    if (!token || !password || hasMismatch) return;
    setBusy(true);
    setError("");
    try {
      await resetPassword(token, password);
      navigation.navigate("Login");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Reset failed";
      setError(/token/i.test(msg) ? "Invalid or expired reset link." : "Connection failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreenShell
      title="Set new password"
      subtitle="Create strong and secured new password."
      onBack={() => safeGoBack(navigation, "Login")}
    >
      <InputField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secure
        status={hasMismatch ? "error" : "default"}
      />
      <InputField
        label="Confirm Password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secure
        status={passwordStatus}
        rightText={hasMismatch ? undefined : passwordStatus === "success" ? "✓" : undefined}
      />
      <PrimaryButton
        title={busy ? "Saving..." : "Save Password"}
        disabled={busy || !password || !confirmPassword || hasMismatch || !token}
        onPress={onSave}
      />
      {busy ? <ActivityIndicator color={c.accentOrange} style={{ marginTop: 8 }} /> : null}
      {error ? <Text style={{ color: c.borderError, marginTop: 8, fontSize: 12 }}>{error}</Text> : null}
      {!token ? (
        <Text style={{ color: c.textSecondary, marginTop: 8, fontSize: 12 }}>
          Open this screen from the reset email link to set a new password.
        </Text>
      ) : null}
    </AuthScreenShell>
  );
}
