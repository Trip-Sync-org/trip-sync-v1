import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Sun, Moon, Monitor } from "lucide-react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { ProfileLayout } from "../components/profile/ProfileLayout";
import { useAuthPalette } from "../theme/authTheme";
import { useAppTheme } from "../context/ThemeContext";
import type { ThemePreference } from "../context/ThemeContext";

type Props = NativeStackScreenProps<RootStackParamList, "Appearance">;

const OPTIONS: Array<{ key: ThemePreference; label: string; icon: React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }> }> = [
  { key: "light", label: "Light theme", icon: Sun },
  { key: "dark", label: "Dark theme", icon: Moon },
  { key: "system", label: "Use device theme", icon: Monitor },
];

export function AppearanceScreen({ navigation }: Props) {
  const c = useAuthPalette();
  const { themePreference, setThemePreference } = useAppTheme();

  const selectTheme = (pref: ThemePreference) => {
    void setThemePreference(pref);
  };

  return (
    <ProfileLayout navigation={navigation} title="Appearance" fallback="Main">
      <Text style={[styles.heading, { color: c.textPrimary }]}>Appearance</Text>
      <Text style={[styles.subtitle, { color: c.textSecondary }]}>
        Choose how the app looks — your preference is saved.
      </Text>

      <View style={[styles.card, { backgroundColor: c.bgCard, borderColor: c.borderDefault }]}>
        {OPTIONS.map((opt, index) => {
          const isSelected = themePreference === opt.key;
          const isLast = index === OPTIONS.length - 1;
          return (
            <Pressable
              key={opt.key}
              style={[
                styles.optionRow,
                !isLast && { borderBottomWidth: 1, borderBottomColor: c.borderDefault },
              ]}
              onPress={() => selectTheme(opt.key)}
            >
              <View style={styles.optionIcon}>
                {React.createElement(opt.icon, {
                  color: isSelected ? c.textPrimary : c.textSecondary,
                  size: 20,
                  strokeWidth: 2,
                })}
              </View>
              <Text style={[styles.optionLabel, { color: c.textPrimary }]}>
                {opt.label}
              </Text>
              <View
                style={[
                  styles.radioOuter,
                  { borderColor: isSelected ? c.textPrimary : c.textSecondary },
                ]}
              >
                {isSelected ? (
                  <View style={[styles.radioInner, { backgroundColor: c.textPrimary }]} />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.hint, { color: c.textSecondary }]}>
        {themePreference === "system"
          ? "Currently following your device's system theme setting."
          : themePreference === "light"
            ? "Light mode is active regardless of your device setting."
            : "Dark mode is active regardless of your device setting."}
      </Text>
    </ProfileLayout>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 26 / 1.54, fontWeight: "700", marginTop: 6 },
  subtitle: { fontSize: 14, marginTop: 8, lineHeight: 20, marginBottom: 14 },
  card: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  optionIcon: { width: 32, alignItems: "center", justifyContent: "center" },
  optionLabel: { flex: 1, fontSize: 15, fontWeight: "600", marginLeft: 12 },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  hint: { fontSize: 12, marginTop: 14, lineHeight: 18, textAlign: "center" },
});