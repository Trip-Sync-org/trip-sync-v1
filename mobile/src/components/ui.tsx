import React from "react";
import { View, Text, Pressable, StyleSheet, type ViewStyle, type TextStyle } from "react-native";
import { typography } from "../theme";
import { useAppTheme } from "../context/ThemeContext";

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const { colors } = useAppTheme();
  return <View style={[{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16 }, style]}>{children}</View>;
}

export function Badge({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "info";
}) {
  const { mode } = useAppTheme();
  const isLight = mode === "light";
  const bg: Record<typeof variant, string> = {
    default: isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.1)",
    success: isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.15)",
    warning: isLight ? "rgba(245,158,11,0.12)" : "rgba(245,158,11,0.2)",
    danger: isLight ? "rgba(248,113,113,0.12)" : "rgba(248,113,113,0.2)",
    info: isLight ? "rgba(59,130,246,0.12)" : "rgba(59,130,246,0.2)",
  };
  const fg: Record<typeof variant, string> = {
    default: isLight ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.85)",
    success: isLight ? "#000000" : "#ffffff",
    warning: "#fbbf24",
    danger: "#f87171",
    info: "#60a5fa",
  };
  return (
    <View style={[styles.badge, { backgroundColor: bg[variant] }]}>
      <Text style={[styles.badgeText, { color: fg[variant] }]}>{children}</Text>
    </View>
  );
}

export function ScreenTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={[styles.h1, { color: colors.text }]}>{title}</Text>
      {subtitle ? <Text style={[styles.sub, { color: colors.muted }]}>{subtitle}</Text> : null}
    </View>
  );
}

export function PrimaryButton({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      style={[{ backgroundColor: colors.text, paddingVertical: 14, paddingHorizontal: 20, borderRadius: 999, alignItems: "center" }, disabled && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[{ color: colors.bg, fontWeight: "700", fontSize: 15 }]}>{title}</Text>
    </Pressable>
  );
}

export function OutlineButton({
  title,
  onPress,
}: {
  title: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      style={{ borderWidth: 1, borderColor: colors.border, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 999, alignItems: "center" }}
      onPress={onPress}
    >
      <Text style={[{ color: colors.text, fontWeight: "600", fontSize: 14 }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: { fontSize: 10, fontWeight: "700" },
  h1: {
    ...typography.h1,
  },
  sub: {
    fontSize: 14,
    marginTop: 4,
  },
});