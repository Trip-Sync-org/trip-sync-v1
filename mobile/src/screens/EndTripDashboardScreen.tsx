import React from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { apiFetch, readApiErrorMessage } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useAppTheme } from "../context/ThemeContext";

type Props = NativeStackScreenProps<RootStackParamList, "EndTripDashboard">;

function formatDur(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function EndTripDashboardScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { colors, mode } = useAppTheme();
  const {
    tripId,
    tripName = "Trip",
    distanceKm = 0,
    durationSec = 0,
    riders = 1,
  } = route.params;

  const [rating, setRating] = React.useState(0);
  const [review, setReview] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const submitReview = async () => {
    if (!rating || !review.trim()) {
      Alert.alert("Review", "Pick a star rating and write a short review.");
      return;
    }
    if (!user?.id) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/trips/${tripId}/reviews`, {
        method: "POST",
        body: JSON.stringify({
          user_id: Number(user.id),
          rating,
          text: review.trim(),
        }),
      });
      if (!res.ok) {
        Alert.alert("Review", await readApiErrorMessage(res));
        return;
      }
      setSubmitted(true);
    } finally {
      setBusy(false);
    }
  };

  const isDark = mode === "dark";

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, paddingHorizontal: 16 }}
    >
      <View style={[styles.badge, { borderColor: colors.border }]}>
        <View style={styles.dot} />
        <Text style={[styles.badgeText, { color: colors.muted }]}>
          Trip completed · {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
        </Text>
      </View>
      <Text style={[styles.title, { color: colors.text }]}>{tripName}</Text>
      <Text style={[styles.sub, { color: colors.muted }]}>
        Thanks for riding with Trip-Sync! Here is your recap.
      </Text>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.row}>
          <Ionicons name="trophy" size={28} color="#fbbf24" />
          <View style={{ marginLeft: 12 }}>
            <Text style={[styles.xpBig, { color: "#fbbf24" }]}>+0 XP</Text>
            <Text style={[styles.caption, { color: colors.muted }]}>XP earned this trip</Text>
          </View>
        </View>
      </View>

      <View style={styles.grid}>
        {[
          { icon: "location" as const, label: "Distance", value: `${distanceKm.toFixed(1)} km`, color: "#f87171" },
          { icon: "time-outline" as const, label: "Duration", value: formatDur(durationSec), color: colors.text },
          { icon: "flag-outline" as const, label: "Checkpoints", value: "—", color: colors.text },
          { icon: "speedometer-outline" as const, label: "Avg speed", value: "—", color: "#fbbf24" },
          { icon: "leaf-outline" as const, label: "Carbon saved", value: "—", color: "#34d399" },
          { icon: "people-outline" as const, label: "Riders", value: String(riders), color: "#60a5fa" },
        ].map((cell) => (
          <View
            key={cell.label}
            style={[styles.cell, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Ionicons name={cell.icon} size={22} color={cell.color} style={{ marginBottom: 6 }} />
            <Text style={[styles.cellVal, { color: colors.text }]}>{cell.value}</Text>
            <Text style={[styles.cellLbl, { color: colors.muted }]}>{cell.label}</Text>
          </View>
        ))}
      </View>

      {!submitted ? (
        <View style={[styles.reviewCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>RATE THIS TRIP</Text>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((s) => (
              <Pressable key={s} onPress={() => setRating(s)} style={styles.starBtn}>
                <Text style={{ fontSize: 28 }}>{s <= rating ? "⭐" : "☆"}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
                color: colors.text,
                borderColor: colors.border,
              },
            ]}
            placeholder="Share your experience — what made this trip special?"
            placeholderTextColor={colors.muted}
            value={review}
            onChangeText={setReview}
            multiline
          />
          <Pressable
            style={[styles.primaryBtn, { backgroundColor: isDark ? "#fff" : "#111" }]}
            onPress={() => void submitReview()}
            disabled={busy}
          >
            <Ionicons name="send" size={16} color={isDark ? "#000" : "#fff"} />
            <Text style={[styles.primaryBtnText, { color: isDark ? "#000" : "#fff" }]}>Submit review</Text>
          </Pressable>
        </View>
      ) : (
        <View style={[styles.doneBox, { borderColor: "rgba(52,211,153,0.35)" }]}>
          <Ionicons name="checkmark-circle" size={28} color="#34d399" />
          <Text style={{ color: "#34d399", fontWeight: "700", marginTop: 8 }}>Review submitted</Text>
        </View>
      )}

      <Pressable style={[styles.navBtn, { borderColor: colors.border }]} onPress={() => navigation.navigate("Main")}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>
          {user?.role === "organizer" ? "Organizer dashboard" : "Go to dashboard"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 12,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#34d399" },
  badgeText: { fontSize: 11, fontWeight: "600" },
  title: { fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  sub: { fontSize: 14, marginTop: 6, marginBottom: 20 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  row: { flexDirection: "row", alignItems: "center" },
  xpBig: { fontSize: 24, fontWeight: "800" },
  caption: { fontSize: 11, marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 },
  cell: {
    width: "31%",
    minWidth: 100,
    flexGrow: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    alignItems: "center",
  },
  cellVal: { fontSize: 15, fontWeight: "800" },
  cellLbl: { fontSize: 10, marginTop: 4, textAlign: "center" },
  reviewCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2,
    marginBottom: 12,
  },
  stars: { flexDirection: "row", gap: 6, marginBottom: 12 },
  starBtn: { padding: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    minHeight: 100,
    textAlignVertical: "top",
    marginBottom: 12,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  primaryBtnText: { fontWeight: "800", fontSize: 15 },
  doneBox: {
    alignItems: "center",
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
    backgroundColor: "rgba(52,211,153,0.08)",
  },
  navBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
  },
});
