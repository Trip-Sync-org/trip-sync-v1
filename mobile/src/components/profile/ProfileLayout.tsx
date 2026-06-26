import React from "react";
import { Bell } from "lucide-react-native";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthPalette } from "../../theme/authTheme";
import { safeGoBack } from "../../utils/navigation";
import { navigateToRootStack } from "../../navigation/navigateRoot";

type Props = {
  navigation: any;
  title: string;
  children: React.ReactNode;
  fallback?: string;
  scroll?: boolean;
  /** Enable if this screen sits inside a tab navigator with an absolute tab bar */
  tabBarPadding?: boolean;
};

const HEADER_HEIGHT = 58;

export function ProfileLayout({
  navigation,
  title,
  children,
  fallback = "Main",
  scroll = true,
  tabBarPadding = false,
}: Props) {
  const c = useAuthPalette();
  const insets = useSafeAreaInsets();
  const styles = getStyles(c, insets.top);

  const scrollContentStyle = [
    styles.scrollContent,
    tabBarPadding ? { paddingBottom: 80 } : { paddingBottom: 16 },
  ];

  const body = scroll ? (
    <ScrollView
      style={styles.flexFill}
      contentContainerStyle={scrollContentStyle}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={scrollContentStyle}>{children}</View>
  );

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Pressable onPress={() => safeGoBack(navigation, fallback)} hitSlop={8}>
          <Text style={styles.headerIcon}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{title}</Text>
        <Pressable onPress={() => navigateToRootStack(navigation, "Notifications")} hitSlop={8}>
          <Bell color="#FFFFFF" size={19} strokeWidth={2} />
        </Pressable>
      </View>
      {body}
    </View>
  );
}

const getStyles = (c: ReturnType<typeof useAuthPalette>, topInset: number) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: c.bgCard },
    flexFill: { flex: 1 },
    header: {
      paddingTop: topInset,
      height: HEADER_HEIGHT + topInset,
      backgroundColor: "#000000",
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    headerIcon: { color: "#FFFFFF", fontSize: 19, fontWeight: "700" },
    headerTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "600" },
    scrollContent: {
      padding: 16,
    },
  });