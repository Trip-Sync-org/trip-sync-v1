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

const THEMES = ["All", "Adventure", "Trekking", "Bike Ride", "Cultural", "Food Trail", "Night Ride", "Nature Escape", "Beach Trip"];
const SORTS = [
  { id: "trending", label: "Trending" },
  { id: "price-asc", label: "Price ↑" },
  { id: "price-desc", label: "Price ↓" },
] as const;

const CHIP_HEIGHT = 36;

export function ExploreScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useAppTheme();
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

  const s = useMemo(() => makeStyles(colors, insets.top), [colors, insets.top]);

  return (
    <View style={s.root}>
      <View style={s.hero}>
        <Text style={s.heroTitle}>Explore Expeditions</Text>
        <Text style={s.heroSub}>Find your next adventure from our curated marketplace</Text>
      </View>

      <View style={s.sortRowOuter}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.sortRowInner}
          style={s.chipScroll}
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
      </View>

      <View style={s.searchWrap}>
        <TextInput
          style={s.search}
          placeholder="Search trips, locations…"
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <View style={s.pillRowOuter}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.pillRowInner}
          style={s.chipScroll}
        >
          {THEMES.map((t) => (
            <Pressable
              key={t}
              style={[s.pill, (t === "All" ? theme === "" : theme === t) && s.pillOn]}
              onPress={() => setTheme(t === "All" ? "" : t)}
            >
              <Text style={[s.pillText, (t === "All" ? theme === "" : theme === t) && s.pillTextOn]}>
                {t}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <Text style={s.count}>{filtered.length} expeditions found</Text>

      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.text} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 100 }}
        ListEmptyComponent={
          !loading ? (
            <Text style={s.empty}>No trips found. Try adjusting search or theme.</Text>
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
              <Text style={s.title}>{item.name ?? "Trip"}</Text>
              <Text style={s.meta}>
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

const makeStyles = (colors: ReturnType<typeof useAppTheme>["colors"], topInset: number) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg, paddingTop: topInset },
    hero: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
    heroTitle: { ...typography.hero, color: colors.text, fontSize: 28, lineHeight: 34 },
    heroSub: { color: colors.muted, fontSize: 14, marginTop: 10 },
    chipScroll: { height: CHIP_HEIGHT },
    sortRowOuter: { paddingHorizontal: 16, marginBottom: 18 },
    sortRowInner: { gap: 8, flexDirection: "row", alignItems: "center", height: CHIP_HEIGHT },
    sortChip: {
      paddingHorizontal: 16,
      paddingVertical: 0,
      height: CHIP_HEIGHT,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      marginRight: 8,
      justifyContent: "center",
      alignItems: "center",
    },
    sortChipOn: { backgroundColor: colors.text, borderColor: colors.text },
    sortChipText: { color: colors.muted, fontWeight: "700", fontSize: 12 },
    sortChipTextOn: { color: colors.bg },
    searchWrap: { paddingHorizontal: 16, marginBottom: 16 },
    search: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: 14,
      color: colors.text,
      fontSize: 15,
      backgroundColor: colors.surface,
    },
    pillRowOuter: { paddingHorizontal: 16, marginBottom: 12 },
    pillRowInner: { gap: 8, flexDirection: "row", alignItems: "center", height: CHIP_HEIGHT },
    pill: {
      paddingHorizontal: 16,
      paddingVertical: 0,
      height: CHIP_HEIGHT,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      marginRight: 8,
      justifyContent: "center",
      alignItems: "center",
    },
    pillOn: { backgroundColor: colors.text, borderColor: colors.text },
    pillText: { color: colors.muted, fontWeight: "600", fontSize: 13 },
    pillTextOn: { color: colors.bg },
    count: { ...typography.label, paddingHorizontal: 16, marginBottom: 16, color: colors.muted },
    empty: { color: colors.muted, textAlign: "center", marginTop: 40 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      marginBottom: 16,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: colors.border,
    },
    banner: { width: "100%", height: 160, opacity: 0.88 },
    cardBody: { padding: 14 },
    badgeRow: { flexDirection: "row", gap: 6, marginBottom: 8, flexWrap: "wrap" },
    title: { color: colors.text, fontSize: 18, fontWeight: "800" },
    meta: { color: colors.muted, marginTop: 4, fontSize: 13 },
    price: { color: colors.muted, marginTop: 8, fontSize: 13 },
  });