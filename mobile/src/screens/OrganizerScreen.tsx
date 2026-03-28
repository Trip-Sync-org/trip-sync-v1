import React, { useCallback, useEffect, useState } from "react";
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
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { apiFetch, readApiErrorMessage } from "../api/client";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useAuth } from "../context/AuthContext";
import { colors, typography } from "../theme";
import { Card, Badge, PrimaryButton, OutlineButton } from "../components/ui";
import { parseDateOnlyLocal } from "../lib/tripNormalize";

const TABS = [
  "Today's Events",
  "Upcoming Events",
  "Create Event",
  "Manage Events",
  "Marketplace Listings",
  "Revenue Analytics",
  "Coupons",
  "Profile",
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
  const goStack = (route: keyof RootStackParamList, params?: RootStackParamList[keyof RootStackParamList]) => {
    const parent = navigation.getParent() as NativeStackNavigationProp<RootStackParamList> | undefined;
    if (parent) parent.navigate(route, params as never);
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
  const [revenueRows, setRevenueRows] = useState<
    { id: number; name: string; participants: number; revenue: number; perPerson: number }[]
  >([]);
  const [monthlyRevenue, setMonthlyRevenue] = useState<number[]>(() => Array.from({ length: 12 }, () => 0));
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [couponsFetchError, setCouponsFetchError] = useState<string | null>(null);
  const [profile, setProfile] = useState({
    name: user?.name ?? "",
    email: user?.email ?? "",
    phone: "",
    eventsHosted: 0,
    avgRating: null as number | null,
  });
  const [savingProfile, setSavingProfile] = useState(false);

  const [newCoupon, setNewCoupon] = useState({ prefix: "NOMAD", discount: 10, limit: 50, expiry: "" });
  const [genCode, setGenCode] = useState("");

  const [manageSearch, setManageSearch] = useState("");

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
      const [summaryRes, revenueRes, monthRes, couponRes, profileRes] = await Promise.all([
        apiFetch(`/api/organizers/${user.id}/dashboard-summary`),
        apiFetch(`/api/organizers/${user.id}/revenue-by-event`),
        apiFetch(`/api/organizers/${user.id}/monthly-revenue`),
        apiFetch(`/api/organizers/${user.id}/coupons`),
        apiFetch(`/api/organizers/${user.id}/profile`),
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
      if (revenueRes.ok) {
        const rows = await revenueRes.json();
        setRevenueRows(
          (rows || []).map((r: Record<string, unknown>) => ({
            id: Number(r.id),
            name: String(r.name || "Untitled"),
            participants: Number(r.participants || 0),
            revenue: Number(r.revenue || 0),
            perPerson: Number(r.perPerson || 0),
          })),
        );
      }
      if (monthRes.ok) {
        const rows = await monthRes.json();
        const arr = Array.from({ length: 12 }, () => 0);
        for (const row of rows || []) {
          const i = Number((row as { month?: number }).month);
          if (Number.isFinite(i) && i >= 0 && i < 12) {
            arr[i] = Number((row as { revenue?: number }).revenue || 0);
          }
        }
        setMonthlyRevenue(arr);
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
      if (profileRes.ok) {
        const p = await profileRes.json();
        setProfile({
          name: String(p.name || user?.name || ""),
          email: String(p.email || user?.email || ""),
          phone: String(p.phone || ""),
          eventsHosted: Number(p.events_hosted || 0),
          avgRating: Number.isFinite(Number(p.avg_rating)) ? Number(p.avg_rating) : null,
        });
      }
    } catch {
      /* keep partial state */
    }
  }, [user?.id, user?.name, user?.email]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadEvents(), loadSummary()]);
    setRefreshing(false);
  }, [loadEvents, loadSummary]);

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

  const saveProfile = async () => {
    if (!user?.id) return;
    try {
      setSavingProfile(true);
      const res = await apiFetch(`/api/organizers/${user.id}/profile`, {
        method: "PATCH",
        body: JSON.stringify({
          name: profile.name,
          email: profile.email,
          phone: profile.phone,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCouponsFetchError(String((body as { error?: string }).error || "Save failed"));
        return;
      }
      setProfile((p) => ({
        ...p,
        name: String((body as { name?: string }).name ?? p.name),
        email: String((body as { email?: string }).email ?? p.email),
        phone: String((body as { phone?: string }).phone ?? p.phone),
      }));
    } finally {
      setSavingProfile(false);
    }
  };

  const filteredManage = events.filter((t) =>
    manageSearch ? t.name.toLowerCase().includes(manageSearch.toLowerCase()) : true,
  );

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

    if (activeTab === "Create Event") {
      return (
        <View style={[styles.tabBody, { alignItems: "center", paddingVertical: 24 }]}>
          <Text style={{ fontSize: 48, marginBottom: 12 }}>✦</Text>
          <Text style={styles.sectionTitle}>Create a New Event</Text>
          <Text style={[styles.muted, { textAlign: "center", marginBottom: 20 }]}>
            Launch a public expedition or a private invite-only journey.
          </Text>
          <PrimaryButton title="Open Event Builder" onPress={openCreate} />
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
      const maxM = Math.max(...monthlyRevenue, 1);
      const thisMonth = monthlyRevenue[new Date().getMonth()] || 0;
      return (
        <View style={styles.tabBody}>
          <View style={styles.statGrid}>
            {[
              { label: "Total Revenue", value: `₹${summary.totalRevenue.toLocaleString()}`, sub: `${summary.successRate}% success` },
              { label: "This Month", value: `₹${thisMonth.toLocaleString()}`, sub: "live" },
              {
                label: "Avg per Event",
                value: `₹${Math.round(summary.eventsHosted ? summary.totalRevenue / summary.eventsHosted : 0).toLocaleString()}`,
                sub: "auto",
              },
              { label: "Participants", value: summary.participants.toLocaleString(), sub: "live" },
            ].map((s) => (
              <Card key={s.label} style={{ padding: 14, width: "48%" }}>
                <Text style={styles.statVal}>{s.value}</Text>
                <Text style={styles.mutedSmall}>{s.label}</Text>
                <Text style={[styles.mutedSmall, { color: colors.emerald }]}>{s.sub}</Text>
              </Card>
            ))}
          </View>
          <Card style={{ padding: 16, marginBottom: 12 }}>
            <Text style={styles.sectionTitle}>Revenue by Event</Text>
            {revenueRows.map((row) => (
              <View key={row.id} style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={styles.cardTitle}>{row.name}</Text>
                  <Text style={styles.cardTitle}>₹{row.revenue.toLocaleString()}</Text>
                </View>
                <View style={styles.progressBg}>
                  <View
                    style={[
                      styles.progressFg,
                      {
                        width: `${Math.min(100, summary.totalRevenue > 0 ? (row.revenue / summary.totalRevenue) * 100 : 0)}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.mutedSmall}>
                  {row.participants} participants · ₹{row.perPerson.toLocaleString()}/person
                </Text>
              </View>
            ))}
          </Card>
          <Card style={{ padding: 16 }}>
            <Text style={styles.sectionTitle}>Monthly Overview</Text>
            <View style={styles.chartRow}>
              {monthlyRevenue.map((v, i) => {
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

    if (activeTab === "Profile") {
      return (
        <View style={styles.tabBody}>
          <Card style={{ padding: 16, marginBottom: 12 }}>
            <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
              <Image
                source={{
                  uri: `https://api.dicebear.com/7.x/avataaars/png?seed=${encodeURIComponent(profile.name)}`,
                }}
                style={{ width: 72, height: 72, borderRadius: 16 }}
              />
              <View>
                <Text style={styles.cardTitle}>{profile.name}</Text>
                <Text style={styles.mutedSmall}>Verified Organizer</Text>
                <Text style={styles.mutedSmall}>
                  ★ {profile.avgRating ?? "—"} · {profile.eventsHosted} events hosted
                </Text>
              </View>
            </View>
          </Card>
          {(["name", "email", "phone"] as const).map((key) => (
            <View key={key} style={{ marginBottom: 10 }}>
              <Text style={typography.label}>{key}</Text>
              <TextInput
                style={styles.input}
                value={profile[key]}
                onChangeText={(t) => setProfile((p) => ({ ...p, [key]: t }))}
                autoCapitalize={key === "email" ? "none" : "words"}
                keyboardType={key === "email" ? "email-address" : "default"}
              />
            </View>
          ))}
          <PrimaryButton title={savingProfile ? "Saving…" : "Save Changes"} onPress={() => void saveProfile()} />
        </View>
      );
    }

    return null;
  };

  const showStats = activeTab !== "Create Event";

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
          <OutlineButton title="+ New Event" onPress={openCreate} />
        </View>

        {renderTab()}
      </ScrollView>

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
                  if (id === "Create Event") openCreate();
                  else setActiveTab(id);
                }}
              >
                <Text style={[styles.tabRowText, activeTab === id && styles.tabRowTextOn]}>{id}</Text>
              </Pressable>
            ))}
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
});
