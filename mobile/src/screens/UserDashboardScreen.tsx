import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  Image,
  Pressable,
} from "react-native";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { apiFetch } from "../api/client";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { navigateToRootStack } from "../navigation/navigateRoot";
import { useAuth } from "../context/AuthContext";
import { colors, typography } from "../theme";
import { Card, Badge, PrimaryButton, OutlineButton } from "../components/ui";
import {
  normalizeTripFromApi,
  tripDateVsToday,
  isBookingCancelledOrCompleted,
  isPrivateTrip,
  type Trip,
} from "../lib/tripNormalize";

const TABS = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "explore", label: "Explore" },
  { id: "invites", label: "Invites" },
  { id: "rewards", label: "Rewards" },
  { id: "profile", label: "Profile" },
] as const;

export function UserDashboardScreen() {
  const { user, logout } = useAuth();
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const goStack = (route: keyof RootStackParamList, params?: RootStackParamList[keyof RootStackParamList]) => {
    navigateToRootStack(navigation, route as string, params as Record<string, unknown> | undefined);
  };
  const goExploreTab = () => navigation.navigate("ExploreTab" as never);

  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]["id"]>("upcoming");
  const [bookings, setBookings] = useState<Trip[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [exploreTrips, setExploreTrips] = useState<Trip[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadBookings = useCallback(async () => {
    if (!user) return;
    try {
      setBookingsLoading(true);
      const key =
        user.id && /^\d+$/.test(String(user.id).trim())
          ? String(user.id).trim()
          : user.email || user.id;
      const res = await apiFetch(`/api/users/${encodeURIComponent(key)}/bookings`);
      if (!res.ok) return;
      const rows = await res.json();
      setBookings((rows || []).map((r: Record<string, unknown>) => normalizeTripFromApi(r)));
    } catch {
      setBookings([]);
    } finally {
      setBookingsLoading(false);
    }
  }, [user]);

  const loadExplore = useCallback(async () => {
    try {
      const res = await apiFetch("/api/trips");
      if (!res.ok) return;
      const rows = await res.json();
      setExploreTrips((rows || []).map((r: Record<string, unknown>) => normalizeTripFromApi(r)));
    } catch {
      setExploreTrips([]);
    }
  }, []);

  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

  useEffect(() => {
    void loadExplore();
  }, [loadExplore]);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([loadBookings(), loadExplore()]);
    setRefreshing(false);
  };

  const upcomingList = bookings.filter(
    (t) =>
      !isBookingCancelledOrCompleted(t) &&
      tripDateVsToday(t.date) !== "past" &&
      !isPrivateTrip(t),
  );
  const pastList = bookings.filter(
    (t) => isBookingCancelledOrCompleted(t) || tripDateVsToday(t.date) === "past",
  );
  const invitesList = bookings.filter(
    (t) =>
      !isBookingCancelledOrCompleted(t) &&
      tripDateVsToday(t.date) !== "past" &&
      isPrivateTrip(t),
  );

  const xpPct = ((user?.xp || 0) % 1000) / 10;

  const renderContent = () => {
    if (activeTab === "upcoming") {
      return (
        <View style={styles.section}>
          {bookingsLoading ? (
            <Text style={styles.muted}>Loading your booked trips…</Text>
          ) : upcomingList.length === 0 ? (
            <Card style={{ padding: 32, alignItems: "center" }}>
              <Text style={{ fontSize: 40, marginBottom: 8 }}>📅</Text>
              <Text style={[styles.muted, { marginBottom: 16 }]}>No upcoming trips</Text>
              <PrimaryButton title="Explore Trips" onPress={goExploreTab} />
            </Card>
          ) : (
            upcomingList.map((trip) => (
              <Card key={trip.id} style={{ marginBottom: 14, overflow: "hidden" }}>
                <Image
                  source={{ uri: `https://picsum.photos/seed/${trip.banner || trip.id}/400/240` }}
                  style={{ width: "100%", height: 140, opacity: 0.85 }}
                />
                <View style={{ padding: 16 }}>
                  <Badge variant="success">Upcoming</Badge>
                  <Text style={styles.cardTitle}>{trip.name}</Text>
                  <Text style={styles.mutedSmall}>
                    {trip.date} · {trip.meetupPoint || "Meetup TBA"}
                  </Text>
                  <Text style={styles.mutedSmall}>
                    {trip.joinedCount}/{trip.maxParticipants ?? "—"} joined
                  </Text>
                  <View style={styles.rowBtns}>
                    <Pressable style={styles.btnPrimarySm} onPress={() => goStack("LiveTrip", { id: trip.id })}>
                      <Text style={styles.btnPrimarySmText}>Go Live</Text>
                    </Pressable>
                    <Pressable style={styles.btnOutlineSm} onPress={() => goStack("TripDetail", { id: trip.id })}>
                      <Text style={styles.btnOutlineSmText}>View Details</Text>
                    </Pressable>
                  </View>
                </View>
              </Card>
            ))
          )}
        </View>
      );
    }
    if (activeTab === "past") {
      return (
        <View style={styles.section}>
          {bookingsLoading ? (
            <Text style={styles.muted}>Loading…</Text>
          ) : pastList.length === 0 ? (
            <Card style={{ padding: 32, alignItems: "center" }}>
              <Text style={styles.muted}>No past trips yet</Text>
            </Card>
          ) : (
            pastList.map((trip) => (
              <Card key={trip.id} style={{ padding: 14, marginBottom: 12, flexDirection: "row", gap: 12 }}>
                <Image
                  source={{ uri: `https://picsum.photos/seed/${trip.banner || trip.id}/200/200` }}
                  style={{ width: 72, height: 72, borderRadius: 12 }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{trip.name}</Text>
                  <Text style={styles.mutedSmall}>{trip.date}</Text>
                  <Badge variant="default">Completed</Badge>
                </View>
                <OutlineButton title="Details" onPress={() => goStack("TripDetail", { id: trip.id })} />
              </Card>
            ))
          )}
        </View>
      );
    }
    if (activeTab === "explore") {
      return (
        <View style={styles.section}>
          <Text style={styles.mutedSmall}>Suggested for you</Text>
          {exploreTrips.slice(0, 6).map((trip) => (
            <Card key={trip.id} style={{ marginBottom: 12, overflow: "hidden" }}>
              <Pressable onPress={() => goStack("TripDetail", { id: trip.id })}>
                <Image
                  source={{ uri: `https://picsum.photos/seed/${trip.banner || trip.id}/400/200` }}
                  style={{ width: "100%", height: 120 }}
                />
                <View style={{ padding: 12 }}>
                  <Text style={styles.cardTitle}>{trip.name}</Text>
                  <Text style={styles.mutedSmall}>{trip.theme} · {trip.date}</Text>
                </View>
              </Pressable>
            </Card>
          ))}
          <OutlineButton title="Open Explore tab" onPress={goExploreTab} />
        </View>
      );
    }
    if (activeTab === "invites") {
      return (
        <View style={styles.section}>
          {invitesList.length === 0 ? (
            <Card style={{ padding: 32, alignItems: "center" }}>
              <Text style={styles.muted}>No private invites yet</Text>
            </Card>
          ) : (
            invitesList.map((trip) => (
              <Card key={trip.id} style={{ padding: 14, marginBottom: 12 }}>
                <Badge variant="warning">Private</Badge>
                <Text style={styles.cardTitle}>{trip.name}</Text>
                <View style={styles.rowBtns}>
                  <PrimaryButton title="View trip" onPress={() => goStack("TripDetail", { id: trip.id })} />
                  <OutlineButton title="Go Live" onPress={() => goStack("LiveTrip", { id: trip.id })} />
                </View>
              </Card>
            ))
          )}
        </View>
      );
    }
    if (activeTab === "rewards") {
      return (
        <View style={styles.section}>
          <Card style={{ padding: 20 }}>
            <Text style={styles.cardTitle}>Level {user?.level ?? 1}</Text>
            <Text style={styles.mutedSmall}>Explorer</Text>
            <Text style={styles.mutedSmall}>
              {user?.xp ?? 0} XP → next level
            </Text>
            <View style={styles.xpBar}>
              <View style={[styles.xpFill, { width: `${xpPct}%` }]} />
            </View>
          </Card>
          <Card style={{ padding: 20, marginTop: 12 }}>
            <Text style={styles.cardTitle}>Rewards Wallet</Text>
            <Text style={{ fontSize: 28, fontWeight: "800", color: colors.text }}>₹420</Text>
            <Text style={styles.mutedSmall}>Available cashback (demo)</Text>
          </Card>
        </View>
      );
    }
    if (activeTab === "profile") {
      return (
        <View style={styles.section}>
          <Card style={{ padding: 20 }}>
            <View style={{ flexDirection: "row", gap: 14 }}>
              <Image
                source={{
                  uri: `https://api.dicebear.com/7.x/avataaars/png?seed=${encodeURIComponent(user?.name || "u")}`,
                }}
                style={{ width: 72, height: 72, borderRadius: 16 }}
              />
              <View>
                <Text style={styles.cardTitle}>{user?.name}</Text>
                <Text style={styles.mutedSmall}>{user?.email}</Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <Badge variant="success">Level {user?.level ?? 1}</Badge>
                  <Badge variant="default">{user?.xp ?? 0} XP</Badge>
                </View>
              </View>
            </View>
          </Card>
          <Pressable style={styles.signOut} onPress={() => void logout()}>
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </View>
      );
    }
    return null;
  };

  return (
    <ScrollView
      style={styles.root}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#fff" />}
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <Text style={styles.welcome}>Welcome back,</Text>
        <Text style={styles.heroName}>{user?.name} 👋</Text>
        <View style={styles.quickStats}>
          {[
            { l: "Trips", v: "—" },
            { l: "XP", v: String(user?.xp ?? 0) },
            { l: "Wallet", v: "₹420" },
            { l: "Invites", v: String(invitesList.length) },
          ].map((s) => (
            <Card key={s.l} style={{ padding: 12, width: "47%" }}>
              <Text style={styles.statVal}>{s.v}</Text>
              <Text style={typography.label}>{s.l}</Text>
            </Card>
          ))}
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabStrip}
      >
        {TABS.map((t) => (
          <Pressable
            key={t.id}
            style={[styles.tabChip, activeTab === t.id && styles.tabChipOn]}
            onPress={() => setActiveTab(t.id)}
          >
            <Text style={[styles.tabChipText, activeTab === t.id && styles.tabChipTextOn]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={{ paddingHorizontal: 16 }}>{renderContent()}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  welcome: { color: colors.muted, fontSize: 14 },
  heroName: { ...typography.hero, color: colors.text, marginBottom: 16 },
  quickStats: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "space-between", marginBottom: 8 },
  statVal: { fontSize: 20, fontWeight: "800", color: colors.text },
  tabStrip: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  tabChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
  },
  tabChipOn: { backgroundColor: colors.text, borderColor: colors.text },
  tabChipText: { color: colors.muted, fontWeight: "700", fontSize: 13 },
  tabChipTextOn: { color: colors.bg },
  section: { paddingTop: 8 },
  cardTitle: { color: colors.text, fontWeight: "800", fontSize: 17, marginTop: 8 },
  muted: { color: colors.muted },
  mutedSmall: { color: colors.muted, fontSize: 12, marginTop: 4 },
  rowBtns: { flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" },
  btnPrimarySm: {
    backgroundColor: colors.text,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  btnPrimarySmText: { color: colors.bg, fontWeight: "800", fontSize: 13 },
  btnOutlineSm: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  btnOutlineSmText: { color: colors.text, fontWeight: "700", fontSize: 13 },
  xpBar: {
    height: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 4,
    marginTop: 12,
    overflow: "hidden",
  },
  xpFill: { height: "100%", backgroundColor: "#fbbf24" },
  signOut: {
    marginTop: 20,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.35)",
    alignItems: "center",
  },
  signOutText: { color: colors.danger, fontWeight: "800" },
});
