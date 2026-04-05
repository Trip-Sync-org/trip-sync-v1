import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TextInput,
  Image,
  Modal,
  Share,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useNavigation, useRoute, useFocusEffect, RouteProp } from "@react-navigation/native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { apiFetch, readApiErrorMessage } from "../api/client";
import type { MainTabParamList, RootStackParamList } from "../navigation/AppNavigator";
import { navigateToRootStack } from "../navigation/navigateRoot";
import {
  formatRangeLabel,
  getDateRangeForPreset,
  type PeriodPreset,
  toLocalYmd,
} from "../lib/revenuePeriod";
import { useOrganizerPaymentsSocket } from "../hooks/useOrganizerPaymentsSocket";
import { buildRevenueSummaryHtml, shareRevenuePdf } from "../lib/revenuePdf";
import { useAuth } from "../context/AuthContext";
import { colors, typography } from "../theme";
import { Card, Badge, PrimaryButton, OutlineButton } from "../components/ui";
import { parseDateOnlyLocal } from "../lib/tripNormalize";

const TABS = [
  "Today's Events",
  "Upcoming Events",
  "Manage Events",
  "Marketplace Listings",
  "Revenue Analytics",
  "Coupons",
] as const;

type OrgTab = (typeof TABS)[number];

type OrgDashEvent = {
  id: number;
  name: string;
  date: string;
  theme: string;
  joined: number;
  max: number;
  revenue: number;
  status: string;
  scope: "today" | "upcoming" | "past";
  banner: string;
  privacy: "public" | "private";
};

type CouponRow = {
  id: string;
  code: string;
  discount: number;
  limit: number;
  used: number;
  expiry: string;
  active: boolean;
  prefix: string;
};

const CAL_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TEAL = "#00E5B0";

function generateCouponCode(prefix: string): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return (
    prefix +
    Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
  );
}

export function OrganizerScreen() {
  const { user } = useAuth();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<MainTabParamList, "MyTripsTab">>();
  const goStack = (routeName: keyof RootStackParamList, params?: RootStackParamList[keyof RootStackParamList]) => {
    navigateToRootStack(navigation, routeName as string, params as Record<string, unknown> | undefined);
  };

  const [activeTab, setActiveTab] = useState<OrgTab>("Today's Events");
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [events, setEvents] = useState<OrgDashEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [summary, setSummary] = useState({
    totalRevenue: 0,
    participants: 0,
    eventsHosted: 0,
    successRate: 0,
    activeCoupons: 0,
    expiringCoupons: 0,
  });
  const [monthlyPaidChart, setMonthlyPaidChart] = useState<number[]>(() =>
    Array.from({ length: 12 }, () => 0),
  );
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [couponsFetchError, setCouponsFetchError] = useState<string | null>(null);
  type RevenueTxn = {
    bookingId: number;
    memberName: string;
    tripTitle: string;
    grossAmount: number;
    amountPaid: number;
    couponCode: string | null;
    couponDiscount: number;
    paymentType: "real" | "coupon" | "free_coupon";
    paidAt: string | null;
  };

  type RevenueDetail = {
    realRevenue: number;
    couponRevenue: number;
    freeCouponCount: number;
    freeCouponValue: number;
    realBookingCount: number;
    couponBookingCount: number;
    totalGrossRevenue: number;
    platformFee: number;
    eligibleForPayout: number;
    totalPaidOut: number;
    pendingPayout: number;
    availableBalance: number;
    tripBreakdown: Array<{
      tripId: number;
      tripTitle: string;
      totalBookings: number;
      grossAmount: number;
      eligibleAmount: number;
    }>;
    transactions: RevenueTxn[];
    wallet?: {
      eligibleForPayout: number;
      availableBalance: number;
      totalPaidOut: number;
      pendingPayout: number;
    };
    dateRange?: { from: string; to: string } | null;
    isPeriodFiltered?: boolean;
    periodEligibleForPayout?: number;
  };

  const [revenueDetail, setRevenueDetail] = useState<RevenueDetail | null>(null);
  const [txnFilter, setTxnFilter] = useState<"all" | "real" | "coupon" | "free">("all");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [payuLoading, setPayuLoading] = useState(false);

  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("all");
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d;
  });
  const [customTo, setCustomTo] = useState(() => new Date());
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [androidPicker, setAndroidPicker] = useState<"from" | "to" | null>(null);

  const activeRange = useMemo(
    () => getDateRangeForPreset(periodPreset, customFrom, customTo),
    [periodPreset, customFrom, customTo],
  );

  const [newCoupon, setNewCoupon] = useState({ prefix: "NOMAD", discount: 10, limit: 50, expiry: "" });
  const [genCode, setGenCode] = useState("");

  const [manageSearch, setManageSearch] = useState("");

  useFocusEffect(
    React.useCallback(() => {
      const t = route.params?.openTab;
      if (t && TABS.includes(t as OrgTab)) {
        setActiveTab(t as OrgTab);
        navigation.setParams({ openTab: undefined } as never);
      }
    }, [route.params?.openTab, navigation]),
  );

  const loadEvents = useCallback(async () => {
    if (!user?.id) return;
    try {
      setEventsLoading(true);
      const res = await apiFetch(`/api/organizers/${user.id}/events`);
      if (!res.ok) return;
      const rows = await res.json();
      const mapped: OrgDashEvent[] = (rows || []).map((row: Record<string, unknown>) => {
        const scope = (row.scope || "upcoming") as OrgDashEvent["scope"];
        const d = row.date ? parseDateOnlyLocal(String(row.date)) : null;
        const dateShort = d
          ? d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })
          : "TBA";
        const dateLabel = scope === "today" ? `Today, ${dateShort}` : dateShort;
        return {
          id: Number(row.id),
          name: String(row.name || "Untitled Event"),
          date: dateLabel,
          theme: String(row.theme || "Adventure"),
          joined: Number(row.joined_count || 0),
          max: Number(row.max_participants || 0),
          revenue: Number(row.revenue || 0),
          status: scope === "today" ? "active" : scope === "past" ? "completed" : "upcoming",
          scope,
          banner: String(row.banner_url || row.banner || `trip-${row.id}`),
          privacy: row.privacy === "private" ? "private" : "public",
        };
      });
      setEvents(mapped);
    } catch {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, [user?.id]);

  const loadSummary = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [summaryRes, couponRes] = await Promise.all([
        apiFetch(`/api/organizers/${user.id}/dashboard-summary`),
        apiFetch(`/api/organizers/${user.id}/coupons`),
      ]);
      if (summaryRes.ok) {
        const s = await summaryRes.json();
        setSummary({
          totalRevenue: Number(s.totalRevenue || 0),
          participants: Number(s.participants || 0),
          eventsHosted: Number(s.eventsHosted || 0),
          successRate: Number(s.successRate || 0),
          activeCoupons: Number(s.activeCoupons || 0),
          expiringCoupons: Number(s.expiringCoupons || 0),
        });
      }
      if (couponRes.ok) {
        setCouponsFetchError(null);
        const rows = await couponRes.json();
        setCoupons(
          (rows || []).map((c: Record<string, unknown>) => ({
            id: String(c.id),
            code: String(c.code),
            discount: Number(c.discount_pct || 0),
            limit: Number(c.usage_limit || 0),
            used: Number(c.used_count || 0),
            expiry: c.expiry_date
              ? new Date(String(c.expiry_date)).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                })
              : "No expiry",
            active: Boolean(c.active),
            prefix: String(c.prefix || ""),
          })),
        );
      } else {
        setCouponsFetchError(await readApiErrorMessage(couponRes));
      }
    } catch {
      /* keep partial state */
    }
  }, [user?.id]);

  const loadMonthlyPaid = useCallback(async () => {
    if (!user?.id) return;
    const y =
      activeRange != null
        ? new Date(activeRange.to + "T12:00:00").getFullYear()
        : new Date().getFullYear();
    let qs = `?year=${y}`;
    if (activeRange != null) {
      qs += `&from=${encodeURIComponent(activeRange.from)}&to=${encodeURIComponent(activeRange.to)}`;
    }
    try {
      const res = await apiFetch(`/api/organizers/${user.id}/monthly-revenue${qs}`);
      if (!res.ok) return;
      const rows = await res.json();
      const arr = Array.from({ length: 12 }, () => 0);
      for (const row of rows || []) {
        const i = Number((row as { month?: number }).month);
        if (Number.isFinite(i) && i >= 0 && i < 12) {
          arr[i] = Number((row as { revenue?: number }).revenue || 0);
        }
      }
      setMonthlyPaidChart(arr);
    } catch {
      /* ignore */
    }
  }, [user?.id, activeRange]);

  const loadOrganizerMoney = useCallback(async () => {
    if (!user?.id) return;
    setPayuLoading(true);
    try {
      const qs =
        activeRange != null
          ? `?from=${encodeURIComponent(activeRange.from)}&to=${encodeURIComponent(activeRange.to)}`
          : "";
      const rev = await apiFetch(
        `/api/organizer/revenue/${encodeURIComponent(String(user.id))}${qs}`,
      );
      if (rev.ok) {
        const j = (await rev.json()) as RevenueDetail;
        setRevenueDetail(j);
      }
    } catch {
      /* ignore */
    } finally {
      setPayuLoading(false);
    }
  }, [user?.id, activeRange]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const tasks = [loadEvents(), loadSummary(), loadOrganizerMoney()];
    if (activeTab === "Revenue Analytics") tasks.push(loadMonthlyPaid());
    await Promise.all(tasks);
    setRefreshing(false);
  }, [loadEvents, loadSummary, loadOrganizerMoney, loadMonthlyPaid, activeTab]);

  useEffect(() => {
    if (activeTab !== "Revenue Analytics") return;
    void loadOrganizerMoney();
    void loadMonthlyPaid();
  }, [activeTab, loadOrganizerMoney, loadMonthlyPaid]);

  useEffect(() => {
    if (activeTab !== "Revenue Analytics") return;
    const id = setInterval(() => {
      void loadOrganizerMoney();
      void loadMonthlyPaid();
    }, 60000);
    return () => clearInterval(id);
  }, [activeTab, loadOrganizerMoney, loadMonthlyPaid]);

  useOrganizerPaymentsSocket({
    userId: user?.id != null ? Number(user.id) : undefined,
    role: user?.role,
    onPaymentConfirmed: () => {
      void loadOrganizerMoney();
      void loadMonthlyPaid();
    },
    onPayoutUpdated: () => {
      void loadOrganizerMoney();
    },
  });

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const openCreate = () => goStack("CreateEvent");

  const saveCoupon = async () => {
    if (!user?.id || !genCode.trim()) return;
    const res = await apiFetch(`/api/organizers/${user.id}/coupons`, {
      method: "POST",
      body: JSON.stringify({
        code: genCode.trim(),
        prefix: newCoupon.prefix.trim(),
        discount_pct: Math.min(100, Math.max(1, newCoupon.discount)),
        usage_limit: Math.max(1, newCoupon.limit),
        expiry_date: newCoupon.expiry.trim() || null,
      }),
    });
    if (!res.ok) {
      const msg = await readApiErrorMessage(res);
      setCouponsFetchError(msg);
      return;
    }
    setGenCode("");
    setNewCoupon({ prefix: "NOMAD", discount: 10, limit: 50, expiry: "" });
    await loadSummary();
    const couponRes = await apiFetch(`/api/organizers/${user.id}/coupons`);
    if (couponRes.ok) {
      const rows = await couponRes.json();
      setCoupons(
        (rows || []).map((c: Record<string, unknown>) => ({
          id: String(c.id),
          code: String(c.code),
          discount: Number(c.discount_pct || 0),
          limit: Number(c.usage_limit || 0),
          used: Number(c.used_count || 0),
          expiry: c.expiry_date
            ? new Date(String(c.expiry_date)).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
              })
            : "No expiry",
          active: Boolean(c.active),
          prefix: String(c.prefix || ""),
        })),
      );
    }
  };

  const filteredManage = events.filter((t) =>
    manageSearch ? t.name.toLowerCase().includes(manageSearch.toLowerCase()) : true,
  );

  const exportRevenuePdf = async () => {
    if (!revenueDetail || !user?.id) return;
    try {
      setPdfBusy(true);
      const r = revenueDetail;
      const periodNote = formatRangeLabel(periodPreset, activeRange);
      const asOfLabel = `${new Date().toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })} · ${periodNote}`;
      const html = buildRevenueSummaryHtml({
        organizerName: user.name ?? "Organizer",
        asOfLabel,
        summary: {
          grossRevenue: r.totalGrossRevenue,
          platformFee: r.platformFee,
          eligiblePayout: r.eligibleForPayout,
          realPayments: r.realRevenue,
          couponPayments: r.couponRevenue,
          freeCoupons: r.freeCouponCount,
          freeCouponFaceValue: r.freeCouponValue,
          totalPaidOut: r.wallet?.totalPaidOut ?? r.totalPaidOut,
          availableBalance: r.wallet?.availableBalance ?? r.availableBalance,
        },
        trips: r.tripBreakdown.map((t) => ({
          tripTitle: t.tripTitle,
          totalBookings: t.totalBookings,
          grossAmount: t.grossAmount,
          eligibleAmount: t.eligibleAmount,
        })),
        transactions: r.transactions.slice(0, 30).map((t) => ({
          paidAt: t.paidAt ? String(t.paidAt).slice(0, 10) : "—",
          memberName: t.memberName,
          tripTitle: t.tripTitle,
          grossAmount: t.grossAmount,
          amountPaid: t.amountPaid,
          type: t.paymentType,
        })),
      });
      await shareRevenuePdf(html);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert("Export failed", msg || "Could not generate or share PDF. On Android, ensure a files app is available.");
    } finally {
      setPdfBusy(false);
    }
  };

  const renderTab = () => {
    if (activeTab === "Today's Events" || activeTab === "Upcoming Events") {
      const list = events.filter((t) =>
        activeTab === "Today's Events" ? t.scope === "today" : t.scope === "upcoming",
      );
      return (
        <View style={styles.tabBody}>
          {eventsLoading ? (
            <Text style={styles.muted}>Loading events…</Text>
          ) : list.length === 0 ? (
            <Card style={{ padding: 24 }}>
              <Text style={[styles.muted, { textAlign: "center", marginBottom: 16 }]}>
                No events for this period
              </Text>
              <PrimaryButton title="+ Create an Event" onPress={openCreate} />
            </Card>
          ) : (
            list.map((trip) => (
              <Card key={trip.id} style={{ padding: 14, marginBottom: 12 }}>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <Image
                    source={{ uri: `https://picsum.photos/seed/${trip.banner}/200/200` }}
                    style={styles.thumb}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{trip.name}</Text>
                    <Text style={styles.mutedSmall}>
                      {trip.date} · {trip.theme}
                    </Text>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <Badge variant={trip.scope === "today" ? "success" : "default"}>
                        {trip.scope === "today" ? "Today" : "Upcoming"}
                      </Badge>
                      <Badge variant={trip.privacy === "public" ? "info" : "warning"}>
                        {trip.privacy === "public" ? "Public" : "Private"}
                      </Badge>
                    </View>
                    <Text style={styles.mutedSmall}>
                      {trip.joined}/{trip.max} joined · ₹{trip.revenue.toLocaleString()} earned
                    </Text>
                    <View style={styles.rowBtns}>
                      <Pressable
                        style={styles.btnOutlineSm}
                        onPress={() => goStack("LiveTrip", { id: String(trip.id) })}
                      >
                        <Text style={styles.btnOutlineSmText}>Go Live</Text>
                      </Pressable>
                      <Pressable
                        style={styles.btnPrimarySm}
                        onPress={() => goStack("TripDetail", { id: String(trip.id) })}
                      >
                        <Text style={styles.btnPrimarySmText}>Details</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              </Card>
            ))
          )}
        </View>
      );
    }

    if (activeTab === "Manage Events") {
      return (
        <View style={styles.tabBody}>
          <TextInput
            style={styles.search}
            placeholder="Search events…"
            placeholderTextColor={colors.muted2}
            value={manageSearch}
            onChangeText={setManageSearch}
          />
          {filteredManage.map((trip) => (
            <Card key={trip.id} style={{ padding: 14, marginBottom: 12 }}>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <Image
                  source={{ uri: `https://picsum.photos/seed/${trip.banner}/200/200` }}
                  style={styles.thumbSm}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{trip.name}</Text>
                  <Text style={styles.mutedSmall}>
                    {trip.date} · {trip.joined}/{trip.max} participants
                  </Text>
                  <View style={styles.progressBg}>
                    <View
                      style={[
                        styles.progressFg,
                        {
                          width: `${trip.max > 0 ? Math.min(100, (trip.joined / trip.max) * 100) : 0}%`,
                        },
                      ]}
                    />
                  </View>
                  <Badge variant="success">{trip.status}</Badge>
                </View>
              </View>
            </Card>
          ))}
        </View>
      );
    }

    if (activeTab === "Marketplace Listings") {
      const pub = events.filter((t) => t.privacy === "public" && t.scope !== "past");
      return (
        <View style={styles.tabBody}>
          {pub.length === 0 ? (
            <Text style={styles.muted}>No public listings yet.</Text>
          ) : (
            pub.map((trip) => (
              <Card key={trip.id} style={{ padding: 14, marginBottom: 12 }}>
                <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                  <Image
                    source={{ uri: `https://picsum.photos/seed/${trip.banner}/200/200` }}
                    style={styles.thumbSm}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{trip.name}</Text>
                    <Text style={styles.mutedSmall}>
                      {trip.joined} booked
                      {trip.max > 0 ? ` · ${Math.max(0, trip.max - trip.joined)} slots left` : ""}
                    </Text>
                  </View>
                  <OutlineButton
                    title="Preview"
                    onPress={() => goStack("TripDetail", { id: String(trip.id) })}
                  />
                </View>
              </Card>
            ))
          )}
        </View>
      );
    }

    if (activeTab === "Revenue Analytics") {
      const maxM = Math.max(...monthlyPaidChart, 1);
      const chartYear =
        activeRange != null
          ? new Date(activeRange.to + "T12:00:00").getFullYear()
          : new Date().getFullYear();
      const now = new Date();
      const thisMonthVal =
        chartYear === now.getFullYear() ? monthlyPaidChart[now.getMonth()] || 0 : 0;
      const r = revenueDetail;
      const periodFiltered = Boolean(r?.isPeriodFiltered);
      const cashTotal = (r?.realRevenue ?? 0) + (r?.couponRevenue ?? 0);
      const realPct = cashTotal > 0 ? ((r?.realRevenue ?? 0) / cashTotal) * 100 : 0;
      const couponPct = cashTotal > 0 ? ((r?.couponRevenue ?? 0) / cashTotal) * 100 : 0;
      const trips = r?.tripBreakdown ?? [];
      const totalBookings = trips.reduce((a, t) => a + t.totalBookings, 0);
      const avgPerTrip =
        trips.length > 0 && r ? Math.round(r.totalGrossRevenue / trips.length) : 0;
      const txns = r?.transactions ?? [];
      const filtered = txns.filter((t) => {
        if (txnFilter === "all") return true;
        if (txnFilter === "real") return t.paymentType === "real";
        if (txnFilter === "coupon") return t.paymentType === "coupon";
        return t.paymentType === "free_coupon";
      });

      const txnBadge = (t: RevenueTxn) => {
        if (t.paymentType === "real") return { label: "REAL", variant: "success" as const };
        if (t.paymentType === "coupon")
          return {
            label: `COUPON −₹${Number(t.couponDiscount ?? 0).toLocaleString("en-IN")}`,
            variant: "info" as const,
          };
        return { label: "FREE COUPON", variant: "warning" as const };
      };

      return (
        <View style={styles.tabBody}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <Text style={styles.sectionTitleCaps}>Revenue</Text>
            <Pressable onPress={() => void exportRevenuePdf()} disabled={pdfBusy || !r}>
              <Text style={{ color: TEAL, fontWeight: "700" }}>{pdfBusy ? "…" : "↑ Export PDF"}</Text>
            </Pressable>
          </View>

          <Text style={[styles.mutedSmall, { marginBottom: 8 }]}>
            {formatRangeLabel(periodPreset, activeRange)}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {(["all", "week", "month", "year", "custom"] as const).map((p) => {
              const on = periodPreset === p;
              return (
                <Pressable
                  key={p}
                  onPress={() => {
                    if (p === "custom") setCustomModalOpen(true);
                    else setPeriodPreset(p);
                  }}
                  style={[styles.periodChip, on && styles.periodChipOn]}
                >
                  <Text style={[styles.periodChipText, on && styles.periodChipTextOn]}>
                    {p === "all"
                      ? "All"
                      : p === "week"
                        ? "Week"
                        : p === "month"
                          ? "Month"
                          : p === "year"
                            ? "Year"
                            : "Custom"}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {payuLoading ? (
            <Card style={{ padding: 24, alignItems: "center" }}>
              <ActivityIndicator color={TEAL} />
              <Text style={[styles.mutedSmall, { marginTop: 12 }]}>Loading revenue…</Text>
            </Card>
          ) : r ? (
            <>
              <Text style={[styles.sectionTitle, { marginTop: 0 }]}>Dashboard summary</Text>
              {periodFiltered ? (
                <Text style={[styles.mutedSmall, { marginBottom: 8 }]}>
                  Figures below match the selected date range.
                </Text>
              ) : null}
              <View style={styles.statGrid}>
                {[
                  {
                    label: "Total Revenue",
                    value: `₹${r.totalGrossRevenue.toLocaleString()}`,
                    sub: `${realPct.toFixed(0)}% real`,
                  },
                  {
                    label: "This month",
                    value: `₹${thisMonthVal.toLocaleString()}`,
                    sub:
                      chartYear === now.getFullYear()
                        ? CAL_SHORT[now.getMonth()]
                        : `${chartYear}`,
                  },
                  {
                    label: "Avg per event",
                    value: `₹${avgPerTrip.toLocaleString()}`,
                    sub: "in range",
                  },
                  {
                    label: "Participants",
                    value: totalBookings.toLocaleString(),
                    sub: "bookings",
                  },
                ].map((s) => (
                  <Card key={s.label} style={{ padding: 14, width: "48%" }}>
                    <Text style={styles.statVal}>{s.value}</Text>
                    <Text style={styles.mutedSmall}>{s.label}</Text>
                    <Text style={[styles.mutedSmall, { color: colors.emerald }]}>{s.sub}</Text>
                  </Card>
                ))}
              </View>

              <Card style={{ padding: 16, marginBottom: 12 }}>
                <Text style={styles.sectionTitle}>Monthly Overview</Text>
                <Text style={[styles.mutedSmall, { marginBottom: 8 }]}>
                  Paid bookings (₹) by month · {chartYear}
                </Text>
                <View style={styles.chartRow}>
                  {monthlyPaidChart.map((v, i) => {
                    const h = Math.max(8, Math.round((v / maxM) * 100));
                    return (
                      <View key={i} style={styles.chartCol}>
                        <View style={[styles.chartBar, { height: h }]} />
                        <Text style={styles.chartLbl}>{CAL_SHORT[i]}</Text>
                      </View>
                    );
                  })}
                </View>
              </Card>

              <Text style={[styles.sectionTitleCaps, { marginTop: 8 }]}>REVENUE BREAKDOWN</Text>
              <View style={styles.splitBar}>
                <View style={[styles.splitReal, { flex: Math.max(1, realPct) }]} />
                <View style={[styles.splitCoupon, { flex: Math.max(1, couponPct) }]} />
              </View>
              <Text style={styles.mutedSmall}>
                Real payments: ₹{r.realRevenue.toLocaleString()} ({realPct.toFixed(0)}%)
              </Text>
              <Text style={[styles.mutedSmall, { marginBottom: 8 }]}>
                Coupon-assisted: ₹{r.couponRevenue.toLocaleString()} ({couponPct.toFixed(0)}%)
              </Text>

              <Card style={{ padding: 12, marginBottom: 12 }}>
                <Text style={styles.cardTitle}>
                  💰 Real payments — ₹{r.realRevenue.toLocaleString()} · {r.realBookingCount} bookings
                </Text>
                <Text style={[styles.cardTitle, { marginTop: 8 }]}>
                  🎟️ Coupon payments — ₹{r.couponRevenue.toLocaleString()} · {r.couponBookingCount}{" "}
                  bookings
                </Text>
                <Text style={[styles.cardTitle, { marginTop: 8 }]}>
                  🆓 Free coupons — {r.freeCouponCount} bookings (₹{r.freeCouponValue.toLocaleString()}{" "}
                  face value, not paid)
                </Text>
              </Card>

              <View style={{ flexDirection: "row", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                {(["all", "real", "coupon", "free"] as const).map((f) => (
                  <Pressable
                    key={f}
                    onPress={() => setTxnFilter(f)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 10,
                      backgroundColor: txnFilter === f ? TEAL : "rgba(255,255,255,0.06)",
                    }}
                  >
                    <Text
                      style={{
                        color: txnFilter === f ? "#000" : colors.text,
                        fontWeight: "700",
                        textTransform: "capitalize",
                      }}
                    >
                      {f === "all" ? "All" : f}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.sectionTitleCaps}>Transactions</Text>
              <Card style={{ padding: 12, marginBottom: 12 }}>
                {filtered.length === 0 ? (
                  <Text style={styles.mutedSmall}>No transactions in this filter.</Text>
                ) : (
                  filtered.map((t) => {
                    const b = txnBadge(t);
                    return (
                      <View
                        key={t.bookingId}
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          marginBottom: 10,
                          paddingBottom: 10,
                          borderBottomWidth: 1,
                          borderBottomColor: colors.border,
                        }}
                      >
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <Text style={styles.cardTitle}>
                            {t.memberName} · {t.tripTitle}
                          </Text>
                          <Text style={{ color: colors.emerald, fontWeight: "800" }}>
                            ₹{Number(t.amountPaid ?? 0).toLocaleString()}
                          </Text>
                          <Text style={styles.mutedSmall}>
                            {t.paidAt ? String(t.paidAt).slice(0, 10) : "—"}
                          </Text>
                        </View>
                        <Badge variant={b.variant}>{b.label}</Badge>
                      </View>
                    );
                  })
                )}
              </Card>

              <Card style={{ padding: 16, marginBottom: 12 }}>
                <Text style={styles.sectionTitle}>Revenue by event</Text>
                {trips.length === 0 ? (
                  <Text style={styles.mutedSmall}>No paid events in this range.</Text>
                ) : (
                  trips.map((row) => (
                    <View key={row.tripId} style={{ marginBottom: 12 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={styles.cardTitle}>{row.tripTitle}</Text>
                        <Text style={styles.cardTitle}>₹{row.grossAmount.toLocaleString()}</Text>
                      </View>
                      <View style={styles.progressBg}>
                        <View
                          style={[
                            styles.progressFg,
                            {
                              width: `${Math.min(
                                100,
                                r.totalGrossRevenue > 0 ? (row.grossAmount / r.totalGrossRevenue) * 100 : 0,
                              )}%`,
                            },
                          ]}
                        />
                      </View>
                      <Text style={styles.mutedSmall}>{row.totalBookings} bookings</Text>
                    </View>
                  ))
                )}
              </Card>

              <Card style={{ padding: 14, marginBottom: 8, borderColor: colors.border }}>
                <Text style={styles.mutedSmall}>Platform fee (10%)</Text>
                <Text style={styles.statVal}>₹{r.platformFee.toLocaleString()}</Text>
              </Card>
            </>
          ) : (
            <Text style={styles.muted}>Could not load revenue for this range.</Text>
          )}
        </View>
      );
    }

    if (activeTab === "Coupons") {
      return (
        <View style={styles.tabBody}>
          {couponsFetchError ? (
            <Card style={{ padding: 12, marginBottom: 12, borderColor: "rgba(248,113,113,0.4)" }}>
              <Text style={{ color: colors.danger }}>{couponsFetchError}</Text>
            </Card>
          ) : null}
          <Card style={{ padding: 16, marginBottom: 16 }}>
            <Text style={styles.sectionTitle}>Generate New Coupon</Text>
            <View style={styles.fieldGrid}>
              <View style={styles.field}>
                <Text style={typography.label}>Code Prefix</Text>
                <TextInput
                  style={styles.input}
                  value={newCoupon.prefix}
                  onChangeText={(t) => setNewCoupon((p) => ({ ...p, prefix: t.toUpperCase() }))}
                />
              </View>
              <View style={styles.field}>
                <Text style={typography.label}>Discount %</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="number-pad"
                  value={String(newCoupon.discount)}
                  onChangeText={(t) =>
                    setNewCoupon((p) => ({ ...p, discount: Math.max(1, parseInt(t, 10) || 1) }))
                  }
                />
              </View>
              <View style={styles.field}>
                <Text style={typography.label}>Usage Limit</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="number-pad"
                  value={String(newCoupon.limit)}
                  onChangeText={(t) =>
                    setNewCoupon((p) => ({ ...p, limit: Math.max(1, parseInt(t, 10) || 1) }))
                  }
                />
              </View>
              <View style={styles.field}>
                <Text style={typography.label}>Expires</Text>
                <TextInput
                  style={styles.input}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.muted2}
                  value={newCoupon.expiry}
                  onChangeText={(t) => setNewCoupon((p) => ({ ...p, expiry: t }))}
                />
              </View>
            </View>
            {genCode ? (
              <Pressable
                onPress={() => Share.share({ message: genCode })}
                style={styles.codeBox}
              >
                <Text style={styles.codeText}>{genCode}</Text>
                <Text style={styles.mutedSmall}>Tap to share</Text>
              </Pressable>
            ) : null}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <OutlineButton
                title={genCode ? "Regenerate" : "Generate Code"}
                onPress={() => setGenCode(generateCouponCode(newCoupon.prefix))}
              />
              {genCode ? <PrimaryButton title="Save Coupon" onPress={() => void saveCoupon()} /> : null}
            </View>
          </Card>
          <Text style={typography.label}>All Coupons ({coupons.length})</Text>
          {coupons.map((c) => (
            <Card key={c.id} style={{ padding: 14, marginBottom: 8 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={styles.codeSmall}>{c.code}</Text>
                <Badge variant={c.active ? "success" : "default"}>{c.active ? "Active" : "Paused"}</Badge>
              </View>
              <Text style={styles.mutedSmall}>
                {c.discount}% off · {c.used}/{c.limit} used · {c.expiry}
              </Text>
            </Card>
          ))}
        </View>
      );
    }

    return null;
  };

  const showStats = activeTab !== "Revenue Analytics";

  return (
    <View style={styles.root}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#fff" />}
        contentContainerStyle={{ paddingBottom: 48 }}
      >
        <Pressable style={styles.tabSwitcher} onPress={() => setTabMenuOpen(true)}>
          <Text style={styles.tabSwitcherText}>≡  {activeTab}</Text>
          <Text style={styles.mutedSmall}>Change section</Text>
        </Pressable>

        {showStats ? (
          <View style={styles.statGrid}>
            {[
              { k: "Total Revenue", v: `₹${summary.totalRevenue.toLocaleString()}`, t: "live" },
              { k: "Participants", v: summary.participants.toLocaleString(), t: "live" },
              { k: "Events Hosted", v: String(summary.eventsHosted), t: `${summary.successRate}% success` },
              { k: "Active Coupons", v: String(summary.activeCoupons), t: `${summary.expiringCoupons} expiring` },
            ].map((s) => (
              <Card key={s.k} style={{ padding: 12, width: "48%" }}>
                <Text style={styles.mutedSmall}>{s.t}</Text>
                <Text style={styles.statVal}>{s.v}</Text>
                <Text style={typography.label}>{s.k}</Text>
              </Card>
            ))}
          </View>
        ) : null}

        <View style={styles.headerRow}>
          <View>
            <Text style={styles.h1}>{activeTab}</Text>
            <Text style={styles.muted}>Manage your {activeTab.toLowerCase()}</Text>
          </View>
          {activeTab === "Revenue Analytics" ? (
            <Pressable
              onPress={() => goStack("Payout")}
              style={styles.payoutBtn}
              hitSlop={8}
            >
              <Text style={styles.payoutBtnText}>Payout</Text>
            </Pressable>
          ) : (
            <OutlineButton title="+ New Event" onPress={openCreate} />
          )}
        </View>

        {renderTab()}
      </ScrollView>

      <Modal visible={customModalOpen} animationType="slide" transparent>
        <View style={styles.modalWrap}>
          <Pressable style={styles.modalOverlay} onPress={() => setCustomModalOpen(false)} />
          <View style={[styles.modalSheet, { paddingBottom: 28 }]}>
            <Text style={styles.sectionTitle}>Custom date range</Text>
            {Platform.OS === "ios" ? (
              <>
                <Text style={typography.label}>From</Text>
                <DateTimePicker
                  value={customFrom}
                  mode="date"
                  display="spinner"
                  themeVariant="dark"
                  onChange={(_, d) => {
                    if (d) setCustomFrom(d);
                  }}
                />
                <Text style={[typography.label, { marginTop: 12 }]}>To</Text>
                <DateTimePicker
                  value={customTo}
                  mode="date"
                  display="spinner"
                  themeVariant="dark"
                  onChange={(_, d) => {
                    if (d) setCustomTo(d);
                  }}
                />
              </>
            ) : (
              <>
                <Pressable style={styles.datePickRow} onPress={() => setAndroidPicker("from")}>
                  <Text style={styles.mutedSmall}>From</Text>
                  <Text style={styles.cardTitle}>{toLocalYmd(customFrom)}</Text>
                </Pressable>
                <Pressable style={styles.datePickRow} onPress={() => setAndroidPicker("to")}>
                  <Text style={styles.mutedSmall}>To</Text>
                  <Text style={styles.cardTitle}>{toLocalYmd(customTo)}</Text>
                </Pressable>
              </>
            )}
            <View style={{ flexDirection: "row", gap: 12, marginTop: 20 }}>
              <OutlineButton title="Cancel" onPress={() => setCustomModalOpen(false)} />
              <PrimaryButton
                title="Apply"
                onPress={() => {
                  setPeriodPreset("custom");
                  setCustomModalOpen(false);
                }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {Platform.OS === "android" && androidPicker ? (
        <DateTimePicker
          value={androidPicker === "from" ? customFrom : customTo}
          mode="date"
          display="default"
          onChange={(ev, date) => {
            if (ev.type === "dismissed") {
              setAndroidPicker(null);
              return;
            }
            if (date) {
              if (androidPicker === "from") setCustomFrom(date);
              else setCustomTo(date);
            }
            setAndroidPicker(null);
          }}
        />
      ) : null}

      <Modal visible={tabMenuOpen} animationType="slide" transparent>
        <View style={styles.modalWrap}>
          <Pressable style={styles.modalOverlay} onPress={() => setTabMenuOpen(false)} />
          <View style={styles.modalSheet}>
            <Text style={styles.sectionTitle}>Organizer menu</Text>
            {TABS.map((id) => (
              <Pressable
                key={id}
                style={[styles.tabRow, activeTab === id && styles.tabRowOn]}
                onPress={() => {
                  setTabMenuOpen(false);
                  setActiveTab(id);
                }}
              >
                <Text style={[styles.tabRowText, activeTab === id && styles.tabRowTextOn]}>{id}</Text>
              </Pressable>
            ))}
            <Pressable
              style={styles.tabRow}
              onPress={() => {
                setTabMenuOpen(false);
                openCreate();
              }}
            >
              <Text style={styles.tabRowText}>Create Event</Text>
            </Pressable>
            <Pressable
              style={styles.tabRow}
              onPress={() => {
                setTabMenuOpen(false);
                goStack("Payout");
              }}
            >
              <Text style={styles.tabRowText}>Payout</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  tabSwitcher: {
    margin: 16,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabSwitcherText: { color: colors.text, fontWeight: "800", fontSize: 15 },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 8,
    justifyContent: "space-between",
  },
  statVal: { color: colors.text, fontSize: 20, fontWeight: "800" },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 8,
  },
  payoutBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: "rgba(0,229,176,0.15)",
    borderWidth: 1,
    borderColor: TEAL,
  },
  payoutBtnText: { color: TEAL, fontWeight: "800", fontSize: 15 },
  h1: { ...typography.h1, color: colors.text },
  sectionTitle: { ...typography.h2, color: colors.text, marginBottom: 12 },
  muted: { color: colors.muted, fontSize: 14 },
  mutedSmall: { color: colors.muted, fontSize: 12, marginTop: 4 },
  tabBody: { paddingHorizontal: 16 },
  cardTitle: { color: colors.text, fontWeight: "700", fontSize: 16 },
  thumb: { width: 80, height: 80, borderRadius: 12 },
  thumbSm: { width: 56, height: 56, borderRadius: 10 },
  progressBg: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 4,
    marginTop: 8,
    overflow: "hidden",
  },
  progressFg: { height: "100%", backgroundColor: "rgba(255,255,255,0.5)" },
  chartRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: 120,
    gap: 4,
    marginTop: 12,
  },
  chartCol: { flex: 1, alignItems: "center" },
  chartBar: {
    width: "100%",
    backgroundColor: "rgba(255,255,255,0.25)",
    borderRadius: 4,
    minHeight: 8,
  },
  chartLbl: { fontSize: 8, color: colors.muted2, marginTop: 4 },
  splitBar: {
    flexDirection: "row",
    height: 12,
    borderRadius: 6,
    overflow: "hidden",
    marginBottom: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  splitReal: { backgroundColor: TEAL },
  splitCoupon: { backgroundColor: "rgba(0,229,176,0.35)" },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    color: colors.text,
    marginBottom: 12,
  },
  fieldGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  field: { width: "48%", marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 10,
    color: colors.text,
    marginTop: 6,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  codeBox: {
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 8,
  },
  codeText: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 2,
    color: colors.text,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  codeSmall: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", color: colors.text, fontWeight: "700" },
  modalWrap: { flex: 1, justifyContent: "flex-end" },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 36 : 20,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  tabRow: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabRowOn: { backgroundColor: colors.text, borderColor: colors.text },
  tabRowText: { color: colors.muted, fontWeight: "700" },
  tabRowTextOn: { color: colors.bg },
  rowBtns: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  btnOutlineSm: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnOutlineSmText: { color: colors.text, fontWeight: "700", fontSize: 13 },
  btnPrimarySm: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: colors.text,
  },
  btnPrimarySmText: { color: colors.bg, fontWeight: "800", fontSize: 13 },
  sectionTitleCaps: {
    marginTop: 8,
    marginBottom: 8,
    color: colors.muted2,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  periodChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  periodChipOn: {
    backgroundColor: "rgba(0,229,176,0.15)",
    borderColor: TEAL,
  },
  periodChipText: { color: colors.text, fontWeight: "700", fontSize: 13 },
  periodChipTextOn: { color: TEAL },
  datePickRow: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
  },
});
