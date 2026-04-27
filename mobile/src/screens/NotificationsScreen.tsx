import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { ProfileLayout } from "../components/profile/ProfileLayout";
import { useAuthPalette } from "../theme/authTheme";

type Props = NativeStackScreenProps<RootStackParamList, "Notifications">;

export function NotificationsScreen({ navigation }: Props) {
  const c = useAuthPalette();
  return (
    <ProfileLayout navigation={navigation} title="Notifications" fallback="Main">
      <View style={[styles.box, { borderColor: c.borderDefault, backgroundColor: c.bgInput }]}>
        <Text style={{ color: c.textPrimary, fontWeight: "600" }}>No new notifications</Text>
        <Text style={{ color: c.textSecondary, marginTop: 6 }}>You are all caught up for now.</Text>
      </View>
    </ProfileLayout>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 8 },
});
