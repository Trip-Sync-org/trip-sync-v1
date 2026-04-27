import React, { useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import { useAuthPalette } from "../theme/authTheme";
import { ProfileLayout } from "../components/profile/ProfileLayout";
import { navigateToRootStack } from "../navigation/navigateRoot";
import { useNavigation } from "@react-navigation/native";

export function ProfileScreen() {
  const c = useAuthPalette();
  const { user, logout } = useAuth();
  const navigation = useNavigation();
  const [pushNotifs, setPushNotifs] = useState(true);
  const [promoNotifs, setPromoNotifs] = useState(true);
  const avatarUri = `https://api.dicebear.com/7.x/avataaars/png?seed=${encodeURIComponent(user?.name || "User")}`;

  const onLogout = () => {
    Alert.alert("Sign out?", undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void logout() },
    ]);
  };

  return (
    <ProfileLayout navigation={navigation} title="Profile" fallback="Main">
      <View style={styles.center}>
        <Pressable onPress={() => navigateToRootStack(navigation, "EditProfile")}>
          <Image source={{ uri: avatarUri }} style={styles.avatar} />
        </Pressable>
        <Text style={[styles.name, { color: c.textPrimary }]}>{user?.name || "User"}</Text>
        <Text style={[styles.email, { color: c.textSecondary }]}>{user?.email || ""}</Text>
        <Pressable
          style={[styles.editBtn, { borderColor: c.accentOrange }]}
          onPress={() => navigateToRootStack(navigation, "EditProfile")}
        >
          <Text style={[styles.editText, { color: c.accentOrange }]}>Edit</Text>
        </Pressable>
      </View>

      <Text style={[styles.sectionLabel, { color: c.accentOrange }]}>GENERAL</Text>
      <View style={[styles.card, { backgroundColor: c.bgCard, borderColor: c.borderDefault }]}>
        <MenuItem icon="💳" title="Payment Methods" subtitle="Add your credit & debit cards" onPress={() => {}} c={c} />
        <MenuItem icon="📍" title="Locations" subtitle="Add your home & work locations" onPress={() => {}} c={c} />
        <MenuItem icon="📷" title="Add Social Account" subtitle="Add Facebook, Instagram, Twitter etc" onPress={() => {}} c={c} />
        <MenuItem icon="🎁" title="Refer to Friends" subtitle="Get $10 for referring friends" onPress={() => navigateToRootStack(navigation, "ReferFriends")} c={c} last />
      </View>

      <Text style={[styles.sectionLabel, { color: c.accentOrange }]}>NOTIFICATIONS</Text>
      <View style={[styles.card, { backgroundColor: c.bgCard, borderColor: c.borderDefault }]}>
        <ToggleRow
          icon="🔔"
          title="Push Notifications"
          subtitle="For daily update and others."
          value={pushNotifs}
          onChange={setPushNotifs}
          c={c}
        />
        <ToggleRow
          icon="📢"
          title="Promotional Notifications"
          subtitle="New Campaign & Offers"
          value={promoNotifs}
          onChange={setPromoNotifs}
          c={c}
          last
        />
      </View>

      <Text style={[styles.sectionLabel, { color: c.accentOrange }]}>MORE</Text>
      <View style={[styles.card, { backgroundColor: c.bgCard, borderColor: c.borderDefault }]}>
        <MenuItem icon="📞" title="Contact Us" subtitle="For more information" onPress={() => navigateToRootStack(navigation, "ContactUs")} c={c} />
        <Pressable style={styles.rowNoBorder} onPress={onLogout}>
          <Text style={styles.rowIcon}>🚪</Text>
          <View style={styles.menuText}>
            <Text style={[styles.menuTitle, { color: "#E05555" }]}>Logout</Text>
          </View>
        </Pressable>
      </View>
    </ProfileLayout>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", paddingVertical: 6 },
  avatar: { width: 80, height: 80, borderRadius: 40 },
  name: { fontSize: 26 / 1.54, fontWeight: "700", marginTop: 10 },
  email: { fontSize: 12, marginTop: 2 },
  editBtn: {
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingVertical: 6,
    marginTop: 10,
  },
  editText: { fontSize: 13, fontWeight: "600" },
  sectionLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, marginTop: 20, marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: 14 },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
  },
  rowNoBorder: { flexDirection: "row", alignItems: "center", padding: 16 },
  rowIcon: { width: 22, fontSize: 14 },
  menuText: { flex: 1 },
  menuTitle: { fontSize: 15, fontWeight: "600" },
  menuSubtitle: { fontSize: 12, marginTop: 2 },
  arrow: { fontSize: 19, marginLeft: 6 },
});

function MenuItem({
  icon,
  title,
  subtitle,
  onPress,
  c,
  last,
}: {
  icon: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  c: ReturnType<typeof useAuthPalette>;
  last?: boolean;
}) {
  return (
    <Pressable style={[styles.menuRow, { borderBottomColor: c.borderDefault, borderBottomWidth: last ? 0 : 1 }]} onPress={onPress}>
      <Text style={styles.rowIcon}>{icon}</Text>
      <View style={styles.menuText}>
        <Text style={[styles.menuTitle, { color: c.textPrimary }]}>{title}</Text>
        <Text style={[styles.menuSubtitle, { color: c.textSecondary }]}>{subtitle}</Text>
      </View>
      <Text style={[styles.arrow, { color: c.textSecondary }]}>›</Text>
    </Pressable>
  );
}

function ToggleRow({
  icon,
  title,
  subtitle,
  value,
  onChange,
  c,
  last,
}: {
  icon: string;
  title: string;
  subtitle: string;
  value: boolean;
  onChange: (v: boolean) => void;
  c: ReturnType<typeof useAuthPalette>;
  last?: boolean;
}) {
  return (
    <View style={[styles.menuRow, { borderBottomColor: c.borderDefault, borderBottomWidth: last ? 0 : 1 }]}>
      <Text style={styles.rowIcon}>{icon}</Text>
      <View style={styles.menuText}>
        <Text style={[styles.menuTitle, { color: c.textPrimary }]}>{title}</Text>
        <Text style={[styles.menuSubtitle, { color: c.textSecondary }]}>{subtitle}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: "#555", true: "#4FA88A" }} thumbColor="#FFFFFF" />
    </View>
  );
}
