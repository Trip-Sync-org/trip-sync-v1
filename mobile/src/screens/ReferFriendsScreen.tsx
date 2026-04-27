import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { ProfileLayout } from "../components/profile/ProfileLayout";
import { useAuthPalette } from "../theme/authTheme";

type Props = NativeStackScreenProps<RootStackParamList, "ReferFriends">;

export function ReferFriendsScreen({ navigation }: Props) {
  const c = useAuthPalette();
  const isDark = c.bgPage === "#000000";
  return (
    <ProfileLayout navigation={navigation} title="Refer to Friends" fallback="Main">
      <View style={styles.center}>
        <View style={[styles.giftCircle, { backgroundColor: isDark ? "#1A2E29" : "#FFF0EC" }]}>
          <Text style={styles.giftEmoji}>🎁</Text>
        </View>
        <Text style={[styles.title, { color: c.textPrimary }]}>Refer to Friends</Text>
        <Text style={[styles.subtitle, { color: c.textSecondary }]}>
          Get $10 Coupon Code when someone sign up using your refer link
        </Text>
      </View>

      <View style={[styles.linkBox, { backgroundColor: isDark ? "#1C1C1C" : "#F0F7F5", borderColor: isDark ? "#2A2A2A" : "#D0EAE4" }]}>
        <Text style={{ color: "#4FA88A" }}>https://ui8.net/76738b</Text>
      </View>

      <View style={[styles.comingSoon, { borderColor: isDark ? "#333333" : "#CCCCCC" }]}>
        <Text style={{ color: isDark ? "#555555" : "#AAAAAA", fontSize: 15 }}>Coming Soon</Text>
      </View>

      <Pressable style={[styles.homeBtn, { borderColor: c.borderDefault }]} onPress={() => navigation.replace("Main")}>
        <Text style={{ color: c.textPrimary, fontWeight: "600" }}>Go to Homepage  ➜</Text>
      </Pressable>
    </ProfileLayout>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", marginTop: 8 },
  giftCircle: { width: 120, height: 120, borderRadius: 60, justifyContent: "center", alignItems: "center" },
  giftEmoji: { fontSize: 52 },
  title: { fontSize: 24 / 1.54, fontWeight: "700", marginTop: 12 },
  subtitle: { fontSize: 13, marginTop: 6, textAlign: "center", lineHeight: 18 },
  linkBox: { borderWidth: 1, borderRadius: 10, padding: 14, marginVertical: 16, alignItems: "center" },
  comingSoon: { borderWidth: 1.5, borderRadius: 12, padding: 14, alignItems: "center", opacity: 0.6, marginBottom: 12 },
  homeBtn: { borderWidth: 1.5, borderRadius: 12, padding: 14, alignItems: "center" },
});
