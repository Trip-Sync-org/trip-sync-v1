import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuthPalette } from "../../theme/authTheme";
import { safeGoBack } from "../../utils/navigation";
import { navigateToRootStack } from "../../navigation/navigateRoot";

type Props = {
  navigation: any;
  title: string;
  children: React.ReactNode;
  fallback?: string;
  scroll?: boolean;
};

export function ProfileLayout({ navigation, title, children, fallback = "Main", scroll = true }: Props) {
  const c = useAuthPalette();
  const styles = getStyles(c);

  const body = scroll ? (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={styles.scrollContent}>{children}</View>
  );

  return (
    <SafeAreaView style={styles.page} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => safeGoBack(navigation, fallback)} hitSlop={8}>
          <Text style={styles.headerIcon}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{title}</Text>
        <Pressable onPress={() => navigateToRootStack(navigation, "Notifications")} hitSlop={8}>
          <Text style={styles.headerIcon}>🔔</Text>
        </Pressable>
      </View>
      <KeyboardAvoidingView
        style={styles.page}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
      >
        {body}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const getStyles = (c: ReturnType<typeof useAuthPalette>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: c.bgPage },
    header: {
      height: 58,
      backgroundColor: "#000000",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
    },
    headerIcon: { color: "#FFFFFF", fontSize: 19, fontWeight: "700" },
    headerTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "600" },
    scrollContent: {
      flexGrow: 1,
      backgroundColor: c.bgCard,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 16,
      paddingBottom: 24,
    },
  });
