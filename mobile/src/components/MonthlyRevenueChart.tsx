import React, { useMemo, useState } from "react";
import { View, Text, Pressable } from "react-native";

type MonthlyDataPoint = {
  month: number;
  monthName: string;
  totalAmount: number;
  bookingCount: number;
};

type Props = {
  data: MonthlyDataPoint[];
  year: number;
  onYearChange: (newYear: number) => void;
};

export function MonthlyRevenueChart({ data, year, onYearChange }: Props) {
  const maxAmount = Math.max(...data.map((d) => d.totalAmount), 1);
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const [selectedBar, setSelectedBar] = useState<number | null>(null);

  const CHART_HEIGHT = 160;
  const BAR_WIDTH = 18;
  const BAR_RADIUS = 4;

  const totalAmount = useMemo(() => data.reduce((s, d) => s + d.totalAmount, 0), [data]);
  const totalBookings = useMemo(() => data.reduce((s, d) => s + d.bookingCount, 0), [data]);
  const bestMonth = useMemo(
    () => data.reduce((best, d) => (d.totalAmount > best.totalAmount ? d : best), { totalAmount: 0, monthName: "—" } as MonthlyDataPoint),
    [data],
  );

  return (
    <View style={{ backgroundColor: "#1a1a1a", borderRadius: 16, padding: 20, marginBottom: 20 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700" }}>Monthly Overview</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Pressable onPress={() => onYearChange(year - 1)}>
            <Text style={{ color: "#00E5B0", fontSize: 18 }}>{"‹"}</Text>
          </Pressable>
          <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>{year}</Text>
          <Pressable onPress={() => onYearChange(year + 1)} disabled={year >= currentYear}>
            <Text style={{ color: year >= currentYear ? "rgba(255,255,255,0.2)" : "#00E5B0", fontSize: 18 }}>{"›"}</Text>
          </Pressable>
        </View>
      </View>

      <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, marginBottom: 20 }}>
        Paid bookings (₹) by month · {year}
      </Text>

      {selectedBar !== null && data[selectedBar]?.totalAmount > 0 && (
        <View
          style={{
            backgroundColor: "#00E5B0",
            borderRadius: 8,
            padding: 8,
            alignSelf: "center",
            marginBottom: 12,
            minWidth: 140,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#000", fontSize: 13, fontWeight: "700" }}>
            {data[selectedBar].monthName} {year}
          </Text>
          <Text style={{ color: "#000", fontSize: 15, fontWeight: "800" }}>
            ₹{data[selectedBar].totalAmount.toLocaleString("en-IN")}
          </Text>
          <Text style={{ color: "rgba(0,0,0,0.6)", fontSize: 11 }}>
            {data[selectedBar].bookingCount} booking{data[selectedBar].bookingCount !== 1 ? "s" : ""}
          </Text>
        </View>
      )}

      <View style={{ flexDirection: "row" }}>
        <View style={{ justifyContent: "space-between", height: CHART_HEIGHT, paddingRight: 8, alignItems: "flex-end" }}>
          {[1, 0.75, 0.5, 0.25, 0].map((ratio, i) => (
            <Text key={i} style={{ color: "rgba(255,255,255,0.25)", fontSize: 9 }}>
              {maxAmount === 1 ? "" : maxAmount * ratio >= 1000 ? `₹${((maxAmount * ratio) / 1000).toFixed(0)}k` : `₹${Math.round(maxAmount * ratio)}`}
            </Text>
          ))}
        </View>

        <View style={{ flex: 1 }}>
          <View style={{ position: "absolute", width: "100%", height: CHART_HEIGHT }}>
            {[0.25, 0.5, 0.75].map((ratio, i) => (
              <View
                key={i}
                style={{
                  position: "absolute",
                  top: CHART_HEIGHT * (1 - ratio),
                  width: "100%",
                  height: 0.5,
                  backgroundColor: "rgba(255,255,255,0.06)",
                }}
              />
            ))}
          </View>

          <View style={{ flexDirection: "row", alignItems: "flex-end", height: CHART_HEIGHT, justifyContent: "space-between" }}>
            {data.map((item, idx) => {
              const barHeight = Math.max(item.totalAmount > 0 ? (item.totalAmount / maxAmount) * (CHART_HEIGHT - 8) : 0, item.totalAmount > 0 ? 4 : 0);
              const isCurrentMonth = idx === currentMonth && year === currentYear;
              const isSelected = selectedBar === idx;
              const hasData = item.totalAmount > 0;
              return (
                <Pressable
                  key={idx}
                  onPress={() => setSelectedBar(isSelected ? null : idx)}
                  style={{ alignItems: "center", justifyContent: "flex-end", height: CHART_HEIGHT, width: BAR_WIDTH }}
                >
                  <View
                    style={{
                      width: BAR_WIDTH,
                      height: hasData ? barHeight : 3,
                      borderRadius: hasData ? BAR_RADIUS : 2,
                      backgroundColor: isSelected
                        ? "#fff"
                        : isCurrentMonth && hasData
                          ? "#00E5B0"
                          : hasData
                            ? "rgba(0,229,176,0.55)"
                            : "rgba(255,255,255,0.08)",
                    }}
                  />
                </Pressable>
              );
            })}
          </View>

          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
            {data.map((item, idx) => (
              <Text
                key={idx}
                style={{
                  color: idx === currentMonth && year === currentYear ? "#00E5B0" : "rgba(255,255,255,0.35)",
                  fontSize: 9,
                  width: BAR_WIDTH,
                  textAlign: "center",
                  fontWeight: idx === currentMonth ? "700" : "400",
                }}
              >
                {item.monthName}
              </Text>
            ))}
          </View>
        </View>
      </View>

      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          marginTop: 16,
          paddingTop: 16,
          borderTopWidth: 0.5,
          borderTopColor: "rgba(255,255,255,0.08)",
        }}
      >
        <View style={{ alignItems: "center" }}>
          <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>TOTAL {year}</Text>
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700", marginTop: 2 }}>₹{totalAmount.toLocaleString("en-IN")}</Text>
        </View>
        <View style={{ alignItems: "center" }}>
          <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>BOOKINGS</Text>
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700", marginTop: 2 }}>{totalBookings}</Text>
        </View>
        <View style={{ alignItems: "center" }}>
          <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>BEST MONTH</Text>
          <Text style={{ color: "#00E5B0", fontSize: 16, fontWeight: "700", marginTop: 2 }}>{bestMonth.monthName}</Text>
        </View>
      </View>
    </View>
  );
}

