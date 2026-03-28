import React from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { colors, typography } from "../theme";
import { Card } from "../components/ui";

type Props = NativeStackScreenProps<RootStackParamList, "Landing">;

const FEATURES = [
  {
    emoji: "⚡",
    title: "Real-time Sync",
    desc: "Live GPS tracking and member sync for a safer, more connected journey.",
  },
  {
    emoji: "🏆",
    title: "Earn Rewards",
    desc: "Collect digital stamps, level up your profile, and earn exclusive travel perks.",
  },
  {
    emoji: "🛡",
    title: "Verified Hosts",
    desc: "Every organizer is vetted to ensure premium quality and safety.",
  },
];

export function LandingScreen({ navigation }: Props) {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>✦ New: Gamified Group Expeditions</Text>
      </View>
      <Text style={styles.hero}>Explore the World,</Text>
      <Text style={styles.heroAccent}>Gamified.</Text>
      <Text style={styles.sub}>
        The premium platform for curated travel experiences. Join public expeditions or create your own
        private journey with real-time tracking and rewards.
      </Text>
      <View style={styles.actions}>
        <Pressable style={styles.primary} onPress={() => navigation.navigate("Login")}>
          <Text style={styles.primaryText}>Sign in</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={() => navigation.navigate("Signup")}>
          <Text style={styles.secondaryText}>Create account</Text>
        </Pressable>
      </View>
      <Text style={[typography.label, { marginTop: 28, marginBottom: 12 }]}>Why NOMAD</Text>
      {FEATURES.map((c) => (
        <Card key={c.title} style={{ padding: 18, marginBottom: 12 }}>
          <Text style={styles.featureEmoji}>{c.emoji}</Text>
          <Text style={styles.featureTitle}>{c.title}</Text>
          <Text style={styles.featureDesc}>{c.desc}</Text>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 24, paddingBottom: 48 },
  badge: {
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 20,
  },
  badgeText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  hero: {
    ...typography.hero,
    fontSize: 36,
    textAlign: "center",
    color: colors.text,
  },
  heroAccent: {
    ...typography.hero,
    fontSize: 36,
    textAlign: "center",
    color: colors.muted,
    fontStyle: "italic",
    marginBottom: 16,
  },
  sub: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
    marginBottom: 28,
  },
  actions: { gap: 12 },
  primary: {
    backgroundColor: colors.text,
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: "center",
  },
  primaryText: { color: colors.bg, fontWeight: "800", fontSize: 16 },
  secondary: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: "center",
  },
  secondaryText: { color: colors.text, fontWeight: "700", fontSize: 16 },
  featureEmoji: { fontSize: 28, marginBottom: 8 },
  featureTitle: { color: colors.text, fontWeight: "800", fontSize: 18, marginBottom: 6 },
  featureDesc: { color: colors.muted, fontSize: 14, lineHeight: 20 },
});
