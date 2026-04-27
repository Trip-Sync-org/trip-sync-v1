import { useColorScheme } from "react-native";

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
  accentOrange: "#4FA88A",
  accentGreen: "#4CAF50",
  borderError: "#E05555",
  borderSuccess: "#4CAF50",
} as const;

const lightPalette: AuthPalette = {
  bgPage: "#EDEDED",
  bgCard: "#FFFFFF",
  bgInput: "#F5F5F5",
  textPrimary: "#1A1A1A",
  textSecondary: "#9E9E9E",
  textPlaceholder: "#BDBDBD",
  borderDefault: "#E8E8E8",
  checkboxFill: "#4FA88A",
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
  borderDefault: "#2A2A2A",
  checkboxFill: "#4FA88A",
  btnDisabledBg: "#1E1E1E",
  btnDisabledTxt: "#555555",
  ...shared,
};

export function useAuthPalette(): AuthPalette {
  const colorScheme = useColorScheme();
  return colorScheme === "dark" ? darkPalette : lightPalette;
}
