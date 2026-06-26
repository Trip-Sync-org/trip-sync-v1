import React, { useMemo, useState, useRef } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View, Alert, Modal, FlatList } from "react-native";
import { Camera, ChevronDown } from "lucide-react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { ProfileLayout } from "../components/profile/ProfileLayout";
import { useAuthPalette } from "../theme/authTheme";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../api/client";
import { navigateToRootStack } from "../navigation/navigateRoot";
import { useR2Upload } from "../hooks/useR2Upload";
import { supabase } from "../lib/supabase";

type Props = NativeStackScreenProps<RootStackParamList, "EditProfile">;

const COUNTRY_CODES = [
  { code: "1", flag: "🇺🇸", name: "United States" },
  { code: "1", flag: "🇨🇦", name: "Canada" },
  { code: "44", flag: "🇬🇧", name: "United Kingdom" },
  { code: "61", flag: "🇦🇺", name: "Australia" },
  { code: "91", flag: "🇮🇳", name: "India" },
  { code: "86", flag: "🇨🇳", name: "China" },
  { code: "81", flag: "🇯🇵", name: "Japan" },
  { code: "82", flag: "🇰🇷", name: "South Korea" },
  { code: "49", flag: "🇩🇪", name: "Germany" },
  { code: "33", flag: "🇫🇷", name: "France" },
  { code: "39", flag: "🇮🇹", name: "Italy" },
  { code: "34", flag: "🇪🇸", name: "Spain" },
  { code: "55", flag: "🇧🇷", name: "Brazil" },
  { code: "52", flag: "🇲🇽", name: "Mexico" },
  { code: "7", flag: "🇷🇺", name: "Russia" },
  { code: "971", flag: "🇦🇪", name: "UAE" },
  { code: "966", flag: "🇸🇦", name: "Saudi Arabia" },
  { code: "65", flag: "🇸🇬", name: "Singapore" },
  { code: "60", flag: "🇲🇾", name: "Malaysia" },
  { code: "63", flag: "🇵🇭", name: "Philippines" },
  { code: "62", flag: "🇮🇩", name: "Indonesia" },
  { code: "64", flag: "🇳🇿", name: "New Zealand" },
  { code: "27", flag: "🇿🇦", name: "South Africa" },
  { code: "46", flag: "🇸🇪", name: "Sweden" },
  { code: "47", flag: "🇳🇴", name: "Norway" },
  { code: "45", flag: "🇩🇰", name: "Denmark" },
  { code: "358", flag: "🇫🇮", name: "Finland" },
  { code: "31", flag: "🇳🇱", name: "Netherlands" },
  { code: "32", flag: "🇧🇪", name: "Belgium" },
  { code: "41", flag: "🇨🇭", name: "Switzerland" },
  { code: "43", flag: "🇦🇹", name: "Austria" },
  { code: "353", flag: "🇮🇪", name: "Ireland" },
  { code: "351", flag: "🇵🇹", name: "Portugal" },
  { code: "30", flag: "🇬🇷", name: "Greece" },
  { code: "48", flag: "🇵🇱", name: "Poland" },
  { code: "36", flag: "🇭🇺", name: "Hungary" },
  { code: "420", flag: "🇨🇿", name: "Czech Republic" },
  { code: "40", flag: "🇷🇴", name: "Romania" },
  { code: "380", flag: "🇺🇦", name: "Ukraine" },
  { code: "90", flag: "🇹🇷", name: "Turkey" },
  { code: "972", flag: "🇮🇱", name: "Israel" },
  { code: "20", flag: "🇪🇬", name: "Egypt" },
  { code: "234", flag: "🇳🇬", name: "Nigeria" },
  { code: "254", flag: "🇰🇪", name: "Kenya" },
  { code: "233", flag: "🇬🇭", name: "Ghana" },
  { code: "880", flag: "🇧🇩", name: "Bangladesh" },
  { code: "92", flag: "🇵🇰", name: "Pakistan" },
  { code: "94", flag: "🇱🇰", name: "Sri Lanka" },
  { code: "977", flag: "🇳🇵", name: "Nepal" },
  { code: "66", flag: "🇹🇭", name: "Thailand" },
  { code: "84", flag: "🇻🇳", name: "Vietnam" },
];

export function EditProfileScreen({ navigation }: Props) {
  const c = useAuthPalette();
  const rootNav = useNavigation();
  const { user } = useAuth();
  const { pickAndUpload, isUploading, uploadProgress } = useR2Upload();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.avatar_url ?? null);

  // Fetch latest avatar from Supabase (same pattern as ProfileScreen)
  const fetchAvatar = React.useCallback(async () => {
    if (!supabase || !user?.authUserId) return;
    try {
      const { data } = await supabase
        .from("users")
        .select("avatar_url, name")
        .eq("clerk_id", user.authUserId)
        .single();
      if (data?.avatar_url) {
        setAvatarUrl(data.avatar_url);
      }
    } catch { /* ignore */ }
  }, [user?.authUserId]);

  React.useEffect(() => {
    if (user?.avatar_url) {
      setAvatarUrl(user.avatar_url);
    } else {
      fetchAvatar();
    }
  }, [user?.id, user?.avatar_url, fetchAvatar]);

  // Refetch on screen focus
  React.useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      fetchAvatar();
    });
    return unsubscribe;
  }, [navigation, fetchAvatar]);

  const avatarUri = useMemo(
    () => avatarUrl || `https://api.dicebear.com/7.x/avataaars/png?seed=${encodeURIComponent(user?.name || "User")}`,
    [avatarUrl, user?.name],
  );
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState("");
  const [selectedCountry, setSelectedCountry] = useState(
    COUNTRY_CODES.find((c) => c.code === "91" && c.flag === "🇮🇳") ?? COUNTRY_CODES[0],
  );
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [address, setAddress] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [stateName, setStateName] = useState("");
  const [password] = useState("••••••");
  const [saving, setSaving] = useState(false);

  const fullPhone = `+${selectedCountry.code}${phone}`;
  const isValidPhone = /^\d{7,15}$/.test(fullPhone.replace(/\D/g, ""));

  const pickAvatar = async () => {
    if (!user?.id) return;
    const results = await pickAndUpload({
      entityType: "profile",
      entityId: user.id,
      maxFiles: 1,
      accept: "images",
    });
    if (results.length > 0) {
      const uploaded = results[0];
      console.log("[EditProfile] Uploaded avatar URL:", uploaded.url);
      setAvatarUrl(uploaded.url); // Optimistic update
      // Save to Supabase profiles table using clerk_id, not numeric id
      if (supabase && user.authUserId) {
        try {
          const { data, error } = await supabase
            .from("users")
            .update({ avatar_url: uploaded.url })
            .eq("clerk_id", user.authUserId);
          if (error) {
            console.warn("[EditProfile] Supabase update error:", error);
          } else {
            console.log("[EditProfile] Avatar URL saved to users.avatar_url");
          }
        } catch (e) {
          console.warn("[EditProfile] Failed to save avatar_url to Supabase:", e);
        }
      }
    }
  };

  const onSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      if (user.activeRole === "organizer") {
        await apiFetch(`/api/organizers/${user.id}/profile`, {
          method: "PATCH",
          body: JSON.stringify({ name: name.trim(), email: email.trim(), phone: fullPhone }),
        });
      }
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  };

  const renderCountryItem = ({ item }: { item: typeof COUNTRY_CODES[0] }) => (
    <Pressable
      style={[styles.countryItem, { borderBottomColor: c.borderDefault }]}
      onPress={() => {
        setSelectedCountry(item);
        setShowCountryPicker(false);
      }}
    >
      <Text style={styles.countryFlag}>{item.flag}</Text>
      <Text style={[styles.countryName, { color: c.textPrimary }]}>{item.name}</Text>
      <Text style={[styles.countryCode, { color: c.textSecondary }]}>+{item.code}</Text>
    </Pressable>
  );

  return (
    <ProfileLayout navigation={navigation} title="Edit Profile" fallback="Main">
      <View style={styles.center}>
        <Pressable style={styles.avatarWrapper} onPress={pickAvatar} disabled={isUploading}>
          <Image source={{ uri: avatarUri }} style={styles.avatar} />
          {isUploading ? (
            <View style={[styles.cameraOverlay, { backgroundColor: "rgba(0,0,0,0.6)" }]}>
              <ActivityIndicator color="#fff" size="small" />
            </View>
          ) : (
            <View style={[styles.cameraOverlay, { backgroundColor: c.accentOrange }]}>
              <Camera color={c.bgCard} size={14} strokeWidth={2} />
            </View>
          )}
        </Pressable>
      </View>

      <Text style={[styles.label, { color: c.textSecondary }]}>Full Name</Text>
      <TextInput style={[styles.input, { backgroundColor: c.bgInput, borderColor: c.borderDefault, color: c.textPrimary }]} value={name} onChangeText={setName} />

      <Text style={[styles.label, { color: c.textSecondary }]}>Email Address</Text>
      <TextInput style={[styles.input, { backgroundColor: c.bgInput, borderColor: c.borderDefault, color: c.textPrimary }]} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />

      <Text style={[styles.label, { color: c.textSecondary }]}>Phone Number</Text>
      <View style={[styles.phoneRow, { backgroundColor: c.bgInput, borderColor: c.borderDefault }]}>
        <Pressable style={styles.flagPicker} onPress={() => setShowCountryPicker(true)}>
          <Text style={styles.countryFlagSmall}>{selectedCountry.flag}</Text>
          <Text style={{ color: c.textPrimary, marginLeft: 4 }}>+{selectedCountry.code}</Text>
          <ChevronDown color={c.textSecondary} size={14} strokeWidth={2} style={{ marginLeft: 4 }} />
        </Pressable>
        <View style={styles.phoneDivider} />
        <TextInput
          style={[styles.phoneInput, { color: c.textPrimary }]}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="999 999 999"
          placeholderTextColor={c.textPlaceholder}
        />
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
        {saving ? <ActivityIndicator color={c.bgCard} /> : <Text style={[styles.saveText, { color: c.bgCard }]}>Save Changes</Text>}
      </Pressable>

      <Modal visible={showCountryPicker} transparent animationType="slide">
        <View style={[styles.modalOverlay, { backgroundColor: "rgba(0,0,0,0.5)" }]}>
          <View style={[styles.modalSheet, { backgroundColor: c.bgCard }]}>
            <View style={[styles.modalHeader, { borderBottomColor: c.borderDefault }]}>
              <Text style={[styles.modalTitle, { color: c.textPrimary }]}>Select Country Code</Text>
              <Pressable onPress={() => setShowCountryPicker(false)}>
                <Text style={[styles.modalClose, { color: c.accentOrange }]}>Close</Text>
              </Pressable>
            </View>
            <FlatList
              data={COUNTRY_CODES}
              keyExtractor={(item) => `${item.flag}-${item.code}`}
              renderItem={renderCountryItem}
              style={styles.countryList}
            />
          </View>
        </View>
      </Modal>
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
  flagPicker: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 8,
  },
  countryFlagSmall: { fontSize: 22 },
  phoneDivider: {
    width: 1,
    height: 28,
    backgroundColor: "rgba(128,128,128,0.3)",
    marginRight: 8,
  },
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
  // Country picker modal
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "70%",
    paddingBottom: 30,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 16, fontWeight: "700" },
  modalClose: { fontSize: 15, fontWeight: "600" },
  countryList: {
    paddingHorizontal: 8,
  },
  countryItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  countryFlag: { fontSize: 26, marginRight: 12 },
  countryName: { flex: 1, fontSize: 15 },
  countryCode: { fontSize: 14 },
});