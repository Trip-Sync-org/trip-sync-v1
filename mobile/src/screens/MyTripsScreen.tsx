import React, { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Image, Pressable } from "react-native";
import { Calendar } from "lucide-react-native";
import { apiFetch } from "../api/client";
import { navigateToRootStack } from "../navigation/navigateRoot";
import { useAuth } from "../context/AuthContext";
import { useAuthPalette } from "../theme/authTheme";
import { ProfileLayout } from "../components/profile/ProfileLayout";
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
] as const;

export function MyTripsScreen({ navigation }: any) {
  const c = useAuthPalette();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]["id"]>("upcoming");
  const [bookings, setBookings] = useState<Trip[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);
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

  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

  const refresh = async () => {
    setRefreshing(true);
    await loadBookings();
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

  const renderContent = () => {
    if (activeTab === "upcoming") {
      if (bookingsLoading) {
        return <Text style={{ color: c.textSecondary, textAlign: "center", marginTop: 20 }}>Loading your booked trips…</Text>;
      }
      if (upcomingList.length === 0) {
        return (
          <Card style={{ padding: 20, alignItems: "center" }}>
            <Calendar color={c.textSecondary} size={32} strokeWidth={2} style={{ marginBottom: 8 }} />
            <Text style={{ color: c.textSecondary, marginBottom: 12 }}>No upcoming trips</Text>
            <PrimaryButton title="Explore Trips" onPress={() => navigateToRootStack(navigation, "Main")} />
          </Card>
        );
      }
      return upcomingList.map((trip) => (
        <Card key={trip.id} style={{ marginBottom: 14, overflow: "hidden" }}>
          <Image
            source={{ uri: `https://picsum.photos/seed/${trip.banner || trip.id}/400/240` }}
            style={{ width: "100%", height: 140, opacity: 0.85 }}
          />
          <View style={{ padding: 16 }}>
            <Badge variant="success">Upcoming</Badge>
            <Text style={{ color: c.textPrimary, fontWeight: "800", fontSize: 17, marginTop: 8 }}>{trip.name}</Text>
            <Text style={{ color: c.textSecondary, fontSize: 12, marginTop: 4 }}>
              {trip.date} · {trip.meetupPoint || "Meetup TBA"}
            </Text>
            <Text style={{ color: c.textSecondary, fontSize: 12, marginTop: 2 }}>
              {trip.joinedCount}/{trip.maxParticipants ?? "—"} joined
            </Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <Pressable
                style={{
                  backgroundColor: c.textPrimary,
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 999,
                }}
                onPress={() => navigateToRootStack(navigation, "LiveTrip", { id: trip.id })}
              >
                <Text style={{ color: c.bgCard, fontWeight: "800", fontSize: 13 }}>Go Live</Text>
              </Pressable>
              <Pressable
                style={{
                  borderWidth: 1,
                  borderColor: c.textSecondary,
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 999,
                }}
                onPress={() => navigateToRootStack(navigation, "TripDetail", { id: trip.id })}
              >
                <Text style={{ color: c.textPrimary, fontWeight: "700", fontSize: 13 }}>View Details</Text>
              </Pressable>
            </View>
          </View>
        </Card>
      ));
    }

    if (activeTab === "past") {
      if (bookingsLoading) {
        return <Text style={{ color: c.textSecondary, textAlign: "center", marginTop: 20 }}>Loading…</Text>;
      }
      if (pastList.length === 0) {
        return (
          <Card style={{ padding: 20, alignItems: "center" }}>
            <Text style={{ color: c.textSecondary }}>No past trips yet</Text>
          </Card>
        );
      }
      return pastList.map((trip) => (
        <Card key={trip.id} style={{ padding: 14, marginBottom: 12, flexDirection: "row", gap: 12 }}>
          <Image
            source={{ uri: `https://picsum.photos/seed/${trip.banner || trip.id}/200/200` }}
            style={{ width: 72, height: 72, borderRadius: 12 }}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.textPrimary, fontWeight: "800", fontSize: 17, marginTop: 8 }}>{trip.name}</Text>
            <Text style={{ color: c.textSecondary, fontSize: 12, marginTop: 4 }}>{trip.date}</Text>
            <Badge variant="default">Completed</Badge>
          </View>
          <OutlineButton title="Details" onPress={() => navigateToRootStack(navigation, "TripDetail", { id: trip.id })} />
        </Card>
      ));
    }

    return null;
  };

  return (
    <ProfileLayout navigation={navigation} title="My Trips" fallback="Main" tabBarPadding>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.textPrimary} />}
        contentContainerStyle={{ paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, flexDirection: "row", alignItems: "center", marginBottom: 16 }}
        >
          {TABS.map((t) => (
            <Pressable
              key={t.id}
              style={[
                {
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: c.textSecondary,
                },
                activeTab === t.id && { backgroundColor: c.textPrimary, borderColor: c.textPrimary },
              ]}
              onPress={() => setActiveTab(t.id)}
            >
              <Text
                style={[
                  { fontWeight: "700", fontSize: 13 },
                  { color: activeTab === t.id ? c.bgCard : c.textSecondary },
                ]}
              >
                {t.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {renderContent()}
      </ScrollView>
    </ProfileLayout>
  );
}