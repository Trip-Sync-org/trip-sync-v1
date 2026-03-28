import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ColorMode = "dark" | "light";

const STORAGE_KEY = "tripsync_color_mode";

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

type ThemeContextValue = {
  mode: ColorMode;
  colors: ThemeColors;
  toggleMode: () => void;
  setMode: (m: ColorMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ColorMode>("dark");

  React.useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw === "light" || raw === "dark") setModeState(raw);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const setMode = useCallback((m: ColorMode) => {
    setModeState(m);
    AsyncStorage.setItem(STORAGE_KEY, m).catch(() => {});
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === "dark" ? "light" : "dark");
  }, [mode, setMode]);

  const colors = useMemo(() => (mode === "dark" ? dark : light), [mode]);

  const value = useMemo(
    () => ({ mode, colors, toggleMode, setMode }),
    [mode, colors, toggleMode, setMode],
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
    };
  }
  return ctx;
}
