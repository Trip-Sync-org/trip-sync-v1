import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useAuth } from "../context/AuthContext";
import { colors, typography } from "../theme";
import { Card } from "../components/ui";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;

export function LoginScreen({ navigation }: Props) {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "organizer">("user");
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    setBusy(true);
    try {
      await login(email.trim(), password, role);
    } catch (e: unknown) {
      Alert.alert("Login failed", e instanceof Error ? e.message : "Try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={styles.welcome}>Welcome Back</Text>
      <Text style={styles.welcomeSub}>Sign in to your NOMAD account</Text>
      <Card style={{ padding: 20, marginTop: 8 }}>
      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        placeholderTextColor={colors.muted}
      />
      <Text style={styles.label}>Password</Text>
      <TextInput
        style={styles.input}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        placeholder="••••••••"
        placeholderTextColor={colors.muted}
      />
      <Text style={styles.label}>I am a</Text>
      <View style={styles.roleRow}>
        {(["user", "organizer"] as const).map((r) => (
          <Pressable
            key={r}
            onPress={() => setRole(r)}
            style={[styles.roleChip, role === r && styles.roleChipOn]}
          >
            <Text style={[styles.roleText, role === r && styles.roleTextOn]}>
              {r === "user" ? "Explorer" : "Organizer"}
            </Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={[styles.btn, busy && { opacity: 0.6 }]} onPress={onSubmit} disabled={busy}>
        <Text style={styles.btnText}>{busy ? "…" : "Sign in"}</Text>
      </Pressable>
      <Pressable onPress={() => navigation.navigate("Signup")}>
        <Text style={styles.link}>Need an account? Sign up</Text>
      </Pressable>
      </Card>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 16 },
  welcome: { ...typography.h1, color: colors.text, textAlign: "center" },
  welcomeSub: { color: colors.muted, textAlign: "center", marginBottom: 16, fontSize: 14 },
  label: { color: colors.muted, fontSize: 12, fontWeight: "600", marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    color: colors.text,
    fontSize: 16,
  },
  roleRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  roleChip: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  roleChipOn: { backgroundColor: colors.text, borderColor: colors.text },
  roleText: { color: colors.muted, fontWeight: "600" },
  roleTextOn: { color: colors.bg },
  btn: {
    marginTop: 28,
    backgroundColor: colors.text,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
  },
  btnText: { color: colors.bg, fontWeight: "700", fontSize: 16 },
  link: { marginTop: 20, color: colors.muted, textAlign: "center" },
});
