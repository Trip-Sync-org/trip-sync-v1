import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  Pressable,
  Alert,
  Image,
  Modal,
  ActivityIndicator,
} from "react-native";
import { WebView } from "react-native-webview";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { apiFetch, readApiErrorMessage } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { colors } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "TripDetail">;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function TripDetailScreen({ route, navigation }: Props) {
  const { id } = route.params;
  const { user } = useAuth();
  const [trip, setTrip] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [coupon, setCoupon] = useState("");
  const [appliedPct, setAppliedPct] = useState<number | null>(null);
  const [appliedDiscountAmount, setAppliedDiscountAmount] = useState<number>(0);
  const [booking, setBooking] = useState(false);

  const [showPaymentWebView, setShowPaymentWebView] = useState(false);
  const [isPaymentLoading, setIsPaymentLoading] = useState(false);
  const [paymentHtml, setPaymentHtml] = useState<string | null>(null);
  const [cashfreeOrderId, setCashfreeOrderId] = useState<string | null>(null);

  const applyCoupon = async () => {
    const code = coupon.trim();
    if (!code) return;
    const res = await apiFetch(`/api/trips/${id}/coupons/validate`, {
      method: "POST",
      body: JSON.stringify({ code, participants: 1 }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.valid === false) {
      Alert.alert("Coupon", typeof body?.error === "string" ? body.error : "Invalid code");
      setAppliedPct(null);
      setAppliedDiscountAmount(0);
      return;
    }
    setAppliedPct(Number(body.discount_pct) || 0);
    setAppliedDiscountAmount(Number(body.discount_amount) || 0);
  };

  const loadTrip = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/trips/${id}`);
      if (res.ok) setTrip(await res.json());
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadTrip();
  }, [loadTrip]);

  const pollPaymentStatus = useCallback(
    async (orderId: string) => {
      for (let i = 0; i < 40; i++) {
        try {
          const r = await apiFetch(`/api/payments/verify/${encodeURIComponent(orderId)}`);
          const j = (await r.json()) as { paymentStatus?: string };
          if (j.paymentStatus === "paid") {
            Alert.alert("🎉 Payment Successful!", `You're now registered for ${String(trip?.name ?? "this trip")}`, [
              { text: "View Trip", onPress: () => navigation.navigate("TripDetail", { id }) },
            ]);
            void loadTrip();
            return;
          }
          if (j.paymentStatus === "failed") {
            Alert.alert("Payment Failed", "Your payment was not completed. Please try again.", [
              { text: "Try Again" },
              { text: "Cancel" },
            ]);
            return;
          }
        } catch {
          /* continue */
        }
        await sleep(500);
      }
      Alert.alert("Payment", "Could not confirm payment status. Check My trips or try again.");
    },
    [id, loadTrip, navigation, trip?.name],
  );

  const startCashfreeCheckout = async (bookingId: number, amount: number) => {
    if (!user?.email) {
      Alert.alert("Profile", "Email missing — update your account.");
      return;
    }
    setIsPaymentLoading(true);
    try {
      console.log("[startCashfreeCheckout] creating order for booking", bookingId, "amount", amount);
      const res = await apiFetch("/api/payments/create-order", {
        method: "POST",
        body: JSON.stringify({
          tripId: Number(id),
          amount,
          couponCode: coupon.trim() || undefined,
          userName: user.name ?? "TripSync User",
          userEmail: user.email || "user@tripsync.app",
          userPhone: "9999999999",
          bookingId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      console.log("[startCashfreeCheckout] create-order response:", res.status, JSON.stringify(body));
      if (!res.ok) {
        Alert.alert("Payment", typeof body?.error === "string" ? body.error : await readApiErrorMessage(res));
        return;
      }
      const p = body as { orderId: string; paymentSessionId: string; cashfreeMode?: "sandbox" | "production" };
      setCashfreeOrderId(p.orderId);
      const mode = p.cashfreeMode === "production" ? "production" : "sandbox";
      const html = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script></head><body style="margin:0;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;"><div id="status" style="font-family:sans-serif;font-size:14px;opacity:.8">Opening secure payment…</div><script>(function(){try{const cashfree=Cashfree({mode:"${mode}"});cashfree.checkout({paymentSessionId:"${p.paymentSessionId}",redirectTarget:"_self"}).then(function(result){if(result&&result.error){document.getElementById('status').textContent='Payment page failed to open.';}});}catch(e){document.getElementById('status').textContent='Checkout init failed.';}})();</script></body></html>`;
      setPaymentHtml(html);
      setShowPaymentWebView(true);
    } catch (e) {
      console.error("Payment initiation error:", e);
      Alert.alert("Payment", "Could not initiate payment. Please try again.");
    } finally {
      setIsPaymentLoading(false);
    }
  };

  const book = async () => {
    if (!user) {
      Alert.alert("Sign in required", "Please sign in from the Profile tab.");
      return;
    }
    setBooking(true);
    try {
      console.log("[book] Creating booking for trip", id, "user", user.id);
      const res = await apiFetch("/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          trip_id: Number(id),
          user_id: Number(user.id),
          participants: 1,
          ...(appliedPct != null && coupon.trim() ? { coupon_code: coupon.trim() } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      console.log("[book] Bookings response:", res.status, JSON.stringify(body));
      if (!res.ok) {
        Alert.alert("Booking", await readApiErrorMessage(res));
        return;
      }

      if (body?.already_joined) {
        Alert.alert("Already joined", "You're already on this trip.", [
          { text: "OK", onPress: () => navigation.goBack() },
        ]);
        return;
      }

      if (body?.needs_payment === true && body?.id != null) {
        const amt = Number(body.amount ?? 0);
        console.log("[book] needs_payment=true, amount=", amt, "bookingId=", body.id);
        await startCashfreeCheckout(Number(body.id), amt);
        return;
      }

      if (body?.needs_payment === false) {
        console.log("[book] needs_payment=false, confirming free booking");
        Alert.alert("Success", "You're in!", [{ text: "OK", onPress: () => navigation.goBack() }]);
        return;
      }

      console.warn("[book] Unexpected booking response — missing needs_payment flag", body);
      Alert.alert("Booking", "Unexpected response from server. Please check My Trips or try again.");
    } catch (e) {
      console.error("[book] Exception:", e);
      Alert.alert("Booking", "Something went wrong. Please try again.");
    } finally {
      setBooking(false);
    }
  };

  if (loading || !trip) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{loading ? "Loading…" : "Trip not found"}</Text>
      </View>
    );
  }

  const name = String(trip.name ?? "Trip");
  const price = Number(trip.price ?? 0);
  const joined = Number(trip.joined_count ?? 0);
  const max = Number(trip.max_participants ?? 0);
  const free = price <= 0;
  const payablePreview = Math.max(0, Math.round(price - appliedDiscountAmount));

  return (
    <>
      <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 40 }}>
        <Image
          source={{ uri: `https://picsum.photos/seed/${id}/800/400` }}
          style={styles.hero}
        />
        <View style={styles.pad}>
          <Text style={styles.title}>{name}</Text>
          <Text style={styles.muted}>{String(trip.description ?? "").slice(0, 280)}</Text>
          <Text style={styles.row}>
            {free ? "FREE" : `₹${price.toLocaleString()}`} · {joined}/{max || "—"} joined
          </Text>

          {!free && (
            <View style={styles.couponBox}>
              <Text style={styles.label}>Coupon</Text>
              <View style={styles.couponRow}>
                <TextInput
                  style={styles.input}
                  placeholder="CODE"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="characters"
                  value={coupon}
                  onChangeText={setCoupon}
                />
                <Pressable style={styles.smallBtn} onPress={applyCoupon}>
                  <Text style={styles.smallBtnText}>Apply</Text>
                </Pressable>
              </View>
              {appliedPct != null && (
                <>
                  <Text style={styles.ok}>{appliedPct}% discount applied</Text>
                  <Text style={styles.ok}>Payable now: ₹{payablePreview.toLocaleString("en-IN")}</Text>
                </>
              )}
              <View style={styles.breakdownBox}>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Base</Text>
                  <Text style={styles.breakdownValue}>₹{price.toLocaleString("en-IN")}</Text>
                </View>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Discount</Text>
                  <Text style={styles.breakdownValue}>-₹{appliedDiscountAmount.toLocaleString("en-IN")}</Text>
                </View>
                <View style={[styles.breakdownRow, { marginTop: 4 }]}>
                  <Text style={styles.breakdownPayable}>Payable</Text>
                  <Text style={styles.breakdownPayable}>₹{payablePreview.toLocaleString("en-IN")}</Text>
                </View>
              </View>
            </View>
          )}

          <Pressable
            style={[styles.bookBtn, (booking || isPaymentLoading) && { opacity: 0.6 }]}
            onPress={book}
            disabled={booking || isPaymentLoading}
          >
            <Text style={styles.bookText}>
              {booking || isPaymentLoading
                ? "…"
                : free || payablePreview <= 0
                  ? "Join trip"
                  : `Pay ₹${payablePreview.toLocaleString("en-IN")} & join`}
            </Text>
          </Pressable>

          <Pressable
            style={styles.linkBtn}
            onPress={() => navigation.navigate("LiveTrip", { id })}
          >
            <Text style={styles.linkText}>Open live trip (beta)</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal visible={showPaymentWebView} animationType="slide" onRequestClose={() => setShowPaymentWebView(false)}>
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={styles.payHeader}>
            <Pressable
              onPress={() => {
                setShowPaymentWebView(false);
                if (cashfreeOrderId) void pollPaymentStatus(cashfreeOrderId);
              }}
            >
              <Text style={styles.payClose}>Cancel</Text>
            </Pressable>
            <Text style={styles.payTitle}>Secure checkout</Text>
            <View style={{ width: 56 }} />
          </View>
          {paymentHtml ? (
            <WebView
              originWhitelist={["*"]}
              source={{ html: paymentHtml, baseUrl: "https://cashfree.com" }}
              onShouldStartLoadWithRequest={(req) => {
                const u = req.url || "";
                if (u.startsWith("tripsync://payment/success")) {
                  setShowPaymentWebView(false);
                  if (cashfreeOrderId) void pollPaymentStatus(cashfreeOrderId);
                  return false;
                }
                if (u.startsWith("tripsync://payment/failure")) {
                  setShowPaymentWebView(false);
                  Alert.alert("Payment", "Payment failed or was cancelled.");
                  return false;
                }
                return true;
              }}
              onNavigationStateChange={(nav) => {
                const u = nav.url || "";
                if (u.includes("tripsync://payment/success")) {
                  setShowPaymentWebView(false);
                  if (cashfreeOrderId) void pollPaymentStatus(cashfreeOrderId);
                }
                if (u.includes("tripsync://payment/failure")) {
                  setShowPaymentWebView(false);
                  Alert.alert("Payment", "Payment failed or was cancelled.");
                }
              }}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.wvLoading}>
                  <ActivityIndicator color={colors.text} size="large" />
                </View>
              )}
            />
          ) : null}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: "center", alignItems: "center" },
  hero: { width: "100%", height: 200 },
  pad: { padding: 16 },
  title: { color: colors.text, fontSize: 24, fontWeight: "800" },
  muted: { color: colors.muted, marginTop: 10, lineHeight: 22 },
  row: { color: colors.text, marginTop: 16, fontWeight: "600" },
  couponBox: { marginTop: 20 },
  label: { color: colors.muted, fontSize: 12, marginBottom: 6 },
  couponRow: { flexDirection: "row", gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    color: colors.text,
  },
  smallBtn: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  smallBtnText: { color: colors.text, fontWeight: "700" },
  ok: { color: colors.success, marginTop: 8, fontSize: 13 },
  breakdownBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 10,
    backgroundColor: "rgba(255,255,255,0.02)",
    gap: 6,
  },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  breakdownLabel: { color: colors.muted, fontSize: 13 },
  breakdownValue: { color: colors.text, fontSize: 13, fontWeight: "600" },
  breakdownPayable: { color: colors.success, fontSize: 14, fontWeight: "800" },
  bookBtn: {
    marginTop: 24,
    backgroundColor: colors.text,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
  },
  bookText: { color: colors.bg, fontWeight: "800", fontSize: 16 },
  linkBtn: { marginTop: 16, alignItems: "center" },
  linkText: { color: colors.muted, textDecorationLine: "underline" },
  payHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  payClose: { color: colors.muted, fontSize: 16 },
  payTitle: { color: colors.text, fontWeight: "700", fontSize: 16 },
  wvLoading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.bg,
  },
});
