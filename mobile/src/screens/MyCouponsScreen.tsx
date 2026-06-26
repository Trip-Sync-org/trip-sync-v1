import React, { useState, useCallback } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { useAuthPalette } from "../theme/authTheme";
import { ProfileLayout } from "../components/profile/ProfileLayout";
import { Card, Badge } from "../components/ui";

type BookingWithCoupon = {
  id: number;
  trip_id: number;
  coupon_id: number | null;
  status: string;
  created_at: string;
  organizer_coupons: {
    id: number;
    code: string;
    discount_percent: number;
    description?: string;
  } | null;
};

export function MyCouponsScreen({ navigation }: any) {
  const c = useAuthPalette();
  const { user } = useAuth();
  const [coupons, setCoupons] = useState<BookingWithCoupon[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCoupons = useCallback(async () => {
    if (!user?.id || !supabase) return;
    setLoading(true);
    const numericId = Number(user.id);
    if (!Number.isFinite(numericId)) return;
    try {
      const { data, error } = await supabase
        .from("bookings")
        .select("*, organizer_coupons (*)")
        .eq("user_id", numericId)
        .not("coupon_id", "is", null);

      if (error) {
        console.error("[MyCouponsScreen] fetch error:", error);
        return;
      }
      setCoupons((data as BookingWithCoupon[]) || []);
    } catch (e) {
      console.error("[MyCouponsScreen] unexpected error:", e);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      fetchCoupons();
    }, [fetchCoupons]),
  );

  return (
    <ProfileLayout navigation={navigation} title="My Coupons" fallback="Main" tabBarPadding>
      {loading ? (
        <Text style={{ color: c.textSecondary, textAlign: "center", marginTop: 20 }}>Loading your coupons...</Text>
      ) : coupons.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ color: c.textSecondary }}>No coupons</Text>
        </View>
      ) : (
        <FlatList
          data={coupons}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingTop: 12 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const coupon = item.organizer_coupons;
            if (!coupon) return null;

            return (
              <Card style={{ padding: 16, marginBottom: 12 }}>
                <View style={styles.couponHeader}>
                  <Text style={[styles.couponCode, { color: c.textPrimary }]}>
                    {coupon.code}
                  </Text>
                  <Badge variant="success">{coupon.discount_percent}% OFF</Badge>
                </View>
                {coupon.description ? (
                  <Text style={{ fontSize: 13, color: c.textSecondary, marginBottom: 8 }}>
                    {coupon.description}
                  </Text>
                ) : null}
                <View style={styles.bookingInfo}>
                  <Text style={{ fontSize: 12, fontWeight: "500", color: c.textSecondary }}>
                    Booking #{item.id}
                  </Text>
                  <View
                    style={[
                      styles.statusBadge,
                      {
                        backgroundColor:
                          item.status === "confirmed"
                            ? "rgba(34,197,94,0.15)"
                            : item.status === "cancelled"
                            ? "rgba(239,68,68,0.15)"
                            : "rgba(234,179,8,0.15)",
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusText,
                        {
                          color:
                            item.status === "confirmed"
                              ? "#22c55e"
                              : item.status === "cancelled"
                              ? "#ef4444"
                              : "#eab308",
                        },
                      ]}
                    >
                      {item.status?.toUpperCase() || "PENDING"}
                    </Text>
                  </View>
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
  bookingInfo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  statusBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: { fontSize: 11, fontWeight: "700" },
});