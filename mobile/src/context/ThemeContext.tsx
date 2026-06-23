import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, useRef } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ColorMode = "dark" | "light";

export type ThemePreference = "light" | "dark" | "system";

type ThemeColors = {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  card: string;
};

const dark: ThemeColors = {
  bg: "#000000",
  surface: "#0d0d0d",
  text: "#ffffff",
  muted: "rgba(255,255,255,0.45)",
  border: "rgba(255,255,255,0.1)",
  card: "rgba(255,255,255,0.04)",
};

const light: ThemeColors = {
  bg: "#f4f4f5",
  surface: "#ffffff",
  text: "#0a0a0a",
  muted: "rgba(0,0,0,0.55)",
  border: "rgba(0,0,0,0.08)",
  card: "rgba(0,0,0,0.03)",
};

const PREF_KEY = "tripsync_theme_preference";

type ThemeContextValue = {
  mode: ColorMode;
  colors: ThemeColors;
  toggleMode: () => void;
  setMode: (m: ColorMode) => void;
  themePreference: ThemePreference;
  setThemePreference: (pref: ThemePreference) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const systemMode: ColorMode = systemScheme === "dark" ? "dark" : "light";

  const [themePreference, setThemePreferenceState] = useState<ThemePreference>("system");
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);

  // Load preference from AsyncStorage on mount
  useEffect(() => {
    AsyncStorage.getItem(PREF_KEY).then((val) => {
      if (val === "light" || val === "dark" || val === "system") {
        setThemePreferenceState(val);
      }
      setLoaded(true);
      loadedRef.current = true;
    }).catch(() => {
      setLoaded(true);
      loadedRef.current = true;
    });
  }, []);

  // Resolve actual mode: preference (overriding system) or system
  const mode: ColorMode = useMemo(() => {
    if (themePreference === "light") return "light";
    if (themePreference === "dark") return "dark";
    return systemMode;
  }, [themePreference, systemMode]);

  const setThemePreference = useCallback(async (pref: ThemePreference) => {
    setThemePreferenceState(pref);
    try {
      await AsyncStorage.setItem(PREF_KEY, pref);
    } catch {
      // ignore storage errors
    }
  }, []);

  const setMode = useCallback((m: ColorMode) => {
    void setThemePreference(m);
  }, [setThemePreference]);

  const toggleMode = useCallback(() => {
    const next = mode === "dark" ? "light" : "dark";
    void setThemePreference(next);
  }, [mode, setThemePreference]);

  const colors = useMemo(() => (mode === "dark" ? dark : light), [mode]);

  const value = useMemo(
    () => ({ mode, colors, toggleMode, setMode, themePreference, setThemePreference }),
    [mode, colors, toggleMode, setMode, themePreference, setThemePreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      mode: "dark" as const,
      colors: dark,
      toggleMode: () => {},
      setMode: () => {},
      themePreference: "system" as const,
      setThemePreference: async () => {},
    };
  }
  return ctx;
}