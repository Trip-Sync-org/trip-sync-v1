import React, { useState, useRef, useCallback, useEffect } from "react";
import { ActivityIndicator, Alert, Animated, Image, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { CreditCard, MapPin, Camera, Gift, Bell, Megaphone, RefreshCw, Phone, LogOut, Compass, Briefcase, CheckCircle2, SunMoon } from "lucide-react-native";
import { useAuth } from "../context/AuthContext";
import { useAuthPalette } from "../theme/authTheme";
import { useAppTheme } from "../context/ThemeContext";
import { ProfileLayout } from "../components/profile/ProfileLayout";
import { navigateToRootStack } from "../navigation/navigateRoot";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { supabase } from "../lib/supabase";
import { ConfirmModal } from "../components/ConfirmModal";

export function ProfileScreen() {
  const c = useAuthPalette();
  const { user, logout, addRole, switchRole } = useAuth();
  const { themePreference } = useAppTheme();
  const themeLabel = themePreference === "system" ? "System default" : themePreference === "light" ? "Light" : "Dark";
  const navigation = useNavigation();
  const [pushNotifs, setPushNotifs] = useState(true);
  const [promoNotifs, setPromoNotifs] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(null);
  const [showSignOut, setShowSignOut] = useState(false);

  const fetchAvatar = React.useCallback(async () => {
    if (!supabase || !user?.authUserId) return;
    console.log("[ProfileScreen] fetching avatar for clerk_id:", user.authUserId);
    try {
      // Query users table by clerk_id
      const { data } = await supabase
        .from("users")
        .select("avatar_url, name")
        .eq("clerk_id", user.authUserId)
        .single();
      console.log("[ProfileScreen] avatar_url from users table:", data?.avatar_url);
      if (data?.avatar_url) {
        setAvatarUrl(data.avatar_url);
      }
    } catch { /* ignore */ }
  }, [user?.authUserId]);

  React.useEffect(() => {
    if (user?.avatar_url) {
      console.log("[ProfileScreen] avatar_url from user object:", user.avatar_url);
      setAvatarUrl(user.avatar_url);
    } else {
      fetchAvatar();
    }
  }, [user?.id, user?.avatar_url, fetchAvatar]);

  // Refetch profile data every time the screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      if (!user?.authUserId) {
        console.log("[ProfileScreen] skipping fetch — authUserId not ready");
        return;
      }
      fetchAvatar();
    }, [user?.authUserId, fetchAvatar]),
  );
  const avatarUri = avatarUrl || `https://api.dicebear.com/7.x/avataaars/png?seed=${encodeURIComponent(user?.name || "User")}`;

  const onLogout = () => {
    setShowSignOut(true);
  };

  return (
    <ProfileLayout navigation={navigation} title="Profile" fallback="Main" tabBarPadding>
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

      <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>GENERAL</Text>
      <View style={[styles.card, { backgroundColor: c.bgCard, borderColor: c.borderDefault }]}>
        <MenuItem icon={<CreditCard color={c.textPrimary} size={14} strokeWidth={2} />} title="Payment Methods" subtitle="Add your credit & debit cards" onPress={() => {}} c={c} />
        <MenuItem icon={<MapPin color={c.textPrimary} size={14} strokeWidth={2} />} title="Locations" subtitle="Add your home & work locations" onPress={() => {}} c={c} />
        <MenuItem icon={<Camera color={c.textPrimary} size={14} strokeWidth={2} />} title="Add Social Account" subtitle="Add Facebook, Instagram, Twitter etc" onPress={() => {}} c={c} />
        <MenuItem icon={<Gift color={c.textPrimary} size={14} strokeWidth={2} />} title="Refer to Friends" subtitle="Get $10 for referring friends" onPress={() => navigateToRootStack(navigation, "ReferFriends")} c={c} last />
      </View>

      <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>NOTIFICATIONS</Text>
      <View style={[styles.card, { backgroundColor: c.bgCard, borderColor: c.borderDefault }]}>
        <ToggleRow
          icon={<Bell color={c.textPrimary} size={14} strokeWidth={2} />}
          title="Push Notifications"
          subtitle="For daily update and others."
          value={pushNotifs}
          onChange={setPushNotifs}
          c={c}
        />
        <ToggleRow
          icon={<Megaphone color={c.textPrimary} size={14} strokeWidth={2} />}
          title="Promotional Notifications"
          subtitle="New Campaign & Offers"
          value={promoNotifs}
          onChange={setPromoNotifs}
          c={c}
          last
        />
      </View>

      <RoleToggleCard user={user} addRole={addRole} switchRole={switchRole} c={c} />

      <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>MORE</Text>
      <View style={[styles.card, { backgroundColor: c.bgCard, borderColor: c.borderDefault }]}>
        <MenuItem icon={<SunMoon color={c.textPrimary} size={14} strokeWidth={2} />} title="Appearance" subtitle={themeLabel} onPress={() => navigateToRootStack(navigation, "Appearance")} c={c} />
        <MenuItem icon={<Phone color={c.textPrimary} size={14} strokeWidth={2} />} title="Contact Us" subtitle="For more information" onPress={() => navigateToRootStack(navigation, "ContactUs")} c={c} />
        <Pressable style={styles.rowNoBorder} onPress={() => setShowSignOut(true)}>
      <LogOut color="#E05555" size={14} strokeWidth={2} />
      <View style={styles.menuText}>
        <Text style={[styles.menuTitle, { color: "#E05555" }]}>Logout</Text>
      </View>
        </Pressable>
      </View>
      <ConfirmModal
        visible={showSignOut}
        onClose={() => setShowSignOut(false)}
        onConfirm={async () => {
          setLoggingOut(true);
          try {
            await logout();
          } finally {
            setLoggingOut(false);
          }
        }}
        title="Sign out?"
        message="You will be signed out of your account."
        confirmLabel="Sign out"
        cancelLabel="Cancel"
        confirmDanger
      />
    </ProfileLayout>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", paddingVertical: 6 },
  avatar: { width: 80, height: 80, borderRadius: 40 },
  name: { fontSize: 26 / 1.54, fontWeight: "700", marginTop: 10 },
  email: { fontSize: 12, marginTop: 2 },
  editBtn: { borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 24, paddingVertical: 6, marginTop: 10 },
  editText: { fontSize: 13, fontWeight: "600" },
  sectionLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 1.2, marginTop: 20, marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: 14 },
  menuRow: { flexDirection: "row", alignItems: "center", padding: 16, borderBottomWidth: 1 },
  rowNoBorder: { flexDirection: "row", alignItems: "center", padding: 16 },
  rowIcon: { width: 22, fontSize: 14 },
  roleToggleContainer: { flexDirection: "row", borderRadius: 12, overflow: "hidden", margin: 4 },
  roleToggleSegment: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, paddingHorizontal: 8, gap: 8, borderRadius: 10, margin: 2 },
  roleToggleActive: { backgroundColor: "#1A1A1A" },
  roleToggleLabel: { fontSize: 14, fontWeight: "700" },
  menuText: { flex: 1 },
  menuTitle: { fontSize: 15, fontWeight: "600" },
  menuSubtitle: { fontSize: 12, marginTop: 2 },
  arrow: { fontSize: 19, marginLeft: 6 },
  roleToastContainer: { position: "absolute", bottom: 20, left: 16, right: 16, zIndex: 100, alignItems: "center" },
  roleToastInner: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 14, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 10 },
  roleToastText: { fontSize: 14, fontWeight: "700" },
});

function RoleToggleCard({ user, addRole, switchRole, c }: {
  user: ReturnType<typeof useAuth>["user"];
  addRole: ReturnType<typeof useAuth>["addRole"];
  switchRole: ReturnType<typeof useAuth>["switchRole"];
  c: ReturnType<typeof useAuthPalette>;
}) {
  const [switching, setSwitching] = useState<"explorer" | "organisor" | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const slideAnim = useRef(new Animated.Value(100)).current;
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeAnim = useRef(new Animated.Value(user?.activeRole === "organizer" ? 1 : 0)).current;

  const showToast = useCallback((msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMsg(msg); setToastVisible(true);
    slideAnim.setValue(100);
    Animated.timing(slideAnim, { toValue: 0, duration: 250, useNativeDriver: true }).start();
    toastTimeoutRef.current = setTimeout(() => {
      Animated.timing(slideAnim, { toValue: 100, duration: 200, useNativeDriver: true }).start(() => {
        setToastVisible(false); setToastMsg(null);
      });
    }, 1500);
  }, [slideAnim]);

  useEffect(() => { return () => { if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current); }; }, []);

  const onPressRole = async (role: "explorer" | "organisor") => {
    if (!user?.roles || switching) return;
    const roles = user.roles as string[];
    if (role === user.activeRole) return;
    setSwitching(role);
    try {
      if (roles.length > 1) { await switchRole(role); }
      else { const currentRole = roles[0]; if (currentRole !== role) { await addRole(role); } }
      const label = role === "organisor" ? "Organizer" : "Explorer";
      showToast(`Switched to ${label}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't switch roles, try again";
      showToast(msg);
    } finally { setSwitching(null); }
  };

  const isExplorerActive = user?.activeRole === "explorer";
  const isOrganizerActive = user?.activeRole === "organizer" || user?.activeRole === "organisor";
  const switchingToExplorer = switching === "explorer";
  const switchingToOrganizer = switching === "organisor";

  return (
    <>
      <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>ROLES</Text>
      <View style={[styles.card, { backgroundColor: c.bgCard, borderColor: c.borderDefault }]}>
        {user?.roles && (user.roles as string[]).length > 0 ? (
          <View style={styles.roleToggleContainer}>
            <Pressable style={[styles.roleToggleSegment, (isExplorerActive || switchingToExplorer) && styles.roleToggleActive]} onPress={() => void onPressRole("explorer")}>
              {switchingToExplorer ? <ActivityIndicator size="small" color={c.bgCard === "#000000" ? "#000" : "#fff"} /> : <Compass color={(isExplorerActive) ? (c.bgCard === "#000000" ? "#000" : "#fff") : c.textSecondary} size={16} strokeWidth={2} />}
              <Text style={[styles.roleToggleLabel, { color: (isExplorerActive || switchingToExplorer) ? (c.bgCard === "#000000" ? "#000" : "#fff") : c.textSecondary }]}>Explorer</Text>
            </Pressable>
            <Pressable style={[styles.roleToggleSegment, (isOrganizerActive || switchingToOrganizer) && styles.roleToggleActive]} onPress={() => void onPressRole("organisor")}>
              {switchingToOrganizer ? <ActivityIndicator size="small" color={c.bgCard === "#000000" ? "#000" : "#fff"} /> : <Briefcase color={(isOrganizerActive) ? (c.bgCard === "#000000" ? "#000" : "#fff") : c.textSecondary} size={16} strokeWidth={2} />}
              <Text style={[styles.roleToggleLabel, { color: (isOrganizerActive || switchingToOrganizer) ? (c.bgCard === "#000000" ? "#000" : "#fff") : c.textSecondary }]}>Organizer</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      {toastVisible && toastMsg && toastMsg.length > 0 ? (
        <Animated.View style={[styles.roleToastContainer, { transform: [{ translateY: slideAnim }] }]} pointerEvents="none">
          <View style={[styles.roleToastInner, { backgroundColor: c.accentOrange }]}>
            <CheckCircle2 color={c.bgCard} size={18} strokeWidth={2} />
            <Text style={[styles.roleToastText, { color: c.bgCard }]}>{toastMsg}</Text>
          </View>
        </Animated.View>
      ) : null}
    </>
  );
}

function MenuItem({ icon, title, subtitle, onPress, c, last }: {
  icon: React.ReactNode; title: string; subtitle: string; onPress: () => void;
  c: ReturnType<typeof useAuthPalette>; last?: boolean;
}) {
  return (
    <Pressable style={[styles.menuRow, { borderBottomColor: c.borderDefault, borderBottomWidth: last ? 0 : 1 }]} onPress={onPress}>
      <View style={styles.rowIcon}>{icon}</View>
      <View style={styles.menuText}>
        <Text style={[styles.menuTitle, { color: c.textPrimary }]}>{title}</Text>
        <Text style={[styles.menuSubtitle, { color: c.textSecondary }]}>{subtitle}</Text>
      </View>
      <Text style={[styles.arrow, { color: c.textSecondary }]}>›</Text>
    </Pressable>
  );
}

function ToggleRow({ icon, title, subtitle, value, onChange, c, last }: {
  icon: React.ReactNode; title: string; subtitle: string; value: boolean;
  onChange: (v: boolean) => void; c: ReturnType<typeof useAuthPalette>; last?: boolean;
}) {
  return (
    <View style={[styles.menuRow, { borderBottomColor: c.borderDefault, borderBottomWidth: last ? 0 : 1 }]}>
      <View style={styles.rowIcon}>{icon}</View>
      <View style={styles.menuText}>
        <Text style={[styles.menuTitle, { color: c.textPrimary }]}>{title}</Text>
        <Text style={[styles.menuSubtitle, { color: c.textSecondary }]}>{subtitle}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: "#555", true: "#1A1A1A" }} thumbColor="#FFFFFF" />
    </View>
  );
}