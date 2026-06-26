import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  RefreshControl,
  Image,
  TextInput,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { apiFetch } from "../api/client";
import type { RootStackParamList } from "../navigation/AppNavigator";
import type { TripListItem } from "../types";
import { typography } from "../theme";
import { Badge } from "../components/ui";
import { useAppTheme } from "../context/ThemeContext";
import type { ColorMode } from "../context/ThemeContext";

const THEMES = ["All", "Adventure", "Trekking", "Bike Ride", "Cultural", "Food Trail", "Night Ride", "Nature Escape", "Beach Trip"];
const SORTS = [
  { id: "trending", label: "Trending" },
  { id: "price-asc", label: "Price ↑" },
  { id: "price-desc", label: "Price ↓" },
] as const;

const CHIP_HEIGHT = 34;

type ThemeColors = ReturnType<typeof useAppTheme>["colors"];

export function ExploreScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors, mode } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [trips, setTrips] = useState<TripListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [theme, setTheme] = useState("");
  const [sortBy, setSortBy] = useState<(typeof SORTS)[number]["id"]>("trending");

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/trips");
      if (!res.ok) return;
      const data = await res.json();
      setTrips(Array.isArray(data) ? data : []);
    } catch {
      setTrips([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    let list = trips.filter((t) => {
      if (search) {
        const q = search.toLowerCase();
        if (!String(t.name || "").toLowerCase().includes(q)) return false;
      }
      if (theme && t.theme !== theme) return false;
      return true;
    });
    const sorted = [...list].sort((a, b) => {
      const pa = Number(a.price) || 0;
      const pb = Number(b.price) || 0;
      if (sortBy === "price-asc") return pa - pb;
      if (sortBy === "price-desc") return pb - pa;
      return Number(b.joined_count || 0) - Number(a.joined_count || 0);
    });
    return sorted;
  }, [trips, search, theme, sortBy]);

  const openTrip = (id: number) => {
    const parent = navigation.getParent();
    if (parent) parent.navigate("TripDetail", { id: String(id) });
  };

  const s = useMemo(() => makeStyles(colors, mode, insets.top), [colors, mode, insets.top]);

  return (
    <View style={s.root}>
      {/* Hero */}
      <View style={s.hero}>
        <Text style={s.heroTitle}>Explore Expeditions</Text>
        <Text style={s.heroSub}>Find your next adventure from our curated marketplace</Text>
      </View>

      {/* Search bar */}
      <View style={s.searchWrap}>
        <View style={s.searchRow}>
          <Text style={s.searchIcon}>🔍</Text>
          <TextInput
            style={s.search}
            placeholder="Search trips, locations…"
            placeholderTextColor={colors.muted}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <Pressable
              onPress={() => setSearch("")}
              style={s.clearBtn}
              hitSlop={8}
            >
              <Text style={s.clearBtnText}>✕</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Theme pills row */}
      <View style={s.pillRowOuter}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.pillRowInner}
        >
          {THEMES.map((t) => (
            <Pressable
              key={t}
              style={[s.pill, (t === "All" ? theme === "" : theme === t) && s.pillOn]}
              onPress={() => setTheme(t === "All" ? "" : t)}
            >
              <Text style={[s.pillText, (t === "All" ? theme === "" : theme === t) && s.pillTextOn]}>
                {t === "All" ? "🏷️ All" : t}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Sort chips + count row */}
      <View style={s.sortRowOuter}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.sortRowInner}
        >
          {SORTS.map((sort) => (
            <Pressable
              key={sort.id}
              style={[s.sortChip, sortBy === sort.id && s.sortChipOn]}
              onPress={() => setSortBy(sort.id)}
            >
              <Text style={[s.sortChipText, sortBy === sort.id && s.sortChipTextOn]}>{sort.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Text style={s.count}>{filtered.length} expeditions</Text>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.text} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 100 }}
        ListEmptyComponent={
          !loading ? (
            <View style={s.emptyWrap}>
              <Text style={s.emptyIcon}>🗺️</Text>
              <Text style={s.empty}>No trips found. Try adjusting search or theme.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable style={s.card} onPress={() => openTrip(item.id)}>
            <Image
              source={{
                uri: item.banner_url ?? `https://picsum.photos/seed/trip-${item.id}/800/500`,
              }}
              style={s.banner}
            />
            <View style={s.cardBody}>
              <View style={s.badgeRow}>
                {item.price != null && Number(item.price) <= 0 ? (
                  <Badge variant="success">FREE</Badge>
                ) : null}
                {item.theme ? <Badge variant="default">{item.theme}</Badge> : null}
              </View>
              <Text style={s.title} numberOfLines={1}>{item.name ?? "Trip"}</Text>
              <Text style={s.meta} numberOfLines={1}>
                {item.theme ?? "Adventure"} · {item.date ?? "TBA"}
              </Text>
              <Text style={s.price}>
                {item.price != null && Number(item.price) > 0
                  ? `₹${Number(item.price).toLocaleString()}`
                  : "Free"}{" "}
                · {item.joined_count ?? 0}/{item.max_participants ?? "—"} joined
              </Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors, mode: ColorMode, topInset: number) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg, paddingTop: topInset },
    hero: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
    heroTitle: { ...typography.hero, color: colors.text, fontSize: 28, lineHeight: 34 },
    heroSub: { color: colors.muted, fontSize: 14, marginTop: 10 },

    // Search
    searchWrap: { paddingHorizontal: 16, marginBottom: 12 },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1.5,
      borderColor: mode === "light" ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.2)",
      borderRadius: 16,
      backgroundColor: colors.surface,
      paddingLeft: 12,
    },
    searchIcon: { fontSize: 15, marginRight: 6, opacity: 0.6 },
    search: {
      flex: 1,
      paddingVertical: 14,
      paddingRight: 12,
      color: colors.text,
      fontSize: 15,
    },
    clearBtn: { paddingRight: 14, paddingVertical: 14 },
    clearBtnText: { color: colors.muted, fontSize: 14, fontWeight: "600" },

    // Theme pills
    pillRowOuter: { paddingHorizontal: 16, marginBottom: 10 },
    pillRowInner: {
      gap: 8,
      flexDirection: "row",
      alignItems: "center",
      height: CHIP_HEIGHT + 4,
      paddingVertical: 2,
    },
    pill: {
      paddingHorizontal: 16,
      height: CHIP_HEIGHT,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: mode === "light" ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.15)",
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: "transparent",
    },
    pillOn: {
      backgroundColor: colors.text,
      borderColor: colors.text,
    },
    pillText: { color: colors.muted, fontWeight: "600", fontSize: 13 },
    pillTextOn: { color: colors.bg, fontWeight: "700" },

    // Sort
    sortRowOuter: {
      paddingHorizontal: 16,
      marginBottom: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    sortRowInner: {
      gap: 8,
      flexDirection: "row",
      alignItems: "center",
      height: CHIP_HEIGHT,
    },
    sortChip: {
      paddingHorizontal: 16,
      height: CHIP_HEIGHT,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: mode === "light" ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.15)",
      justifyContent: "center",
      alignItems: "center",
    },
    sortChipOn: { backgroundColor: colors.text, borderColor: colors.text },
    sortChipText: { color: colors.muted, fontWeight: "700", fontSize: 12 },
    sortChipTextOn: { color: colors.bg },
    count: {
      ...typography.label,
      color: colors.muted,
      marginLeft: 12,
      flexShrink: 0,
    },

    // Empty state
    emptyWrap: { alignItems: "center", marginTop: 60 },
    emptyIcon: { fontSize: 40, marginBottom: 12, opacity: 0.5 },
    empty: { color: colors.muted, textAlign: "center", marginTop: 0, fontSize: 14, lineHeight: 20 },

    // Card
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      marginBottom: 16,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: mode === "light" ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)",
    },
    banner: { width: "100%", height: 180 },
    cardBody: { padding: 14 },
    badgeRow: { flexDirection: "row", gap: 6, marginBottom: 8, flexWrap: "wrap" },
    title: { color: colors.text, fontSize: 18, fontWeight: "800" },
    meta: { color: colors.muted, marginTop: 4, fontSize: 13 },
    price: { color: colors.muted, marginTop: 8, fontSize: 13 },
  });