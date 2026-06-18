import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { ONBOARDING_PERMISSIONS_KEY } from "../constants/onboardingPermissions";

type Props = NativeStackScreenProps<RootStackParamList, "AuthBootstrap">;

/** Routes authenticated users to permissions onboarding (once) or Main. */
export function AuthBootstrapScreen({ navigation }: Props) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const shown = await AsyncStorage.getItem(ONBOARDING_PERMISSIONS_KEY);
        if (cancelled) return;
        navigation.replace(shown === "true" ? "Main" : "OnboardingPermissions");
      } catch {
        if (!cancelled) navigation.replace("OnboardingPermissions");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigation]);

  return (
    <View style={styles.root}>
      <ActivityIndicator size="large" color="#fff" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
});
