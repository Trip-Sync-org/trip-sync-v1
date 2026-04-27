import React from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { ProfileLayout } from "../components/profile/ProfileLayout";
import { useAuthPalette } from "../theme/authTheme";
import { navigateToRootStack } from "../navigation/navigateRoot";

type Props = NativeStackScreenProps<RootStackParamList, "ContactUs">;

export function ContactUsScreen({ navigation }: Props) {
  const c = useAuthPalette();
  const options = [
    {
      icon: "💬",
      iconBg: "#E8F5F1",
      iconColor: "#4FA88A",
      title: "Support Chat",
      subtitle: "24x7 Online Support",
      onPress: () => navigateToRootStack(navigation, "SupportChat"),
    },
    {
      icon: "📞",
      iconBg: "#FFF0EC",
      iconColor: "#4FA88A",
      title: "Call Center",
      subtitle: "24x7 Customer Service",
      onPress: () => void Linking.openURL("tel:+1800000000"),
    },
    {
      icon: "✉️",
      iconBg: "#F0ECFF",
      iconColor: "#7C4DFF",
      title: "Email",
      subtitle: "admin@shifty.com",
      onPress: () => void Linking.openURL("mailto:admin@shifty.com"),
    },
    {
      icon: "❓",
      iconBg: "#FFFBEC",
      iconColor: "#FFC107",
      title: "FAQ",
      subtitle: "+50 Answers",
      onPress: () => navigateToRootStack(navigation, "FAQ"),
    },
  ];

  return (
    <ProfileLayout navigation={navigation} title="Contact Us" fallback="Main">
      <Text style={[styles.heading, { color: c.textPrimary }]}>Contact Us</Text>
      <Text style={[styles.subtitle, { color: c.textSecondary }]}>
        Please choose what types of support do you need and let us know.
      </Text>

      <View style={styles.grid}>
        {options.map((opt) => (
          <Pressable key={opt.title} onPress={opt.onPress} style={[styles.card, { backgroundColor: c.bgCard, borderColor: c.borderDefault }]}>
            <View style={[styles.iconCircle, { backgroundColor: opt.iconBg }]}>
              <Text style={{ color: opt.iconColor }}>{opt.icon}</Text>
            </View>
            <Text style={[styles.title, { color: c.textPrimary }]}>{opt.title}</Text>
            <Text style={[styles.sub, { color: c.textSecondary }]}>{opt.subtitle}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        style={[styles.homeBtn, { borderColor: c.borderDefault }]}
        onPress={() => navigation.replace("Main")}
      >
        <Text style={{ color: c.textPrimary, fontWeight: "600" }}>Go to Homepage  ➜</Text>
      </Pressable>
    </ProfileLayout>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 26 / 1.54, fontWeight: "700", marginTop: 6 },
  subtitle: { fontSize: 14, marginTop: 8, lineHeight: 20, marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -6 },
  card: {
    width: "47%",
    margin: 6,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    alignItems: "center",
  },
  iconCircle: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  title: { fontSize: 14, fontWeight: "600" },
  sub: { fontSize: 11, textAlign: "center", marginTop: 4 },
  homeBtn: { marginTop: 24, borderWidth: 1.5, borderRadius: 12, padding: 14, alignItems: "center" },
});
