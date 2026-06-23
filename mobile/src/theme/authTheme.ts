import { useAppTheme } from "../context/ThemeContext";

export type AuthPalette = {
  bgPage: string;
  bgCard: string;
  bgInput: string;
  textPrimary: string;
  textSecondary: string;
  textPlaceholder: string;
  accentOrange: string;
  accentGreen: string;
  borderDefault: string;
  borderError: string;
  borderSuccess: string;
  checkboxFill: string;
  btnDisabledBg: string;
  btnDisabledTxt: string;
};

const shared = {
  borderError: "#E05555",
} as const;

const lightPalette: AuthPalette = {
  bgPage: "#EDEDED",
  bgCard: "#FFFFFF",
  bgInput: "#F5F5F5",
  textPrimary: "#1A1A1A",
  textSecondary: "#9E9E9E",
  textPlaceholder: "#BDBDBD",
  accentOrange: "#1A1A1A",
  accentGreen: "#1A1A1A",
  borderDefault: "#E8E8E8",
  borderSuccess: "#1A1A1A",
  checkboxFill: "#1A1A1A",
  btnDisabledBg: "#D0D0D0",
  btnDisabledTxt: "#888888",
  ...shared,
};

const darkPalette: AuthPalette = {
  bgPage: "#000000",
  bgCard: "#0D0D0D",
  bgInput: "#1C1C1C",
  textPrimary: "#FFFFFF",
  textSecondary: "#8A8A8A",
  textPlaceholder: "#555555",
  accentOrange: "#FFFFFF",
  accentGreen: "#FFFFFF",
  borderDefault: "#2A2A2A",
  borderSuccess: "#FFFFFF",
  checkboxFill: "#FFFFFF",
  btnDisabledBg: "#1E1E1E",
  btnDisabledTxt: "#555555",
  ...shared,
};

export function useAuthPalette(): AuthPalette {
  const { mode } = useAppTheme();
  return mode === "dark" ? darkPalette : lightPalette;
}