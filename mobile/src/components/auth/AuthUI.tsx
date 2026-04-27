import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { useAuthPalette } from "../../theme/authTheme";

type InputStatus = "default" | "error" | "success";

type AuthScreenShellProps = {
  screenLabel?: string;
  title: string;
  subtitle: string;
  onBack?: () => void;
  children?: React.ReactNode;
  footer?: React.ReactNode;
};

export function AuthScreenShell({
  title,
  subtitle,
  onBack,
  children,
  footer,
}: AuthScreenShellProps) {
  const c = useAuthPalette();
  const styles = getStyles(c);

  return (
    <SafeAreaView style={styles.page} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.page}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            {onBack ? (
              <Pressable onPress={onBack} hitSlop={10} style={styles.backBtn}>
                <Text style={styles.backArrow}>←</Text>
              </Pressable>
            ) : null}
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
            {children}
            {footer}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type InputFieldProps = {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  status?: InputStatus;
  secure?: boolean;
  keyboardType?: "default" | "email-address" | "number-pad";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  rightText?: string;
  onPressRightText?: () => void;
};

export function InputField({
  label,
  value,
  onChangeText,
  status = "default",
  secure = false,
  keyboardType = "default",
  autoCapitalize = "none",
  rightText,
  onPressRightText,
}: InputFieldProps) {
  const c = useAuthPalette();
  const styles = getStyles(c);
  const [focused, setFocused] = React.useState(false);
  const [hidden, setHidden] = React.useState(secure);
  const showLabel = focused || value.length > 0;

  const borderColor =
    status === "error"
      ? c.borderError
      : status === "success"
        ? c.borderSuccess
        : c.borderDefault;

  return (
    <View style={styles.fieldWrap}>
      {showLabel ? <Text style={styles.floatingLabel}>{label}</Text> : null}
      <View style={[styles.inputWrap, { borderColor }]}>
        <TextInput
          style={styles.input}
          placeholder={showLabel ? "" : label}
          placeholderTextColor={c.textPlaceholder}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={hidden}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
        />
        {secure ? (
          <Pressable style={styles.rightInline} onPress={() => setHidden((s) => !s)}>
            <Text style={styles.iconText}>{hidden ? "👁" : "👁‍🗨"}</Text>
          </Pressable>
        ) : null}
        {rightText ? (
          <Pressable style={styles.rightInline} onPress={onPressRightText}>
            <Text
              style={[
                styles.rightText,
                rightText === "✓" ? { color: c.accentGreen, fontWeight: "700" } : null,
              ]}
            >
              {rightText}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

type PrimaryButtonProps = {
  title: string;
  disabled?: boolean;
  onPress: () => void;
};

export function PrimaryButton({ title, disabled = false, onPress }: PrimaryButtonProps) {
  const c = useAuthPalette();
  const styles = getStyles(c);

  return (
    <Pressable
      style={[styles.primaryBtn, disabled ? styles.primaryBtnDisabled : null]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.primaryBtnText, disabled ? styles.primaryBtnTextDisabled : null]}>{title}</Text>
    </Pressable>
  );
}

type CheckboxProps = {
  checked: boolean;
  label: React.ReactNode;
  onPress: () => void;
};

export function CheckboxRow({ checked, label, onPress }: CheckboxProps) {
  const c = useAuthPalette();
  const styles = getStyles(c);

  return (
    <Pressable style={styles.checkboxRow} onPress={onPress}>
      <View style={[styles.checkbox, checked ? styles.checkboxOn : null]}>
        {checked ? <Text style={styles.checkboxTick}>✓</Text> : null}
      </View>
      <View style={styles.checkboxLabelWrap}>{label}</View>
    </Pressable>
  );
}

export function DividerOr() {
  const c = useAuthPalette();
  const styles = getStyles(c);
  return (
    <View style={styles.orRow}>
      <View style={styles.orLine} />
      <Text style={styles.orText}>OR</Text>
      <View style={styles.orLine} />
    </View>
  );
}

type GoogleButtonProps = { onPress: () => void };

export function GoogleButton({ onPress }: GoogleButtonProps) {
  const c = useAuthPalette();
  const styles = getStyles(c);
  return (
    <Pressable style={styles.googleBtn} onPress={onPress}>
      <Svg width="20" height="20" viewBox="0 0 24 24">
        <Path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          fill="#4285F4"
        />
        <Path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <Path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
          fill="#FBBC05"
        />
        <Path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </Svg>
      <Text style={styles.googleText}>Continue with Google</Text>
    </Pressable>
  );
}

type RoleSwitchProps = {
  value: "explorer" | "organisor";
  onChange: (v: "explorer" | "organisor") => void;
};

export function RoleSwitch({ value, onChange }: RoleSwitchProps) {
  const c = useAuthPalette();
  const styles = getStyles(c);

  return (
    <View style={styles.roleRow}>
      <Pressable
        onPress={() => onChange("explorer")}
        style={[styles.roleBtn, value === "explorer" ? styles.roleBtnActive : null]}
        accessibilityLabel="Explorer account type"
      >
        <Text style={[styles.roleText, value === "explorer" ? styles.roleTextActive : null]}>Explorer</Text>
      </Pressable>
      <Pressable
        onPress={() => onChange("organisor")}
        style={[styles.roleBtn, value === "organisor" ? styles.roleBtnActive : null]}
        accessibilityLabel="Organisor account type"
      >
        <Text style={[styles.roleText, value === "organisor" ? styles.roleTextActive : null]}>Organisor</Text>
      </Pressable>
    </View>
  );
}

const getStyles = (c: ReturnType<typeof useAuthPalette>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: c.bgPage },
    scrollContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 16, paddingBottom: 16 },
    card: {
      backgroundColor: c.bgCard,
      borderRadius: 24,
      paddingHorizontal: 24,
      paddingTop: 26,
      paddingBottom: 20,
      shadowColor: "#000",
      shadowOpacity: c.bgCard === "#0D0D0D" ? 0 : 0.08,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: c.bgCard === "#0D0D0D" ? 0 : 3,
      borderWidth: c.bgCard === "#0D0D0D" ? 1 : 0,
      borderColor: c.bgCard === "#0D0D0D" ? "#1E1E1E" : "transparent",
    },
    backBtn: { alignSelf: "flex-start", marginBottom: 8 },
    backArrow: { color: c.textPrimary, fontSize: 20, fontWeight: "700" },
    title: { color: c.textPrimary, fontSize: 40 / 1.54, fontWeight: "700", marginTop: 2 },
    subtitle: { color: c.textSecondary, fontSize: 14, marginTop: 8, marginBottom: 16, lineHeight: 22 },
    fieldWrap: { marginTop: 10 },
    floatingLabel: {
      position: "absolute",
      top: -8,
      left: 12,
      zIndex: 5,
      color: c.textSecondary,
      fontSize: 11,
      backgroundColor: c.bgCard,
      paddingHorizontal: 5,
    },
    inputWrap: {
      minHeight: 52,
      backgroundColor: c.bgInput,
      borderWidth: 1.5,
      borderRadius: 10,
      paddingHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
    },
    input: { flex: 1, color: c.textPrimary, fontSize: 14, paddingVertical: 12 },
    rightInline: { marginLeft: 8, padding: 2 },
    rightText: { color: c.textSecondary, fontSize: 14 },
    iconText: { color: c.textSecondary, fontSize: 13 },
    primaryBtn: {
      height: 50,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.accentOrange,
      marginTop: 16,
    },
    primaryBtnDisabled: { backgroundColor: c.btnDisabledBg },
    primaryBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
    primaryBtnTextDisabled: { color: c.btnDisabledTxt },
    checkboxRow: { flexDirection: "row", alignItems: "center", marginTop: 14 },
    checkbox: {
      width: 14,
      height: 14,
      borderRadius: 3,
      borderWidth: 1.5,
      borderColor: c.borderDefault,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
    },
    checkboxOn: { borderColor: c.checkboxFill, backgroundColor: c.checkboxFill },
    checkboxTick: { color: "#fff", fontSize: 9, lineHeight: 10, fontWeight: "700" },
    checkboxLabelWrap: { marginLeft: 8, flex: 1 },
    orRow: { flexDirection: "row", alignItems: "center", marginVertical: 14, gap: 8 },
    orLine: { flex: 1, height: 1, backgroundColor: c.borderDefault },
    orText: { color: c.textSecondary, fontSize: 11, fontWeight: "600" },
    googleBtn: {
      height: 46,
      borderRadius: 10,
      borderWidth: 1.2,
      borderColor: c.borderDefault,
      backgroundColor: c.bgCard,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    googleText: { color: c.textPrimary, fontSize: 14, fontWeight: "600" },
    roleRow: { flexDirection: "row", gap: 10, marginTop: 12 },
    roleBtn: {
      flex: 1,
      height: 42,
      borderRadius: 10,
      borderWidth: 1.2,
      borderColor: c.borderDefault,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: c.bgInput,
    },
    roleBtnActive: { borderColor: c.accentOrange, backgroundColor: c.accentOrange },
    roleText: { color: c.textSecondary, fontSize: 13, fontWeight: "600" },
    roleTextActive: { color: "#FFFFFF" },
  });
