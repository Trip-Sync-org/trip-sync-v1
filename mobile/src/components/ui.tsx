import React from "react";
import { View, Text, Pressable, StyleSheet, type ViewStyle, type TextStyle } from "react-native";
import { colors, typography } from "../theme";

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Badge({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "info";
}) {
  const bg: Record<typeof variant, string> = {
    default: "rgba(255,255,255,0.1)",
    success: "rgba(16,185,129,0.2)",
    warning: "rgba(245,158,11,0.2)",
    danger: "rgba(248,113,113,0.2)",
    info: "rgba(59,130,246,0.2)",
  };
  const fg: Record<typeof variant, string> = {
    default: "rgba(255,255,255,0.85)",
    success: "#34d399",
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
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.h1}>{title}</Text>
      {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
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
  return (
    <Pressable
      style={[styles.primaryBtn, disabled && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.primaryBtnText}>{title}</Text>
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
  return (
    <Pressable style={styles.outlineBtn} onPress={onPress}>
      <Text style={styles.outlineBtnText}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
  },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: { fontSize: 10, fontWeight: "700" },
  h1: {
    ...typography.h1,
    color: colors.text,
  },
  sub: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 4,
  },
  primaryBtn: {
    backgroundColor: colors.text,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 999,
    alignItems: "center",
  },
  primaryBtnText: {
    color: colors.bg,
    fontWeight: "700",
    fontSize: 15,
  },
  outlineBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: "center",
  },
  outlineBtnText: {
    color: colors.text,
    fontWeight: "600",
    fontSize: 14,
  },
});
