import React, { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, Dimensions } from "react-native";
import { useAppTheme } from "../context/ThemeContext";

type Props = {
  data: Array<{ month: number; monthName: string; totalAmount: number; bookingCount: number }>;
  year: number;
  onYearChange: (y: number) => void;
};

const W = Dimensions.get("window").width - 64;
const BAR_H = 100;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function MonthlyRevenueChart({ data, year, onYearChange }: Props) {
  const { colors: c, mode } = useAppTheme();
  const isLight = mode === "light";
  const currentYear = new Date().getFullYear();
  const maxVal = Math.max(1, ...data.map((d) => d.totalAmount));

  const bestMonth = useMemo(() => {
    let best = data[0];
    for (const d of data) {
      if (d.totalAmount > (best?.totalAmount ?? 0)) best = d;
    }
    return best;
  }, [data]);

  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: c.muted }]}>MONTHLY REVENUE</Text>
        <View style={styles.yearNav}>
          <Pressable onPress={() => onYearChange(year - 1)} hitSlop={8}>
            <Text style={{ color: c.muted, fontSize: 18 }}>{"‹"}</Text>
          </Pressable>
          <Text style={[styles.yearLabel, { color: c.text }]}>{year}</Text>
          <Pressable onPress={() => onYearChange(Math.min(currentYear, year + 1))} hitSlop={8}>
            <Text style={{ color: year >= currentYear ? c.muted : c.text, fontSize: 18 }}>{"›"}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.chart}>
        {data.map((d) => {
          const pct = maxVal > 0 ? (d.totalAmount / maxVal) * 100 : 0;
          return (
            <View key={d.month} style={styles.barCol}>
              <Text style={[styles.barVal, { color: c.muted }]}>
                {d.totalAmount > 0 ? `₹${(d.totalAmount / 1000).toFixed(0)}k` : ""}
              </Text>
              <View style={[styles.barBg, { backgroundColor: c.border }]}>
                <View
                  style={[
                    styles.barFill,
                    {
                      height: `${Math.max(2, pct)}%`,
                      backgroundColor: d.month === (bestMonth?.month ?? -1) && d.totalAmount > 0 ? c.text : c.muted,
                    },
                  ]}
                />
              </View>
              <Text
                style={[
                  styles.barLabel,
                  { color: d.month === (bestMonth?.month ?? -1) && d.totalAmount > 0 ? c.text : c.muted },
                ]}
              >
                {d.monthName}
              </Text>
            </View>
          );
        })}
      </View>

      {bestMonth && bestMonth.totalAmount > 0 ? (
        <View style={styles.bestRow}>
          <Text style={[styles.bestLabel, { color: c.muted }]}>Best month</Text>
          <Text style={[styles.bestVal, { color: c.text }]}>
            {bestMonth.monthName} · ₹{bestMonth.totalAmount.toLocaleString()}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  title: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  yearNav: { flexDirection: "row", alignItems: "center", gap: 10 },
  yearLabel: { fontSize: 14, fontWeight: "700", minWidth: 44, textAlign: "center" },
  chart: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "flex-end",
    height: BAR_H + 30,
  },
  barCol: { alignItems: "center", flex: 1 },
  barVal: { fontSize: 7, fontWeight: "700", marginBottom: 4 },
  barBg: {
    width: "70%",
    maxWidth: 16,
    height: BAR_H,
    borderRadius: 4,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  barFill: {
    width: "100%",
    borderRadius: 4,
  },
  barLabel: { fontSize: 8, fontWeight: "700", marginTop: 4 },
  bestRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  bestLabel: { fontSize: 11, fontWeight: "700" },
  bestVal: { fontSize: 13, fontWeight: "700" },
});