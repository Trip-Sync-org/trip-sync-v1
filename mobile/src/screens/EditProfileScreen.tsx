import React, { useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { ProfileLayout } from "../components/profile/ProfileLayout";
import { useAuthPalette } from "../theme/authTheme";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../api/client";
import { navigateToRootStack } from "../navigation/navigateRoot";

type Props = NativeStackScreenProps<RootStackParamList, "EditProfile">;

export function EditProfileScreen({ navigation }: Props) {
  const c = useAuthPalette();
  const rootNav = useNavigation();
  const { user } = useAuth();
  const avatarUri = useMemo(
    () => `https://api.dicebear.com/7.x/avataaars/png?seed=${encodeURIComponent(user?.name || "User")}`,
    [user?.name],
  );
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [stateName, setStateName] = useState("");
  const [password] = useState("••••••");
  const [saving, setSaving] = useState(false);

  const isValidPhone = /^\d{7,15}$/.test(phone.replace(/\D/g, ""));

  const onSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      if (user.role === "organizer") {
        await apiFetch(`/api/organizers/${user.id}/profile`, {
          method: "PATCH",
          body: JSON.stringify({ name: name.trim(), email: email.trim(), phone: phone.trim() }),
        });
      }
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ProfileLayout navigation={navigation} title="Edit Profile" fallback="Main">
      <View style={styles.center}>
        <View style={styles.avatarWrapper}>
          <Image source={{ uri: avatarUri }} style={styles.avatar} />
          <View style={[styles.cameraOverlay, { backgroundColor: c.accentOrange }]}>
            <Text>📷</Text>
          </View>
        </View>
      </View>

      <Text style={[styles.label, { color: c.textSecondary }]}>Full Name</Text>
      <TextInput style={[styles.input, { backgroundColor: c.bgInput, borderColor: c.borderDefault, color: c.textPrimary }]} value={name} onChangeText={setName} />

      <Text style={[styles.label, { color: c.textSecondary }]}>Email Address</Text>
      <TextInput style={[styles.input, { backgroundColor: c.bgInput, borderColor: c.borderDefault, color: c.textPrimary }]} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />

      <Text style={[styles.label, { color: c.textSecondary }]}>Phone Number</Text>
      <View style={[styles.phoneRow, { backgroundColor: c.bgInput, borderColor: c.borderDefault }]}>
        <View style={styles.flagPicker}>
          <Text>🇺🇸</Text>
          <Text style={{ color: c.textPrimary, marginLeft: 6 }}>+1</Text>
        </View>
        <TextInput style={[styles.phoneInput, { color: c.textPrimary }]} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="999 999 999" placeholderTextColor={c.textPlaceholder} />
        {isValidPhone ? <Text style={{ color: "#4CAF50", fontWeight: "700" }}>✓</Text> : null}
      </View>

      <Text style={[styles.label, { color: c.textSecondary }]}>Current Address</Text>
      <TextInput style={[styles.input, { backgroundColor: c.bgInput, borderColor: c.borderDefault, color: c.textPrimary }]} value={address} onChangeText={setAddress} />

      <View style={styles.row}>
        <View style={styles.half}>
          <Text style={[styles.label, { color: c.textSecondary }]}>Zip Code</Text>
          <TextInput style={[styles.input, { backgroundColor: c.bgInput, borderColor: c.borderDefault, color: c.textPrimary }]} value={zipCode} onChangeText={setZipCode} keyboardType="number-pad" />
        </View>
        <View style={styles.half}>
          <Text style={[styles.label, { color: c.textSecondary }]}>State</Text>
          <TextInput style={[styles.input, { backgroundColor: c.bgInput, borderColor: c.borderDefault, color: c.textPrimary }]} value={stateName} onChangeText={setStateName} />
        </View>
      </View>

      <Text style={[styles.label, { color: c.textSecondary }]}>Password</Text>
      <TextInput style={[styles.input, { backgroundColor: c.bgInput, borderColor: c.borderDefault, color: c.textPrimary }]} value={password} editable={false} />

      <Pressable
        style={[styles.changeBtn, { borderColor: c.accentOrange }]}
        onPress={() => navigateToRootStack(rootNav, "ChangePassword")}
      >
        <Text style={{ color: c.accentOrange, fontWeight: "600" }}>Change Password  →</Text>
      </Pressable>

      <Pressable style={[styles.saveBtn, { backgroundColor: c.accentOrange }]} onPress={() => void onSave()}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save Changes</Text>}
      </Pressable>
    </ProfileLayout>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", marginTop: 2, marginBottom: 10 },
  avatarWrapper: { position: "relative" },
  avatar: { width: 84, height: 84, borderRadius: 42 },
  cameraOverlay: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontSize: 11, marginTop: 8, marginBottom: 6 },
  input: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, height: 50 },
  row: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
  phoneRow: {
    height: 50,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  flagPicker: { flexDirection: "row", alignItems: "center", marginRight: 8 },
  phoneInput: { flex: 1, fontSize: 14 },
  changeBtn: {
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    marginTop: 14,
    marginBottom: 12,
  },
  saveBtn: { borderRadius: 12, padding: 16, alignItems: "center" },
  saveText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
});
