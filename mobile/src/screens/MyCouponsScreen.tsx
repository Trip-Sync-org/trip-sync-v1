import React, { useState, useCallback } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View, Pressable } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { apiFetch } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useAuthPalette } from "../theme/authTheme";
import { ProfileLayout } from "../components/profile/ProfileLayout";
import { Card, Badge } from "../components/ui";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";

type AssignedCoupon = {
  assignment_id: number;
  coupon_id: number;
  code: string;
  discount_pct: number;
  expiry_date: string | null;
  active: boolean;
  redeemed: boolean;
  expired: boolean;
  trip_id: number | null;
  trip_name: string | null;
  trip_date: string | null;
  trip_banner_url: string | null;
  created_at: string;
};

type BookingWithCoupon = {
  id: number;
  trip_id: number;
  coupon_id: number | null;
  status: string;
  created_at: string;
  trip_name?: string;
  organizer_coupons?: {
    id: number;
    code: string;
    discount_percent: number;
  } | null;
};

type MergedCoupon = {
  id: string;
  code: string;
  discount_pct: number;
  trip_id: number | null;
  trip_name: string | null;
  expiry_date: string | null;
  status: "Available" | "Used" | "Expired";
  source: "assigned" | "booking";
};

export function MyCouponsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const c = useAuthPalette();
  const { user } = useAuth();
  const [mergedCoupons, setMergedCoupons] = useState<MergedCoupon[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCoupons = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const numericId = Number(user.id);
      if (!Number.isFinite(numericId)) return;

      // Fetch both in parallel
      const [assignedRes, bookingsRes] = await Promise.all([
        apiFetch(`/api/users/${numericId}/assigned-coupons`),
        apiFetch(`/api/users/${numericId}/bookings`),
      ]);

      const assignedCoupons: AssignedCoupon[] = assignedRes.ok ? await assignedRes.json() : [];
      const bookings: BookingWithCoupon[] = bookingsRes.ok ? await bookingsRes.json() : [];

      const mergedMap = new Map<string, MergedCoupon>();

      // Process assigned coupons
      for (const ac of assignedCoupons) {
        const now = new Date();
        let status: "Available" | "Used" | "Expired" = "Available";
        if (ac.expired) status = "Expired";
        if (ac.redeemed) status = "Used";

        mergedMap.set(`assigned-${ac.assignment_id}`, {
          id: `assigned-${ac.assignment_id}`,
          code: ac.code,
          discount_pct: ac.discount_pct,
          trip_id: ac.trip_id,
          trip_name: ac.trip_name,
          expiry_date: ac.expiry_date,
          status,
          source: "assigned",
        });
      }

      // Process booking coupons (deduplicate by coupon_id)
      for (const b of bookings) {
        if (!b.coupon_id) continue;
        const coupon = b.organizer_coupons;
        const key = `booking-${b.id}`;
        if (!mergedMap.has(key)) {
          mergedMap.set(key, {
            id: key,
            code: coupon?.code ?? "N/A",
            discount_pct: coupon?.discount_percent ?? 0,
            trip_id: b.trip_id,
            trip_name: b.trip_name ?? null,
            expiry_date: null,
            status: "Used",
            source: "booking",
          });
        }
      }

      setMergedCoupons(Array.from(mergedMap.values()));
    } catch (e) {
      console.error("[MyCouponsScreen] fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      void fetchCoupons();
    }, [fetchCoupons]),
  );

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr + "T00:00:00");
      return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    } catch {
      return dateStr;
    }
  };

  const statusColors: Record<string, { bg: string; text: string; label: string }> = {
    Available: { bg: "rgba(34,197,94,0.15)", text: "#22c55e", label: "Available" },
    Used: { bg: "rgba(234,179,8,0.15)", text: "#eab308", label: "Used" },
    Expired: { bg: "rgba(239,68,68,0.15)", text: "#ef4444", label: "Expired" },
  };

  return (
    <ProfileLayout navigation={navigation} title="My Coupons" fallback="Main" tabBarPadding>
      {loading ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" color={c.textPrimary} />
        </View>
      ) : mergedCoupons.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ color: c.textSecondary }}>No coupons found</Text>
        </View>
      ) : (
        <FlatList
          data={mergedCoupons}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const sc = statusColors[item.status] ?? statusColors.Available;
            return (
              <Card style={{ padding: 16, marginBottom: 12 }}>
                <View style={styles.couponHeader}>
                  <Text style={[styles.couponCode, { color: c.textPrimary }]}>
                    {item.code}
                  </Text>
                  <Badge variant={item.status === "Available" ? "success" : item.status === "Used" ? "warning" : "default"}>
                    {item.discount_pct}% OFF
                  </Badge>
                </View>
                {item.trip_name ? (
                  <Text style={{ fontSize: 13, color: c.textSecondary, marginTop: 4 }}>
                    Trip: {item.trip_name}
                  </Text>
                ) : null}
                {item.expiry_date ? (
                  <Text style={{ fontSize: 12, color: c.textSecondary, marginTop: 2 }}>
                    Expires: {formatDate(item.expiry_date)}
                  </Text>
                ) : null}
                <View style={styles.actionsRow}>
                  <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                    <Text style={[styles.statusText, { color: sc.text }]}>{sc.label}</Text>
                  </View>
                  {item.status === "Available" && item.trip_id ? (
                    <Pressable
                      onPress={() =>
                        navigation.navigate("TripDetail", {
                          id: String(item.trip_id),
                          prefillCoupon: item.code,
                        })
                      }
                      style={styles.applyBtn}
                    >
                      <Text style={styles.applyBtnText}>Apply on Trip →</Text>
                    </Pressable>
                  ) : null}
                </View>
              </Card>
            );
          }}
        />
      )}
    </ProfileLayout>
  );
}

const styles = StyleSheet.create({
  couponHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  couponCode: { fontSize: 17, fontWeight: "800", letterSpacing: 1 },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  statusBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: { fontSize: 11, fontWeight: "700" },
  applyBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#000",
  },
  applyBtnText: { color: "#fff", fontWeight: "700", fontSize: 12 },
});