import React from "react";
import { View, Text, Pressable, StyleSheet, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../context/AuthContext";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { colors } from "../theme";

export function ProfileScreen() {
  const { user, logout } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const onLogout = () => {
    Alert.alert("Sign out?", undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void logout() },
    ]);
  };

  return (
    <View style={styles.root}>
      <Text style={styles.name}>{user?.name ?? "—"}</Text>
      <Text style={styles.email}>{user?.email}</Text>
      <Text style={styles.role}>{user?.role === "organizer" ? "Organizer" : "Explorer"}</Text>

      {user?.role === "organizer" && (
        <Pressable
          style={styles.btn}
          onPress={() => navigation.getParent()?.navigate("CreateEvent")}
        >
          <Text style={styles.btnText}>Create event</Text>
        </Pressable>
      )}

      <Pressable style={styles.outline} onPress={onLogout}>
        <Text style={styles.outlineText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: 20 },
  name: { color: colors.text, fontSize: 24, fontWeight: "800" },
  email: { color: colors.muted, marginTop: 6 },
  role: { color: colors.muted, marginTop: 4, fontSize: 13 },
  btn: {
    marginTop: 28,
    backgroundColor: colors.text,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  btnText: { color: colors.bg, fontWeight: "800" },
  outline: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  outlineText: { color: colors.text, fontWeight: "700" },
});
