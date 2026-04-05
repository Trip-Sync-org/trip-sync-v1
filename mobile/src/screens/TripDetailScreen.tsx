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
  const [booking, setBooking] = useState(false);

  const [payModal, setPayModal] = useState(false);
  const [payHtml, setPayHtml] = useState<string | null>(null);
  const [pendingTxnId, setPendingTxnId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`/api/trips/${id}`);
        if (res.ok) setTrip(await res.json());
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

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
      return;
    }
    setAppliedPct(Number(body.discount_pct) || 0);
  };

  const pollPaymentStatus = useCallback(
    async (txnid: string) => {
      for (let i = 0; i < 40; i++) {
        try {
          const r = await apiFetch(`/api/payments/verify/${encodeURIComponent(txnid)}`);
          const j = (await r.json()) as { payment_status?: string };
          if (j.payment_status === "paid") {
            Alert.alert("Success", "Payment confirmed — you're in!", [
              { text: "OK", onPress: () => navigation.goBack() },
            ]);
            return;
          }
          if (j.payment_status === "failed") {
            Alert.alert("Payment", "Payment was not completed.");
            return;
          }
        } catch {
          /* continue */
        }
        await sleep(500);
      }
      Alert.alert("Payment", "Could not confirm payment status. Check My trips or try again.");
    },
    [navigation],
  );

  const startPayuCheckout = async (bookingId: number, amount: number) => {
    if (!user?.email) {
      Alert.alert("Profile", "Email missing — update your account.");
      return;
    }
    const res = await apiFetch("/api/payments/initiate", {
      method: "POST",
      body: JSON.stringify({
        tripId: Number(id),
        bookingId,
        amount,
        userEmail: user.email,
        userPhone: "9999999999",
        userName: user.name ?? "TripSync User",
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      Alert.alert("Payment", typeof body?.error === "string" ? body.error : await readApiErrorMessage(res));
      return;
    }
    const p = body as {
      payuUrl: string;
      key: string;
      txnid: string;
      amount: string;
      productinfo: string;
      firstname: string;
      email: string;
      phone: string;
      surl: string;
      furl: string;
      hash: string;
    };

    const fields: Record<string, string> = {
      key: p.key,
      txnid: p.txnid,
      amount: p.amount,
      productinfo: p.productinfo,
      firstname: p.firstname,
      email: p.email,
      phone: p.phone,
      surl: p.surl,
      furl: p.furl,
      hash: p.hash,
    };
    const formInputs = Object.entries(fields)
      .map(
        ([k, v]) =>
          `<input type="hidden" name="${k.replace(/"/g, "&quot;")}" value="${String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" />`,
      )
      .join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/></head><body onload="document.getElementById('f').submit()">
<form id="f" method="post" action="${p.payuUrl.replace(/"/g, "&quot;")}">
${formInputs}
<noscript><button type="submit">Continue to PayU</button></noscript>
</form></body></html>`;

    setPendingTxnId(p.txnid);
    setPayHtml(html);
    setPayModal(true);
  };

  const book = async () => {
    if (!user) {
      Alert.alert("Sign in required", "Please sign in from the Profile tab.");
      return;
    }
    setBooking(true);
    try {
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
        await startPayuCheckout(Number(body.id), amt);
        return;
      }

      Alert.alert("Success", "You're in!", [{ text: "OK", onPress: () => navigation.goBack() }]);
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
                <Text style={styles.ok}>{appliedPct}% discount applied</Text>
              )}
            </View>
          )}

          <Pressable
            style={[styles.bookBtn, booking && { opacity: 0.6 }]}
            onPress={book}
            disabled={booking}
          >
            <Text style={styles.bookText}>
              {booking ? "…" : free ? "Request to join" : "Pay & join"}
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

      <Modal visible={payModal} animationType="slide" onRequestClose={() => setPayModal(false)}>
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={styles.payHeader}>
            <Pressable onPress={() => setPayModal(false)}>
              <Text style={styles.payClose}>Cancel</Text>
            </Pressable>
            <Text style={styles.payTitle}>Secure checkout</Text>
            <View style={{ width: 56 }} />
          </View>
          {payHtml ? (
            <WebView
              originWhitelist={["*"]}
              source={{ html: payHtml, baseUrl: "https://payu.in" }}
              onNavigationStateChange={(nav) => {
                const u = nav.url || "";
                if (u.includes("tripsync://payment/success")) {
                  setPayModal(false);
                  setPayHtml(null);
                  const m = u.match(/txnid=([^&]+)/);
                  const txn = m ? decodeURIComponent(m[1]) : pendingTxnId;
                  if (txn) void pollPaymentStatus(txn);
                }
                if (u.includes("tripsync://payment/failure")) {
                  setPayModal(false);
                  setPayHtml(null);
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
