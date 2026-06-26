import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  Pressable,
  Image,
  Modal,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { WebView } from "react-native-webview";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { apiFetch, readApiErrorMessage } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useThemeColors } from "../theme";
import { MediaThumbnail } from "../components/MediaThumbnail";
import { Badge } from "../components/ui";
import { ConfirmModal } from "../components/ConfirmModal";

type Props = NativeStackScreenProps<RootStackParamList, "TripDetail">;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function TripDetailScreen({ route, navigation }: Props) {
  const { id, prefillCoupon } = route.params;
  const { user } = useAuth();
  const c = useThemeColors();
  const [trip, setTrip] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBookConfirm, setShowBookConfirm] = useState(false);
  const [bookAction, setBookAction] = useState<() => void>(() => {});
  const [coupon, setCoupon] = useState("");
  const [appliedPct, setAppliedPct] = useState<number | null>(null);
  const [appliedDiscountAmount, setAppliedDiscountAmount] = useState<number>(0);
  const [booking, setBooking] = useState(false);

  const [showPaymentWebView, setShowPaymentWebView] = useState(false);
  const [suggestedCoupon, setSuggestedCoupon] = useState<{ code: string; discount_pct: number; description: string } | null>(null);
  const [isPaymentLoading, setIsPaymentLoading] = useState(false);
  const [paymentHtml, setPaymentHtml] = useState<string | null>(null);
  const [cashfreeOrderId, setCashfreeOrderId] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [fullscreenMediaIndex, setFullscreenMediaIndex] = useState<number | null>(null);

  /** Theme-aware alert modal state */
  const [alertState, setAlertState] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm?: () => void;
    singleButton?: boolean;
  } | null>(null);

  const applyCoupon = async () => {
    const code = coupon.trim();
    if (!code) return;
    const res = await apiFetch(`/api/trips/${id}/coupons/validate`, {
      method: "POST",
      body: JSON.stringify({ code, participants: 1 }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.valid === false) {
      setAlertState({ title: "Coupon", message: typeof body?.error === "string" ? body.error : "Invalid code", singleButton: true });
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
      if (res.ok) {
        const data = await res.json();
        console.log('[TripDetail] full trip response:', JSON.stringify(data, null, 2));
        console.log('[TripDetail] banner_url field:', data.banner_url);
        console.log('[TripDetail] gallery field:', data.gallery);
        console.log('[TripDetail] gallery type:', typeof data.gallery);
        console.log('[TripDetail] gallery isArray:', Array.isArray(data.gallery));
        console.log('[TripDetail] gallery stringified:', JSON.stringify(data.gallery));
        setTrip(data);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadTrip();
  }, [loadTrip]);

  // Fetch suggested coupon for this trip
  useEffect(() => {
    if (!user?.id || !id) return;
    void (async () => {
      try {
        const res = await apiFetch(`/api/trips/${id}/suggested-coupon?user_id=${encodeURIComponent(String(user.id))}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.code) {
            setSuggestedCoupon(data);
          }
        }
      } catch {}
    })();
  }, [id, user?.id]);

  // Auto-apply prefillCoupon if provided
  useEffect(() => {
    if (prefillCoupon && !loading && trip) {
      setCoupon(prefillCoupon);
      // Auto-trigger applyCoupon after trip loads
      const timer = setTimeout(() => {
        void (async () => {
          const res = await apiFetch(`/api/trips/${id}/coupons/validate`, {
            method: "POST",
            body: JSON.stringify({ code: prefillCoupon, participants: 1 }),
          });
          const body = await res.json().catch(() => ({}));
          if (res.ok && body?.valid === true) {
            setAppliedPct(Number(body.discount_pct) || 0);
            setAppliedDiscountAmount(Number(body.discount_amount) || 0);
          }
        })();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [prefillCoupon, loading, trip, id]);

  const pollPaymentStatus = useCallback(
    async (orderId: string) => {
      for (let i = 0; i < 40; i++) {
        try {
          const r = await apiFetch(`/api/payments/verify/${encodeURIComponent(orderId)}`);
          const j = (await r.json()) as { paymentStatus?: string };
          if (j.paymentStatus === "paid") {
            setAlertState({
              title: "🎉 Payment Successful!",
              message: `You're now registered for ${String(trip?.name ?? "this trip")}`,
              confirmLabel: "View Trip",
              onConfirm: () => navigation.navigate("TripDetail", { id }),
              singleButton: true,
            });
            void loadTrip();
            return;
          }
          if (j.paymentStatus === "failed") {
            setAlertState({
              title: "Payment Failed",
              message: "Your payment was not completed. Please try again.",
              singleButton: true,
            });
            return;
          }
        } catch {
          /* continue */
        }
        await sleep(500);
      }
      setAlertState({ title: "Payment", message: "Could not confirm payment status. Check My trips or try again.", singleButton: true });
    },
    [id, loadTrip, navigation, trip?.name],
  );

  const startCashfreeCheckout = async (bookingId: number, amount: number) => {
    if (!user?.email) {
      setAlertState({ title: "Profile", message: "Email missing — update your account.", singleButton: true });
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
        setAlertState({ title: "Payment", message: typeof body?.error === "string" ? body.error : await readApiErrorMessage(res), singleButton: true });
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
      setAlertState({ title: "Payment", message: "Could not initiate payment. Please try again.", singleButton: true });
    } finally {
      setIsPaymentLoading(false);
    }
  };

  const book = async () => {
    if (!user) {
      setAlertState({ title: "Sign in required", message: "Please sign in from the Profile tab.", singleButton: true });
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
          active_role: user.activeRole,
          participants: 1,
          ...(appliedPct != null && coupon.trim() ? { coupon_code: coupon.trim() } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      console.log("[book] Bookings response:", res.status, JSON.stringify(body));
      if (!res.ok) {
        setAlertState({ title: "Booking", message: await readApiErrorMessage(res), singleButton: true });
        return;
      }

      if (body?.already_joined) {
        setBookAction(() => () => navigation.goBack());
        setShowBookConfirm(true);
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
        setBookAction(() => () => navigation.goBack());
        setShowBookConfirm(true);
        return;
      }

      console.warn("[book] Unexpected booking response — missing needs_payment flag", body);
      setAlertState({ title: "Booking", message: "Unexpected response from server. Please check My Trips or try again.", singleButton: true });
    } catch (e) {
      console.error("[book] Exception:", e);
      setAlertState({ title: "Booking", message: "Something went wrong. Please try again.", singleButton: true });
    } finally {
      setBooking(false);
    }
  };

  const s = useMemo(() => makeStyles(c), [c]);

  if (loading || !trip) {
    return (
      <View style={s.center}>
        <Text style={s.muted}>{loading ? "Loading…" : "Trip not found"}</Text>
      </View>
    );
  }

  const name = String(trip.name ?? "Trip");
  const price = Number(trip.price ?? 0);
  const joined = Number(trip.joined_count ?? 0);
  const max = Number(trip.max_participants ?? 0);
  const free = price <= 0;
  const payablePreview = Math.max(0, Math.round(price - appliedDiscountAmount));
  const tripTags = (Array.isArray(trip.tags) ? trip.tags : []) as string[];
  const tripGallery = (() => {
    const g = trip.gallery;
    if (Array.isArray(g)) return g as Array<{url: string; type: string; thumbnailUrl?: string}>;
    if (typeof g === 'string') {
      try {
        const parsed = JSON.parse(g);
        if (Array.isArray(parsed)) return parsed as Array<{url: string; type: string; thumbnailUrl?: string}>;
      } catch {}
    }
    return [];
  })();
  console.log('[TripDetail] rendering, tripGallery.length:', tripGallery.length, 'galleryExpanded:', galleryOpen, 'gallery vvv IS SHOWN:', tripGallery.length > 0);

  return (
    <>
      <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: 40 }}>
        <Image
          source={{ uri: String(trip.banner_url ?? `https://picsum.photos/seed/${id}/800/400`) }}
          style={s.hero}
        />
        <View style={s.pad}>
          <Text style={s.title}>{name}</Text>
          <Text style={s.muted}>{String(trip.description ?? "").slice(0, 280)}</Text>
          <Text style={s.row}>
            {free ? "FREE" : `₹${price.toLocaleString()}`} · {joined}/{max || "—"} joined
          </Text>

          {!free && suggestedCoupon && appliedPct == null && (
            <View style={s.suggestBanner}>
              <Text style={s.suggestBannerText}>
                🎟 Use code <Text style={{ fontWeight: "800" }}>{suggestedCoupon.code}</Text> for {suggestedCoupon.discount_pct}% off
              </Text>
              <Pressable
                style={s.suggestBannerBtn}
                onPress={() => {
                  setCoupon(suggestedCoupon.code);
                  setTimeout(() => void applyCoupon(), 100);
                }}
              >
                <Text style={s.suggestBannerBtnText}>Apply</Text>
              </Pressable>
            </View>
          )}

          {!free && (
            <View style={s.couponBox}>
              <Text style={s.label}>Coupon</Text>
              <View style={s.couponRow}>
                <TextInput
                  style={s.input}
                  placeholder="CODE"
                  placeholderTextColor={c.muted}
                  autoCapitalize="characters"
                  value={coupon}
                  onChangeText={setCoupon}
                />
                <Pressable style={s.smallBtn} onPress={applyCoupon}>
                  <Text style={s.smallBtnText}>Apply</Text>
                </Pressable>
              </View>
              {appliedPct != null && (
                <>
                  <Text style={s.ok}>{appliedPct}% discount applied</Text>
                  <Text style={s.ok}>Payable now: ₹{payablePreview.toLocaleString("en-IN")}</Text>
                </>
              )}
              <View style={s.breakdownBox}>
                <View style={s.breakdownRow}>
                  <Text style={s.breakdownLabel}>Base</Text>
                  <Text style={s.breakdownValue}>₹{price.toLocaleString("en-IN")}</Text>
                </View>
                <View style={s.breakdownRow}>
                  <Text style={s.breakdownLabel}>Discount</Text>
                  <Text style={s.breakdownValue}>-₹{appliedDiscountAmount.toLocaleString("en-IN")}</Text>
                </View>
                <View style={[s.breakdownRow, { marginTop: 4 }]}>
                  <Text style={s.breakdownPayable}>Payable</Text>
                  <Text style={s.breakdownPayable}>₹{payablePreview.toLocaleString("en-IN")}</Text>
                </View>
              </View>
            </View>
          )}

          <Pressable
            style={[s.bookBtn, (booking || isPaymentLoading) && { opacity: 0.6 }]}
            onPress={book}
            disabled={booking || isPaymentLoading}
          >
            <Text style={s.bookText}>
              {booking || isPaymentLoading
                ? "…"
                : free || payablePreview <= 0
                  ? "Join trip"
                  : `Pay ₹${payablePreview.toLocaleString("en-IN")} & join`}
            </Text>
          </Pressable>

          <Pressable
            style={s.linkBtn}
            onPress={() => navigation.navigate("LiveTrip", { id })}
          >
            <Text style={s.linkText}>Open live trip (beta)</Text>
          </Pressable>

          {/* ── Trip Details Section ── */}
          <View style={s.detailSection}>
            <Text style={s.detailSectionTitle}>TRIP DETAILS</Text>

            {trip.date ? (
              <View style={s.detailRow}>
                <Text style={s.detailLabel}>Date</Text>
                <Text style={s.detailValue}>{String(trip.date)}</Text>
              </View>
            ) : null}
            {trip.time ? (
              <View style={s.detailRow}>
                <Text style={s.detailLabel}>Time</Text>
                <Text style={s.detailValue}>{String(trip.time)}</Text>
              </View>
            ) : null}
            {trip.duration ? (
              <View style={s.detailRow}>
                <Text style={s.detailLabel}>Duration</Text>
                <Text style={s.detailValue}>{String(trip.duration)}</Text>
              </View>
            ) : null}
            {trip.max_participants ? (
              <View style={s.detailRow}>
                <Text style={s.detailLabel}>Capacity</Text>
                <Text style={s.detailValue}>{joined}/{max} participants</Text>
              </View>
            ) : null}
            {trip.start_place_name ? (
              <View style={s.detailRow}>
                <Text style={s.detailLabel}>Start</Text>
                <Text style={s.detailValue}>{String(trip.start_place_name)}</Text>
              </View>
            ) : null}
            {trip.end_place_name ? (
              <View style={s.detailRow}>
                <Text style={s.detailLabel}>End</Text>
                <Text style={s.detailValue}>{String(trip.end_place_name)}</Text>
              </View>
            ) : null}
          </View>

          {tripTags.length > 0 && (
            <View style={s.detailSection}>
              <Text style={s.detailSectionTitle}>TAGS</Text>
              <View style={s.tagRow}>
                {tripTags.map((tag: string, idx: number) => (
                  <Badge key={`${tag}-${idx}`} variant="default">{tag}</Badge>
                ))}
              </View>
            </View>
          )}

          {tripGallery.length > 0 && (
            <View style={s.detailSection}>
              <Pressable
                style={s.galleryHeader}
                onPress={() => setGalleryOpen((p) => !p)}
              >
                <Text style={s.detailSectionTitle}>
                  PHOTOS & VIDEOS  ({tripGallery.length})
                </Text>
                <Text style={s.chevron}>{galleryOpen ? "▼" : "▶"}</Text>
              </Pressable>
              {galleryOpen ? (
                tripGallery.length > 0 ? (
                  <View style={s.galleryGrid}>
                    {tripGallery.map((item, idx) => (
                      <TouchableOpacity
                        key={`${item.url}-${idx}`}
                        style={s.galleryGridItem}
                        activeOpacity={0.8}
                        onPress={() => setFullscreenMediaIndex(idx)}
                      >
                        <MediaThumbnail
                          url={item.url}
                          type={item.type as "image" | "video"}
                          thumbnailUrl={item.thumbnailUrl}
                          size={160}
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : (
                  <Text style={s.galleryEmpty}>No photos yet</Text>
                )
              ) : null}
            </View>
          )}

          {trip.prerequisites ? (
            <View style={s.detailSection}>
              <Text style={s.detailSectionTitle}>PREREQUISITES</Text>
              <Text style={s.detailBody}>{String(trip.prerequisites)}</Text>
            </View>
          ) : null}

          {trip.terms ? (
            <View style={s.detailSection}>
              <Text style={s.detailSectionTitle}>TERMS & CONDITIONS</Text>
              <Text style={s.detailBody}>{String(trip.terms)}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <Modal visible={showPaymentWebView} animationType="slide" onRequestClose={() => setShowPaymentWebView(false)}>
        <View style={{ flex: 1, backgroundColor: c.bg }}>
          <View style={s.payHeader}>
            <Pressable
              onPress={() => {
                setShowPaymentWebView(false);
                if (cashfreeOrderId) void pollPaymentStatus(cashfreeOrderId);
              }}
            >
              <Text style={s.payClose}>Cancel</Text>
            </Pressable>
            <Text style={s.payTitle}>Secure checkout</Text>
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
                  setAlertState({ title: "Payment", message: "Payment failed or was cancelled.", singleButton: true });
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
                  setAlertState({ title: "Payment", message: "Payment failed or was cancelled.", singleButton: true });
                }
              }}
              startInLoadingState
              renderLoading={() => (
                <View style={s.wvLoading}>
                  <ActivityIndicator color={c.text} size="large" />
                </View>
              )}
            />
          ) : null}
        </View>
      </Modal>
      <ConfirmModal
        visible={showBookConfirm}
        onClose={() => setShowBookConfirm(false)}
        onConfirm={bookAction}
        title="Success"
        message="You're in!"
        confirmLabel="OK"
        cancelLabel=""
      />
      <ConfirmModal
        visible={alertState !== null}
        onClose={() => setAlertState(null)}
        onConfirm={() => {
          if (alertState?.onConfirm) alertState.onConfirm();
          setAlertState(null);
        }}
        title={alertState?.title ?? ""}
        message={alertState?.message ?? ""}
        confirmLabel={alertState?.confirmLabel}
        singleButton={alertState?.singleButton ?? false}
      />
    </>
  );
}

const makeStyles = (c: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    center: { flex: 1, backgroundColor: c.bg, justifyContent: "center", alignItems: "center" },
    hero: { width: "100%", height: 200 },
    pad: { padding: 16 },
    title: { color: c.text, fontSize: 24, fontWeight: "800" },
    muted: { color: c.muted, marginTop: 10, lineHeight: 22 },
    row: { color: c.text, marginTop: 16, fontWeight: "600" },
    couponBox: { marginTop: 20 },
    label: { color: c.muted, fontSize: 12, marginBottom: 6 },
    couponRow: { flexDirection: "row", gap: 8 },
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      padding: 12,
      color: c.text,
    },
    smallBtn: { backgroundColor: c.text, paddingHorizontal: 20, borderRadius: 12, justifyContent: "center" },
    smallBtnText: { color: c.bg, fontWeight: "800", fontSize: 13 },
    ok: { color: c.text, fontWeight: "700", marginTop: 4 },
    breakdownBox: {
      marginTop: 8,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      padding: 12,
    },
    breakdownRow: { flexDirection: "row", justifyContent: "space-between" },
    breakdownLabel: { color: c.muted, fontSize: 13 },
    breakdownValue: { color: c.text, fontWeight: "700", fontSize: 13 },
    breakdownPayable: { color: c.text, fontWeight: "800" },
    bookBtn: {
      backgroundColor: c.text,
      paddingVertical: 16,
      borderRadius: 14,
      alignItems: "center",
      marginTop: 20,
    },
    bookText: { color: c.bg, fontWeight: "800", fontSize: 16 },
    linkBtn: { alignItems: "center", marginTop: 10 },
    linkText: { color: c.muted, fontWeight: "600", fontSize: 13 },
    detailSection: {
      marginTop: 24,
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingTop: 16,
    },
    detailSectionTitle: { color: c.muted, fontSize: 10, fontWeight: "800", letterSpacing: 2, marginBottom: 12 },
    detailRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
    detailLabel: { color: c.muted, fontSize: 14 },
    detailValue: { color: c.text, fontWeight: "600", fontSize: 14, maxWidth: "60%", textAlign: "right" },
    detailBody: { color: c.text, lineHeight: 22 },
    tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    galleryHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    chevron: { color: c.muted, fontSize: 14 },
    galleryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
    galleryGridItem: { width: "48%", minWidth: 140 },
    galleryEmpty: { color: c.muted, fontStyle: "italic", marginTop: 8 },
    payHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingTop: 6,
      paddingBottom: 8,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    payClose: { color: c.text, fontWeight: "700", fontSize: 15 },
    payTitle: { color: c.text, fontWeight: "800", fontSize: 15 },
    wvLoading: { ...StyleSheet.absoluteFillObject, justifyContent: "center", alignItems: "center" },
    suggestBanner: {
      marginTop: 16,
      padding: 14,
      borderRadius: 12,
      backgroundColor: "rgba(0,229,176,0.1)",
      borderWidth: 1,
      borderColor: "rgba(0,229,176,0.3)",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    suggestBannerText: { color: c.text, fontSize: 13, flex: 1, marginRight: 8 },
    suggestBannerBtn: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: c.text,
    },
    suggestBannerBtnText: { color: c.bg, fontWeight: "700", fontSize: 12 },
  });
