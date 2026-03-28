import { Platform, TextStyle } from "react-native";

/** Aligns with web `index.css`: Inter + Space Grotesk feel (system fonts on device). */
export const colors = {
  bg: "#000000",
  surface: "#0d0d0d",
  border: "rgba(255,255,255,0.1)",
  text: "#ffffff",
  muted: "rgba(255,255,255,0.45)",
  muted2: "rgba(255,255,255,0.3)",
  accent: "#ffffff",
  success: "#34d399",
  danger: "#f87171",
  warn: "#fbbf24",
  emerald: "#34d399",
};

const display = Platform.select({
  ios: "System",
  android: "sans-serif-medium",
  default: "System",
});

const body = Platform.select({
  ios: "System",
  android: "sans-serif",
  default: "System",
});

export const typography = {
  /** Space Grotesk–style headings (web h1–h3) */
  display: { fontFamily: display, fontWeight: "700" as const },
  body: { fontFamily: body },
  hero: {
    fontFamily: display,
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: -1,
    lineHeight: 42,
  } satisfies TextStyle,
  h1: {
    fontFamily: display,
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.5,
  } satisfies TextStyle,
  h2: {
    fontFamily: display,
    fontSize: 20,
    fontWeight: "700",
  } satisfies TextStyle,
  label: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
    textTransform: "uppercase" as const,
    color: colors.muted2,
  } satisfies TextStyle,
};
