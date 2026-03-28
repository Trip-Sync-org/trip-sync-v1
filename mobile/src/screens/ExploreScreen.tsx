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
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { apiFetch } from "../api/client";
import type { RootStackParamList } from "../navigation/AppNavigator";
import type { TripListItem } from "../types";
import { colors, typography } from "../theme";
import { Badge } from "../components/ui";

const THEMES = ["All", "Adventure", "Trekking", "Bike Ride", "Cultural", "Food Trail", "Night Ride", "Nature Escape", "Beach Trip"];
const SORTS = [
  { id: "trending", label: "Trending" },
  { id: "price-asc", label: "Price ↑" },
  { id: "price-desc", label: "Price ↓" },
] as const;

export function ExploreScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
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

  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Explore Expeditions</Text>
        <Text style={styles.heroSub}>Find your next adventure from our curated marketplace</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.sortRow}
      >
        {SORTS.map((s) => (
          <Pressable
            key={s.id}
            style={[styles.sortChip, sortBy === s.id && styles.sortChipOn]}
            onPress={() => setSortBy(s.id)}
          >
            <Text style={[styles.sortChipText, sortBy === s.id && styles.sortChipTextOn]}>{s.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          placeholder="Search trips, locations…"
          placeholderTextColor={colors.muted2}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
        {THEMES.map((t) => (
          <Pressable
            key={t}
            style={[styles.pill, (t === "All" ? theme === "" : theme === t) && styles.pillOn]}
            onPress={() => setTheme(t === "All" ? "" : t)}
          >
            <Text style={[styles.pillText, (t === "All" ? theme === "" : theme === t) && styles.pillTextOn]}>
              {t}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <Text style={styles.count}>{filtered.length} expeditions found</Text>

      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#fff" />}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.empty}>No trips found. Try adjusting search or theme.</Text>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => openTrip(item.id)}>
            <Image
              source={{
                uri: `https://picsum.photos/seed/trip-${item.id}/800/500`,
              }}
              style={styles.banner}
            />
            <View style={styles.cardBody}>
              <View style={styles.badgeRow}>
                {item.price != null && Number(item.price) <= 0 ? (
                  <Badge variant="success">FREE</Badge>
                ) : null}
                {item.theme ? <Badge variant="default">{item.theme}</Badge> : null}
              </View>
              <Text style={styles.title}>{item.name ?? "Trip"}</Text>
              <Text style={styles.meta}>
                {item.theme ?? "Adventure"} · {item.date ?? "TBA"}
              </Text>
              <Text style={styles.price}>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  hero: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  heroTitle: { ...typography.hero, color: colors.text, fontSize: 28, lineHeight: 34 },
  heroSub: { color: colors.muted, fontSize: 14, marginTop: 6 },
  searchWrap: { paddingHorizontal: 16, marginBottom: 8 },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    color: colors.text,
    fontSize: 15,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  sortRow: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  sortChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
  },
  sortChipOn: { backgroundColor: colors.text, borderColor: colors.text },
  sortChipText: { color: colors.muted, fontWeight: "700", fontSize: 12 },
  sortChipTextOn: { color: colors.bg },
  pillRow: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
  },
  pillOn: { backgroundColor: colors.text, borderColor: colors.text },
  pillText: { color: colors.muted, fontWeight: "600", fontSize: 13 },
  pillTextOn: { color: colors.bg },
  count: { ...typography.label, paddingHorizontal: 16, marginBottom: 4 },
  empty: { color: colors.muted, textAlign: "center", marginTop: 40 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    marginBottom: 14,
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
