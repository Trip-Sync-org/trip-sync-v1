import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  Image,
  Pressable,
} from "react-native";
import { Calendar } from "lucide-react-native";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { apiFetch } from "../api/client";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { navigateToRootStack } from "../navigation/navigateRoot";
import { useAuth } from "../context/AuthContext";
import { typography, useThemeColors } from "../theme";
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
] as const;

export function UserDashboardScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const c = useThemeColors();
  const goStack = (route: keyof RootStackParamList, params?: RootStackParamList[keyof RootStackParamList]) => {
    navigateToRootStack(navigation, route as string, params as Record<string, unknown> | undefined);
  };
  const goExploreTab = () => navigation.navigate("ExploreTab" as never);

  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]["id"]>("upcoming");
  const [bookings, setBookings] = useState<Trip[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [exploreTrips, setExploreTrips] = useState<Trip[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [couponCount, setCouponCount] = useState(0);

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

  useEffect(() => {
    if (!user) return;
    const key = user.id && /^\d+$/.test(String(user.id).trim()) ? String(user.id).trim() : user.email || user.id;
    apiFetch(`/api/organizers/${encodeURIComponent(key)}/coupons`)
      .then(res => res.ok ? res.json() : [])
      .then((data: unknown[]) => setCouponCount(Array.isArray(data) ? data.length : 0))
      .catch(() => setCouponCount(0));
  }, [user]);

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

  const s = useMemo(() => makeStyles(c), [c]);

  const renderContent = () => {
    if (activeTab === "upcoming") {
      return (
        <View style={s.section}>
          {bookingsLoading ? (
            <Text style={s.muted}>Loading your booked trips…</Text>
          ) : upcomingList.length === 0 ? (
            <Card style={{ padding: 20, alignItems: "center" }}>
              <Calendar color={c.muted} size={32} strokeWidth={2} style={{ marginBottom: 8 }} />
              <Text style={[s.muted, { marginBottom: 12 }]}>No upcoming trips</Text>
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
                  <Text style={s.cardTitle}>{trip.name}</Text>
                  <Text style={s.mutedSmall}>
                    {trip.date} · {trip.meetupPoint || "Meetup TBA"}
                  </Text>
                  <Text style={s.mutedSmall}>
                    {trip.joinedCount}/{trip.maxParticipants ?? "—"} joined
                  </Text>
                  <View style={s.rowBtns}>
                    <Pressable style={s.btnPrimarySm} onPress={() => goStack("LiveTrip", { id: trip.id })}>
                      <Text style={s.btnPrimarySmText}>Go Live</Text>
                    </Pressable>
                    <Pressable style={s.btnOutlineSm} onPress={() => goStack("TripDetail", { id: trip.id })}>
                      <Text style={s.btnOutlineSmText}>View Details</Text>
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
        <View style={s.section}>
          {bookingsLoading ? (
            <Text style={s.muted}>Loading…</Text>
          ) : pastList.length === 0 ? (
            <Card style={{ padding: 20, alignItems: "center" }}>
              <Text style={s.muted}>No past trips yet</Text>
            </Card>
          ) : (
            pastList.map((trip) => (
              <Card key={trip.id} style={{ padding: 14, marginBottom: 12, flexDirection: "row", gap: 12 }}>
                <Image
                  source={{ uri: `https://picsum.photos/seed/${trip.banner || trip.id}/200/200` }}
                  style={{ width: 72, height: 72, borderRadius: 12 }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle}>{trip.name}</Text>
                  <Text style={s.mutedSmall}>{trip.date}</Text>
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
        <View style={s.section}>
          <Text style={s.mutedSmall}>Suggested for you</Text>
          {exploreTrips.slice(0, 6).map((trip) => (
            <Card key={trip.id} style={{ marginBottom: 12, overflow: "hidden" }}>
              <Pressable onPress={() => goStack("TripDetail", { id: trip.id })}>
                <Image
                  source={{ uri: `https://picsum.photos/seed/${trip.banner || trip.id}/400/200` }}
                  style={{ width: "100%", height: 120 }}
                />
                <View style={{ padding: 12 }}>
                  <Text style={s.cardTitle}>{trip.name}</Text>
                  <Text style={s.mutedSmall}>{trip.theme} · {trip.date}</Text>
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
        <View style={s.section}>
          {invitesList.length === 0 ? (
            <Card style={{ padding: 20, alignItems: "center" }}>
              <Text style={s.muted}>No private invites yet</Text>
            </Card>
          ) : (
            invitesList.map((trip) => (
              <Card key={trip.id} style={{ padding: 14, marginBottom: 12 }}>
                <Badge variant="warning">Private</Badge>
                <Text style={s.cardTitle}>{trip.name}</Text>
                <View style={s.rowBtns}>
                  <PrimaryButton title="View trip" onPress={() => goStack("TripDetail", { id: trip.id })} />
                  <OutlineButton title="Go Live" onPress={() => goStack("LiveTrip", { id: trip.id })} />
                </View>
              </Card>
            ))
          )}
        </View>
      );
    }
    return null;
  };

  return (
    <ScrollView
      style={s.root}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.text} />}
      contentContainerStyle={{ paddingBottom: 100 }}
    >
      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <Text style={s.welcome}>Welcome back,</Text>
        <Text style={s.heroName}>{user?.name} 👋</Text>
        <View style={s.quickStats}>
          {[
            { l: "Trips", v: "—" },
            { l: "XP", v: String(user?.xp ?? 0) },
            { l: "Coupons", v: String(couponCount) },
            { l: "Invites", v: String(invitesList.length) },
          ].map((stat) => (
            <Card key={stat.l} style={{ padding: 12, width: "47%" }}>
              <Text style={s.statVal}>{stat.v}</Text>
              <Text style={s.statLabel}>{stat.l}</Text>
            </Card>
          ))}
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.tabStrip}
      >
        {TABS.map((t) => (
          <Pressable
            key={t.id}
            style={[s.tabChip, activeTab === t.id && s.tabChipOn]}
            onPress={() => setActiveTab(t.id)}
          >
            <Text style={[s.tabChipText, activeTab === t.id && s.tabChipTextOn]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={{ paddingHorizontal: 16 }}>{renderContent()}</View>
    </ScrollView>
  );
}

const makeStyles = (c: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    welcome: { color: c.muted, fontSize: 14 },
    heroName: { ...typography.hero, color: c.text, marginBottom: 16 },
    quickStats: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "space-between", marginBottom: 16 },
    statVal: { fontSize: 20, fontWeight: "800", color: c.text },
    statLabel: { ...typography.label, color: c.muted },
    tabStrip: { paddingHorizontal: 16, gap: 8, flexDirection: "row", alignItems: "center", marginTop: -4, paddingTop: 4 },
    tabChip: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    tabChipOn: { backgroundColor: c.text, borderColor: c.text },
    tabChipText: { color: c.muted, fontWeight: "700", fontSize: 13 },
    tabChipTextOn: { color: c.bg },
    section: { paddingTop: 16 },
    cardTitle: { color: c.text, fontWeight: "800", fontSize: 17, marginTop: 8 },
    muted: { color: c.muted },
    mutedSmall: { color: c.muted, fontSize: 12, marginTop: 4 },
    rowBtns: { flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" },
    btnPrimarySm: {
      backgroundColor: c.text,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 999,
    },
    btnPrimarySmText: { color: c.bg, fontWeight: "800", fontSize: 13 },
    btnOutlineSm: {
      borderWidth: 1,
      borderColor: c.border,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 999,
    },
    btnOutlineSmText: { color: c.text, fontWeight: "700", fontSize: 13 },
  });