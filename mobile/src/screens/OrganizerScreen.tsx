//path: mobile/src/screens/OrganizerScreen.tsx

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
import { Wallet, Ticket, BadgeCheck } from "lucide-react-native";
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
import { typography, useThemeColors } from "../theme";
import { Card, Badge, PrimaryButton, OutlineButton } from "../components/ui";
import { ConfirmModal } from "../components/ConfirmModal";
import { MonthlyRevenueChart } from "../components/MonthlyRevenueChart";
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
const TEAL = "#000000";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
  const c = useThemeColors();
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
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [monthlyData, setMonthlyData] = useState(
    Array.from({ length: 12 }, (_, i) => ({
      month: i,
      monthName: MONTHS[i],
      totalAmount: 0,
      bookingCount: 0,
    })),
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
    monthlyData?: Array<{
      month: number;
      monthName: string;
      totalAmount: number;
      bookingCount: number;
    }>;
    selectedYear?: number;
  };

  const [revenueDetail, setRevenueDetail] = useState<RevenueDetail | null>(null);
  const [txnFilter, setTxnFilter] = useState<"all" | "real" | "coupon" | "free">("all");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [revenueLoading, setRevenueLoading] = useState(false);

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

  const [pushCouponModal, setPushCouponModal] = useState<{
    visible: boolean;
    couponId: string;
    couponCode: string;
  }>({ visible: false, couponId: "", couponCode: "" });
  const [pushUserIds, setPushUserIds] = useState("");
  const [pushTripId, setPushTripId] = useState<number | undefined>(undefined);
  const [pushLoading, setPushLoading] = useState(false);

  const [alertState, setAlertState] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm?: () => void;
    singleButton?: boolean;
  } | null>(null);

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

  const loadOrganizerMoney = useCallback(async () => {
    if (!user?.id) return;
    setRevenueLoading(true);
    try {
      const rangeQs =
        activeRange != null
          ? `?from=${encodeURIComponent(activeRange.from)}&to=${encodeURIComponent(activeRange.to)}`
          : "";
      const yearQs = rangeQs ? `${rangeQs}&year=${selectedYear}` : `?year=${selectedYear}`;
      const rev = await apiFetch(
        `/api/organizer/revenue/${encodeURIComponent(String(user.id))}${yearQs}`,
      );
      if (rev.ok) {
        const j = (await rev.json()) as RevenueDetail;
        setRevenueDetail(j);
        const incoming = Array.isArray(j.monthlyData) ? j.monthlyData : [];
        const merged = MONTHS.map((monthName, month) => {
          const found = incoming.find((m) => Number(m.month) === month);
          return {
            month,
            monthName,
            totalAmount: found ? Number(found.totalAmount || 0) : 0,
            bookingCount: found ? Number(found.bookingCount || 0) : 0,
          };
        });
        setMonthlyData(merged);
      }
    } catch {
      /* ignore */
    } finally {
      setRevenueLoading(false);
    }
  }, [user?.id, activeRange, selectedYear]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const tasks = [loadEvents(), loadSummary(), loadOrganizerMoney()];
    await Promise.all(tasks);
    setRefreshing(false);
  }, [loadEvents, loadSummary, loadOrganizerMoney]);

  useEffect(() => {
    if (activeTab !== "Revenue Analytics") return;
    void loadOrganizerMoney();
  }, [activeTab, loadOrganizerMoney, selectedYear]);

  useEffect(() => {
    if (activeTab !== "Revenue Analytics") return;
    const id = setInterval(() => {
      void loadOrganizerMoney();
    }, 60000);
    return () => clearInterval(id);
  }, [activeTab, loadOrganizerMoney]);

  useOrganizerPaymentsSocket({
    userId: user?.id != null ? Number(user.id) : undefined,
    role: user?.activeRole,
    onPaymentConfirmed: () => {
      void loadOrganizerMoney();
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

  const s = useMemo(() => makeStyles(c), [c]);

  const renderTab = () => {
    if (activeTab === "Today's Events" || activeTab === "Upcoming Events") {
      const list = events.filter((t) =>
        activeTab === "Today's Events" ? t.scope === "today" : t.scope === "upcoming",
      );
      return (
        <View style={s.tabBody}>
          {eventsLoading ? (
            <Text style={s.muted}>Loading events…</Text>
          ) : list.length === 0 ? (
            <Card style={{ padding: 24 }}>
              <Text style={[s.muted, { textAlign: "center", marginBottom: 16 }]}>
                No events for this period
              </Text>
              <PrimaryButton title="+ Create an Event" onPress={openCreate} />
            </Card>
          ) : (
            list.map((trip) => (
              <Card key={trip.id} style={{ padding: 14, marginBottom: 12 }}>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <Image
                    source={{ uri: trip.banner.startsWith("http") ? trip.banner : `https://picsum.photos/seed/${trip.banner}/200/200` }}
                    style={s.thumb}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardTitle}>{trip.name}</Text>
                    <Text style={s.mutedSmall}>
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
                    <Text style={s.mutedSmall}>
                      {trip.joined}/{trip.max} joined · ₹{trip.revenue.toLocaleString()} earned
                    </Text>
                    <View style={s.rowBtns}>
                      <Pressable
                        style={s.btnOutlineSm}
                        onPress={() => goStack("LiveTrip", { id: String(trip.id) })}
                      >
                        <Text style={s.btnOutlineSmText}>Go Live</Text>
                      </Pressable>
                      <Pressable
                        style={s.btnPrimarySm}
                        onPress={() => goStack("TripDetail", { id: String(trip.id) })}
                      >
                        <Text style={s.btnPrimarySmText}>Details</Text>
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
        <View style={s.tabBody}>
          <TextInput
            style={s.search}
            placeholder="Search events…"
            placeholderTextColor={c.muted}
            value={manageSearch}
            onChangeText={setManageSearch}
          />
          {filteredManage.map((trip) => (
            <Card key={trip.id} style={{ padding: 14, marginBottom: 12 }}>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <Image
                  source={{ uri: trip.banner.startsWith("http") ? trip.banner : `https://picsum.photos/seed/${trip.banner}/200/200` }}
                  style={s.thumbSm}
                />
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle}>{trip.name}</Text>
                  <Text style={s.mutedSmall}>
                    {trip.date} · {trip.joined}/{trip.max} participants
                  </Text>
                  <View style={s.progressBg}>
                    <View
                      style={[
                        s.progressFg,
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
        <View style={s.tabBody}>
          {pub.length === 0 ? (
            <Text style={s.muted}>No public listings yet.</Text>
          ) : (
            pub.map((trip) => (
              <Card key={trip.id} style={{ padding: 14, marginBottom: 12 }}>
                <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                  <Image
                    source={{ uri: trip.banner.startsWith("http") ? trip.banner : `https://picsum.photos/seed/${trip.banner}/200/200` }}
                    style={s.thumbSm}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardTitle}>{trip.name}</Text>
                    <Text style={s.mutedSmall}>
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
      const now = new Date();
      const thisMonthVal =
        selectedYear === now.getFullYear() ? monthlyData[now.getMonth()]?.totalAmount || 0 : 0;
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
        <View style={s.tabBody}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <Text style={s.sectionTitleCaps}>Revenue</Text>
            <Pressable onPress={() => void exportRevenuePdf()} disabled={pdfBusy || !r}>
              <Text style={{ color: c.text, fontWeight: "700" }}>{pdfBusy ? "…" : "↑ Export PDF"}</Text>
            </Pressable>
          </View>

          <Text style={[s.mutedSmall, { marginBottom: 8 }]}>
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
                  style={[s.periodChip, on && s.periodChipOn]}
                >
                  <Text style={[s.periodChipText, on && s.periodChipTextOn]}>
                    {p === "all"
                      ? "All time"
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

          {revenueLoading ? (
            <Card style={{ padding: 24, alignItems: "center" }}>
              <ActivityIndicator color={c.text} />
              <Text style={[s.mutedSmall, { marginTop: 12 }]}>Loading revenue…</Text>
            </Card>
          ) : r ? (
            <>
              <Text style={[s.sectionTitle, { marginTop: 0 }]}>Dashboard summary</Text>
              {periodFiltered ? (
                <Text style={[s.mutedSmall, { marginBottom: 8 }]}>
                  Figures below match the selected date range.
                </Text>
              ) : null}
              <View style={s.statGrid}>
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
                      selectedYear === now.getFullYear()
                        ? CAL_SHORT[now.getMonth()]
                        : `${selectedYear}`,
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
                ].map((stat) => (
                  <Card key={stat.label} style={{ padding: 14, width: "48%" }}>
                    <Text style={s.statVal}>{stat.value}</Text>
                    <Text style={s.mutedSmall}>{stat.label}</Text>
                    <Text style={[s.mutedSmall, { color: c.muted }]}>{stat.sub}</Text>
                  </Card>
                ))}
              </View>

              <MonthlyRevenueChart data={monthlyData} year={selectedYear} onYearChange={setSelectedYear} />

              <Text style={[s.sectionTitleCaps, { marginTop: 8 }]}>REVENUE BREAKDOWN</Text>
              <View style={s.splitBar}>
                <View style={[s.splitReal, { flex: Math.max(1, realPct) }]} />
                <View style={[s.splitCoupon, { flex: Math.max(1, couponPct) }]} />
              </View>
              <Text style={s.mutedSmall}>
                Real payments: ₹{r.realRevenue.toLocaleString()} ({realPct.toFixed(0)}%)
              </Text>
              <Text style={[s.mutedSmall, { marginBottom: 8 }]}>
                Coupon-assisted: ₹{r.couponRevenue.toLocaleString()} ({couponPct.toFixed(0)}%)
              </Text>

              <Card style={{ padding: 12, marginBottom: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
                  <Wallet color={c.text} size={16} strokeWidth={2} style={{ marginRight: 6 }} />
                  <Text style={s.cardTitle}>
                    Real payments — ₹{r.realRevenue.toLocaleString()} · {r.realBookingCount} bookings
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                  <Ticket color={c.text} size={16} strokeWidth={2} style={{ marginRight: 6 }} />
                  <Text style={[s.cardTitle]}>
                    Coupon payments — ₹{r.couponRevenue.toLocaleString()} · {r.couponBookingCount}{" "}
                    bookings
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                  <BadgeCheck color={c.text} size={16} strokeWidth={2} style={{ marginRight: 6 }} />
                  <Text style={[s.cardTitle]}>
                    Free coupons — {r.freeCouponCount} bookings (₹{r.freeCouponValue.toLocaleString()}{" "}
                    face value, not paid)
                  </Text>
                </View>
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
                        backgroundColor: txnFilter === f ? c.text : c.surface,
                        borderWidth: 1,
                        borderColor: c.border,
                      }}
                    >
                      <Text
                        style={{
                          color: txnFilter === f ? c.bg : c.text,
                          fontWeight: "700",
                          textTransform: "capitalize",
                        }}
                      >
                        {f === "all" ? "All" : f}
                      </Text>
                    </Pressable>
                  ))}
              </View>

              <Text style={s.sectionTitleCaps}>Transactions</Text>
              <Card style={{ padding: 12, marginBottom: 12 }}>
                {filtered.length === 0 ? (
                  <Text style={s.mutedSmall}>No transactions in this filter.</Text>
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
                          borderBottomColor: c.border,
                        }}
                      >
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <Text style={s.cardTitle}>
                            {t.memberName} · {t.tripTitle}
                          </Text>
                          <Text style={{ color: c.text, fontWeight: "800" }}>
                            ₹{Number(t.amountPaid ?? 0).toLocaleString()}
                          </Text>
                          <Text style={s.mutedSmall}>
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
                <Text style={s.sectionTitle}>Revenue by event</Text>
                {trips.length === 0 ? (
                  <Text style={s.mutedSmall}>No paid events in this range.</Text>
                ) : (
                  trips.map((row) => (
                    <View key={row.tripId} style={{ marginBottom: 12 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={s.cardTitle}>{row.tripTitle}</Text>
                        <Text style={s.cardTitle}>₹{row.grossAmount.toLocaleString()}</Text>
                      </View>
                      <View style={s.progressBg}>
                        <View
                          style={[
                            s.progressFg,
                            {
                              width: `${Math.min(
                                100,
                                r.totalGrossRevenue > 0 ? (row.grossAmount / r.totalGrossRevenue) * 100 : 0,
                              )}%`,
                            },
                          ]}
                        />
                      </View>
                      <Text style={s.mutedSmall}>{row.totalBookings} bookings</Text>
                    </View>
                  ))
                )}
              </Card>

              <Card style={{ padding: 14, marginBottom: 8, borderColor: c.border }}>
                <Text style={s.mutedSmall}>Platform fee (10%)</Text>
                <Text style={s.statVal}>₹{r.platformFee.toLocaleString()}</Text>
              </Card>
            </>
          ) : (
            <Text style={s.muted}>Could not load revenue for this range.</Text>
          )}
        </View>
      );
    }

    if (activeTab === "Coupons") {
      const activeCount = coupons.filter((c) => c.active).length;
      const pausedCount = coupons.filter((c) => !c.active).length;
      const totalUsed = coupons.reduce((sum, c) => sum + c.used, 0);

      return (
        <View style={s.tabBody}>
          {couponsFetchError ? (
            <Card style={{ padding: 12, marginBottom: 12, borderColor: "rgba(248,113,113,0.4)" }}>
              <Text style={{ color: c.danger }}>{couponsFetchError}</Text>
            </Card>
          ) : null}

          {/* Stats Row */}
          <View style={s.statGrid}>
            <Card style={{ padding: 10, width: "48%" }}>
              <Text style={s.statVal}>{activeCount}</Text>
              <Text style={s.mutedSmall}>Active</Text>
            </Card>
            <Card style={{ padding: 10, width: "48%" }}>
              <Text style={s.statVal}>{pausedCount}</Text>
              <Text style={s.mutedSmall}>Paused</Text>
            </Card>
            <Card style={{ padding: 10, width: "48%" }}>
              <Text style={s.statVal}>{totalUsed}</Text>
              <Text style={s.mutedSmall}>Total Used</Text>
            </Card>
            <Card style={{ padding: 10, width: "48%" }}>
              <Text style={s.statVal}>{coupons.length}</Text>
              <Text style={s.mutedSmall}>Total Coupons</Text>
            </Card>
          </View>

          {/* Generate Coupon Form */}
          <Card style={{ padding: 16, marginBottom: 16 }}>
            <Text style={s.sectionTitle}>Generate New Coupon</Text>
            <View style={s.fieldGrid}>
              <View style={s.field}>
                <Text style={typography.label}>Code Prefix</Text>
                <TextInput
                  style={s.input}
                  value={newCoupon.prefix}
                  onChangeText={(t) => setNewCoupon((p) => ({ ...p, prefix: t.toUpperCase() }))}
                />
              </View>
              <View style={s.field}>
                <Text style={typography.label}>Discount %</Text>
                <TextInput
                  style={s.input}
                  keyboardType="number-pad"
                  value={String(newCoupon.discount)}
                  onChangeText={(t) =>
                    setNewCoupon((p) => ({ ...p, discount: Math.max(1, parseInt(t, 10) || 1) }))
                  }
                />
              </View>
              <View style={s.field}>
                <Text style={typography.label}>Usage Limit</Text>
                <TextInput
                  style={s.input}
                  keyboardType="number-pad"
                  value={String(newCoupon.limit)}
                  onChangeText={(t) =>
                    setNewCoupon((p) => ({ ...p, limit: Math.max(1, parseInt(t, 10) || 1) }))
                  }
                />
              </View>
              <View style={s.field}>
                <Text style={typography.label}>Expires</Text>
                <TextInput
                  style={s.input}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={c.muted}
                  value={newCoupon.expiry}
                  onChangeText={(t) => setNewCoupon((p) => ({ ...p, expiry: t }))}
                />
              </View>
            </View>
            {genCode ? (
              <Pressable
                onPress={() => Share.share({ message: genCode })}
                style={s.codeBox}
              >
                <Text style={s.codeText}>{genCode}</Text>
                <Text style={s.mutedSmall}>Tap to share</Text>
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

          {/* Coupon List */}
          <Text style={typography.label}>All Coupons ({coupons.length})</Text>
          {coupons.map((couponItem) => (
            <Card key={couponItem.id} style={{ padding: 14, marginBottom: 8 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={s.codeSmall}>{couponItem.code}</Text>
                    <Badge variant={couponItem.active ? "success" : "default"}>
                      {couponItem.active ? "Active ●" : "Paused"}
                    </Badge>
                  </View>
                  <Text style={s.mutedSmall}>
                    {couponItem.discount}% off · {couponItem.used}/{couponItem.limit} used · {couponItem.expiry}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <Pressable
                  style={s.btnOutlineSm}
                  onPress={async () => {
                    if (!user?.id) return;
                    const res = await apiFetch(`/api/organizers/${user.id}/coupons/${couponItem.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ active: !couponItem.active }),
                    });
                    if (res.ok) {
                      setCoupons((prev) =>
                        prev.map((x) => (x.id === couponItem.id ? { ...x, active: !x.active } : x)),
                      );
                    }
                  }}
                >
                  <Text style={s.btnOutlineSmText}>{couponItem.active ? "Pause" : "Resume"}</Text>
                </Pressable>
                <Pressable
                  style={s.btnOutlineSm}
                  onPress={() => {
                    setPushCouponModal({ visible: true, couponId: couponItem.id, couponCode: couponItem.code });
                  }}
                >
                  <Text style={s.btnOutlineSmText}>Push to Users</Text>
                </Pressable>
                <Pressable
                  style={[s.btnOutlineSm, { borderColor: c.danger }]}
                  onPress={() => {
                    setAlertState({
                      title: "Delete Coupon",
                      message: `Delete ${couponItem.code}? This cannot be undone.`,
                      confirmLabel: "Delete",
                      singleButton: false,
                      onConfirm: async () => {
                        if (!user?.id) return;
                        await apiFetch(`/api/organizers/${user.id}/coupons/${couponItem.id}`, { method: "DELETE" });
                        setCoupons((prev) => prev.filter((x) => x.id !== couponItem.id));
                        setAlertState(null);
                      },
                    });
                  }}
                >
                  <Text style={[s.btnOutlineSmText, { color: c.danger }]}>Delete</Text>
                </Pressable>
              </View>
            </Card>
          ))}
        </View>
      );
    }

    return null;
  };

  const showStats = activeTab !== "Revenue Analytics";

  return (
    <View style={s.root}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.text} />}
        contentContainerStyle={{ paddingBottom: 100, flexGrow: 1 }}
      >
        <Pressable style={s.tabSwitcher} onPress={() => setTabMenuOpen(true)}>
          <Text style={s.tabSwitcherText}>≡  {activeTab}</Text>
          <Text style={s.mutedSmall}>Change section</Text>
        </Pressable>

        {showStats ? (
          <View style={s.statGrid}>
            {[
              { k: "Total Revenue", v: `₹${summary.totalRevenue.toLocaleString()}`, t: "live" },
              { k: "Participants", v: summary.participants.toLocaleString(), t: "live" },
              { k: "Events Hosted", v: String(summary.eventsHosted), t: `${summary.successRate}% success` },
              { k: "Active Coupons", v: String(summary.activeCoupons), t: `${summary.expiringCoupons} expiring` },
            ].map((stat) => (
              <Card key={stat.k} style={{ padding: 12, width: "48%" }}>
                <Text style={s.mutedSmall}>{stat.t}</Text>
                <Text style={s.statVal}>{stat.v}</Text>
                <Text style={typography.label}>{stat.k}</Text>
              </Card>
            ))}
          </View>
        ) : null}

        <View style={s.headerRow}>
          <View>
            <Text style={s.h1}>{activeTab}</Text>
            <Text style={s.muted}>Manage your {activeTab.toLowerCase()}</Text>
          </View>
          {activeTab === "Revenue Analytics" ? (
            <Pressable
              onPress={() => goStack("Payout")}
              style={s.payoutBtn}
              hitSlop={8}
            >
              <Text style={s.payoutBtnText}>Payout</Text>
            </Pressable>
          ) : (
            <OutlineButton title="+ New Event" onPress={openCreate} />
          )}
        </View>

        {renderTab()}
      </ScrollView>

      <Modal visible={customModalOpen} animationType="slide" transparent>
        <View style={s.modalWrap}>
          <Pressable style={s.modalOverlay} onPress={() => setCustomModalOpen(false)} />
          <View style={[s.modalSheet, { paddingBottom: 28 }]}>
            <Text style={s.sectionTitle}>Custom date range</Text>
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
                <Pressable style={s.datePickRow} onPress={() => setAndroidPicker("from")}>
                  <Text style={s.mutedSmall}>From</Text>
                  <Text style={s.cardTitle}>{toLocalYmd(customFrom)}</Text>
                </Pressable>
                <Pressable style={s.datePickRow} onPress={() => setAndroidPicker("to")}>
                  <Text style={s.mutedSmall}>To</Text>
                  <Text style={s.cardTitle}>{toLocalYmd(customTo)}</Text>
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

      {/* Push Coupon Modal */}
      <Modal visible={pushCouponModal.visible} animationType="slide" transparent>
        <View style={s.modalWrap}>
          <Pressable style={s.modalOverlay} onPress={() => setPushCouponModal({ visible: false, couponId: "", couponCode: "" })} />
          <View style={[s.modalSheet, { paddingBottom: 28 }]}>
            <Text style={s.sectionTitle}>Push Coupon: {pushCouponModal.couponCode}</Text>
            <View style={{ marginBottom: 12 }}>
              <Text style={typography.label}>User IDs / Emails</Text>
              <TextInput
                style={s.input}
                placeholder="Comma-separated user IDs or emails"
                placeholderTextColor={c.muted}
                value={pushUserIds}
                onChangeText={setPushUserIds}
                multiline
              />
            </View>
            <View style={{ flexDirection: "row", gap: 12, marginTop: 20 }}>
              <OutlineButton
                title="Cancel"
                onPress={() => {
                  setPushCouponModal({ visible: false, couponId: "", couponCode: "" });
                  setPushUserIds("");
                }}
              />
              <PrimaryButton
                title={pushLoading ? "Pushing..." : "Push Coupon →"}
                disabled={pushLoading || !pushUserIds.trim()}
                onPress={async () => {
                  if (!user?.id || !pushCouponModal.couponId) return;
                  setPushLoading(true);
                  try {
                    const userIds = pushUserIds.split(",").map((s) => s.trim()).filter(Boolean);
                    const res = await apiFetch(`/api/organizers/${user.id}/coupons/${pushCouponModal.couponId}/push`, {
                      method: "POST",
                      body: JSON.stringify({
                        user_ids: userIds,
                        trip_id: pushTripId || undefined,
                      }),
                    });
                    if (res.ok) {
                      const body = await res.json();
                      setAlertState({
                        title: "Success",
                        message: `Pushed to ${body.pushed} users`,
                        singleButton: true,
                      });
                      setPushCouponModal({ visible: false, couponId: "", couponCode: "" });
                      setPushUserIds("");
                    } else {
                      const msg = await readApiErrorMessage(res);
                      setAlertState({ title: "Error", message: msg, singleButton: true });
                    }
                  } catch {
                    setAlertState({ title: "Error", message: "Could not reach server.", singleButton: true });
                  } finally {
                    setPushLoading(false);
                  }
                }}
              />
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmModal
        visible={alertState !== null}
        onClose={() => { if (alertState?.singleButton !== false) setAlertState(null); }}
        onConfirm={() => {
          if (alertState?.onConfirm) alertState.onConfirm();
          setAlertState(null);
        }}
        title={alertState?.title ?? ""}
        message={alertState?.message ?? ""}
        confirmLabel={alertState?.confirmLabel}
        singleButton={alertState?.singleButton ?? true}
      />

      <Modal visible={tabMenuOpen} animationType="slide" transparent>
        <View style={s.modalWrap}>
          <Pressable style={s.modalOverlay} onPress={() => setTabMenuOpen(false)} />
          <View style={s.modalSheet}>
            <Text style={s.sectionTitle}>Organizer menu</Text>
            {TABS.map((id) => (
              <Pressable
                key={id}
                style={[s.tabRow, activeTab === id && s.tabRowOn]}
                onPress={() => {
                  setTabMenuOpen(false);
                  setActiveTab(id);
                }}
              >
                <Text style={[s.tabRowText, activeTab === id && s.tabRowTextOn]}>{id}</Text>
              </Pressable>
            ))}
            <Pressable
              style={s.tabRow}
              onPress={() => {
                setTabMenuOpen(false);
                openCreate();
              }}
            >
              <Text style={s.tabRowText}>Create Event</Text>
            </Pressable>
            <Pressable
              style={s.tabRow}
              onPress={() => {
                setTabMenuOpen(false);
                goStack("Payout");
              }}
            >
              <Text style={s.tabRowText}>Payout</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    tabSwitcher: {
      margin: 16,
      padding: 14,
      borderRadius: 16,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    tabSwitcherText: { color: c.text, fontWeight: "800", fontSize: 15 },
    statGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      paddingHorizontal: 16,
      marginBottom: 8,
      justifyContent: "space-between",
    },
    statVal: { color: c.text, fontSize: 20, fontWeight: "800" },
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
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.text,
    },
    payoutBtnText: { color: c.text, fontWeight: "800", fontSize: 15 },
    h1: { ...typography.h1, color: c.text },
    sectionTitle: { ...typography.h2, color: c.text, marginBottom: 12 },
    muted: { color: c.muted, fontSize: 14 },
    mutedSmall: { color: c.muted, fontSize: 12, marginTop: 4 },
    tabBody: { paddingHorizontal: 16 },
    cardTitle: { color: c.text, fontWeight: "700", fontSize: 16 },
    thumb: { width: 80, height: 80, borderRadius: 12 },
    thumbSm: { width: 56, height: 56, borderRadius: 10 },
    progressBg: {
      height: 4,
      backgroundColor: c.border,
      borderRadius: 4,
      marginTop: 8,
      overflow: "hidden",
    },
    progressFg: { height: "100%", backgroundColor: c.text },
    search: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      padding: 12,
      color: c.text,
      marginBottom: 12,
    },
    fieldGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    field: { width: "48%", marginBottom: 8 },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      padding: 10,
      color: c.text,
      marginTop: 6,
      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    },
    codeBox: {
      padding: 14,
      backgroundColor: c.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      marginTop: 8,
    },
    codeText: {
      fontSize: 20,
      fontWeight: "800",
      letterSpacing: 2,
      color: c.text,
      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    },
    codeSmall: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", color: c.text, fontWeight: "700" },
    modalWrap: { flex: 1, justifyContent: "flex-end" },
    modalOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.7)",
    },
    modalSheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 20,
      paddingBottom: Platform.OS === "ios" ? 36 : 20,
      borderTopWidth: 1,
      borderColor: c.border,
    },
    tabRow: {
      paddingVertical: 14,
      paddingHorizontal: 12,
      borderRadius: 14,
      marginBottom: 6,
      borderWidth: 1,
      borderColor: c.border,
    },
    tabRowOn: { backgroundColor: c.text, borderColor: c.text },
    tabRowText: { color: c.muted, fontWeight: "700" },
    tabRowTextOn: { color: c.bg },
    rowBtns: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
    btnOutlineSm: {
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: c.border,
    },
    btnOutlineSmText: { color: c.text, fontWeight: "700", fontSize: 13 },
    btnPrimarySm: {
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 999,
      backgroundColor: c.text,
    },
    btnPrimarySmText: { color: c.bg, fontWeight: "800", fontSize: 13 },
    sectionTitleCaps: {
      marginTop: 8,
      marginBottom: 8,
      color: c.muted,
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 1.2,
    },
    splitBar: {
      flexDirection: "row",
      height: 12,
      borderRadius: 6,
      overflow: "hidden",
      marginBottom: 8,
      backgroundColor: c.surface,
    },
    splitReal: { backgroundColor: c.text },
    splitCoupon: { backgroundColor: c.muted },
    periodChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
    },
    periodChipOn: {
      backgroundColor: c.text,
      borderColor: c.text,
    },
    periodChipText: { color: c.text, fontWeight: "700", fontSize: 13 },
    periodChipTextOn: { color: c.bg },
    datePickRow: {
      padding: 14,
      borderRadius: 12,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      marginBottom: 10,
    },
  });