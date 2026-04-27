import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { ProfileLayout } from "../components/profile/ProfileLayout";
import { useAuthPalette } from "../theme/authTheme";
import { useAuth } from "../context/AuthContext";

type Props = NativeStackScreenProps<RootStackParamList, "ChangePassword">;

export function ChangePasswordScreen({ navigation }: Props) {
  const c = useAuthPalette();
  const { logout } = useAuth();
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const passwordsMatch = useMemo(() => newPw.length > 0 && newPw === confirmPw, [newPw, confirmPw]);
  const isDisabled = !currentPw || !newPw || !confirmPw || !passwordsMatch || loading;
  const confirmBorder = confirmPw.length === 0 ? c.borderDefault : passwordsMatch ? "#4CAF50" : "#E05555";

  const onSave = async () => {
    if (isDisabled) return;
    setLoading(true);
    setError("");
    try {
      await logout();
      navigation.replace("Login");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to change password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ProfileLayout navigation={navigation} title="Change Password" fallback="EditProfile">
      <Text style={[styles.heading, { color: c.textPrimary }]}>Change Password</Text>
      <Text style={[styles.subtitle, { color: c.textSecondary }]}>
        Please note changing password will required again login to the app.
      </Text>

      <Field
        label="Current Password"
        value={currentPw}
        onChange={setCurrentPw}
        hidden={!showCurrent}
        toggle={() => setShowCurrent((s) => !s)}
        borderColor={c.borderDefault}
        c={c}
      />
      <Field
        label="New Password"
        value={newPw}
        onChange={setNewPw}
        hidden={!showNew}
        toggle={() => setShowNew((s) => !s)}
        borderColor={c.borderDefault}
        c={c}
      />
      <Field
        label="Confirm New Password"
        value={confirmPw}
        onChange={setConfirmPw}
        hidden={!showConfirm}
        toggle={() => setShowConfirm((s) => !s)}
        borderColor={confirmBorder}
        right={passwordsMatch ? "✓" : ""}
        c={c}
      />

      {error ? <Text style={{ color: "#E05555", marginTop: 8 }}>{error}</Text> : null}

      <Pressable
        style={[
          styles.saveBtn,
          { backgroundColor: isDisabled ? c.btnDisabledBg : "#4FA88A" },
        ]}
        onPress={() => void onSave()}
        disabled={isDisabled}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save Password</Text>}
      </Pressable>
    </ProfileLayout>
  );
}

function Field({
  label,
  value,
  onChange,
  hidden,
  toggle,
  borderColor,
  right,
  c,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hidden: boolean;
  toggle: () => void;
  borderColor: string;
  right?: string;
  c: ReturnType<typeof useAuthPalette>;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={[styles.label, { color: c.textSecondary }]}>{label}</Text>
      <View style={[styles.inputWrap, { backgroundColor: c.bgInput, borderColor }]}>
        <TextInput
          style={[styles.input, { color: c.textPrimary }]}
          value={value}
          onChangeText={onChange}
          secureTextEntry={hidden}
        />
        <Pressable onPress={toggle}>
          <Text style={{ color: c.textSecondary }}>👁</Text>
        </Pressable>
        {right ? <Text style={{ color: "#4CAF50", marginLeft: 8, fontWeight: "700" }}>{right}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 26 / 1.54, fontWeight: "700", marginTop: 6 },
  subtitle: { fontSize: 14, marginTop: 8, marginBottom: 14, lineHeight: 20 },
  fieldWrap: { marginTop: 8 },
  label: { fontSize: 11, marginBottom: 6 },
  inputWrap: {
    borderWidth: 1.5,
    borderRadius: 10,
    minHeight: 50,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  input: { flex: 1, paddingVertical: 10, fontSize: 14 },
  saveBtn: { marginTop: 16, borderRadius: 12, paddingVertical: 15, alignItems: "center" },
  saveText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
});
