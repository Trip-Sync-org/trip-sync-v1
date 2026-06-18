import React, { useCallback, useState } from "react";
import {
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { ONBOARDING_PERMISSIONS_KEY } from "../constants/onboardingPermissions";
import { requestBatteryOptimizationExemption } from "../utils/batteryOptimization";

type Props = NativeStackScreenProps<RootStackParamList, "OnboardingPermissions">;

type CardStatus = "pending" | "granted" | "denied" | "info" | "skipped";

type PermissionCard = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  status: CardStatus;
  actionLabel: string;
  informational?: boolean;
  optional?: boolean;
};

export function OnboardingPermissionsScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [locationStatus, setLocationStatus] = useState<CardStatus>("pending");
  const [micStatus, setMicStatus] = useState<CardStatus>("pending");
  const [photosStatus, setPhotosStatus] = useState<CardStatus>("info");
  const [batteryStatus, setBatteryStatus] = useState<CardStatus>("pending");

  const requestLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setLocationStatus(status === "granted" ? "granted" : "denied");
    } catch {
      setLocationStatus("denied");
    }
  }, []);

  const requestMicrophone = useCallback(async () => {
    if (Platform.OS !== "android") {
      setMicStatus("info");
      return;
    }
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: "Microphone",
          message: "TripSync needs microphone access for convoy voice chat during trips.",
          buttonPositive: "Allow",
          buttonNegative: "Deny",
        },
      );
      setMicStatus(granted === PermissionsAndroid.RESULTS.GRANTED ? "granted" : "denied");
    } catch {
      setMicStatus("denied");
    }
  }, []);

  const acknowledgePhotos = useCallback(() => {
    setPhotosStatus("granted");
  }, []);

  const requestBatteryExemption = useCallback(async () => {
    if (Platform.OS !== "android") {
      setBatteryStatus("skipped");
      return;
    }
    try {
      await requestBatteryOptimizationExemption();
      // No reliable read API — trust the user's choice in the system dialog.
      setBatteryStatus("info");
    } catch {
      setBatteryStatus("denied");
    }
  }, []);

  const skipBattery = useCallback(() => {
    setBatteryStatus("skipped");
  }, []);

  const finish = useCallback(async () => {
    try {
      await AsyncStorage.setItem(ONBOARDING_PERMISSIONS_KEY, "true");
    } catch {
      /* proceed anyway */
    }
    navigation.replace("Main");
  }, [navigation]);

  const cards: PermissionCard[] = [
    {
      id: "location",
      icon: "location-outline",
      title: "Location",
      description: "Share your live position with the convoy, checkpoint distances, and map pins during trips.",
      status: locationStatus,
      actionLabel: "Allow Location",
    },
    {
      id: "mic",
      icon: "mic-outline",
      title: "Microphone",
      description:
        Platform.OS === "android"
          ? "Join convoy voice chat and talk with riders and staff during a trip."
          : "You'll be asked for microphone access when you join voice chat.",
      status: micStatus,
      actionLabel: Platform.OS === "android" ? "Allow Microphone" : "Got it",
    },
    {
      id: "photos",
      icon: "images-outline",
      title: "Photos",
      description:
        "Add photos when sharing nearby attractions. You'll be prompted when you pick images from your gallery.",
      status: photosStatus,
      actionLabel: "Got it",
      informational: true,
    },
    {
      id: "battery",
      icon: "battery-charging-outline",
      title: "Reliable live tracking",
      description:
        "TripSync uses your location and voice chat in real time while a trip is active. Some phones may pause this in the background to save battery. Allow TripSync to run without restrictions for the most reliable experience during trips.",
      status: batteryStatus,
      actionLabel: "Allow",
      optional: true,
    },
  ].filter((card) => card.id !== "battery" || Platform.OS === "android");

  const statusLabel = (card: PermissionCard): string => {
    if (card.status === "granted") return "Granted ✓";
    if (card.status === "denied") return "Denied";
    if (card.status === "skipped") return "Skipped";
    if (card.status === "info") {
      if (card.id === "mic" && Platform.OS !== "android") return "Noted";
      if (card.id === "battery") return "System dialog shown";
      if (card.id === "photos") return "Noted";
      return "Noted";
    }
    return "";
  };

  const onCardAction = (card: PermissionCard) => {
    if (card.id === "location") void requestLocation();
    else if (card.id === "mic") void requestMicrophone();
    else if (card.id === "photos") acknowledgePhotos();
    else if (card.id === "battery") void requestBatteryExemption();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
      <Text style={styles.heading}>App permissions</Text>
      <Text style={styles.subheading}>
        TripSync works best with a few permissions. You can change these anytime in system settings.
      </Text>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {cards.map((card) => {
          const done = card.status === "granted" || card.status === "info" || card.status === "skipped";
          const label = statusLabel(card);
          return (
            <View key={card.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.iconWrap}>
                  <Ionicons name={card.icon} size={22} color="#34d399" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{card.title}</Text>
                  <Text style={styles.cardDesc}>{card.description}</Text>
                </View>
              </View>
              {label ? <Text style={[styles.statusText, card.status === "denied" && styles.statusDenied]}>{label}</Text> : null}
              {card.id === "battery" && Platform.OS === "android" && batteryStatus !== "skipped" && batteryStatus !== "info" ? (
                <View style={styles.equalActions}>
                  <Pressable style={[styles.equalBtn, styles.equalBtnPrimary]} onPress={() => void requestBatteryExemption()}>
                    <Text style={styles.equalBtnPrimaryText}>Allow</Text>
                  </Pressable>
                  <Pressable style={[styles.equalBtn, styles.equalBtnSecondary]} onPress={skipBattery}>
                    <Text style={styles.equalBtnSecondaryText}>Maybe later</Text>
                  </Pressable>
                </View>
              ) : !done || (card.optional && card.id !== "battery") ? (
                <View style={styles.cardActions}>
                  {!done ? (
                    <Pressable style={styles.allowBtn} onPress={() => onCardAction(card)}>
                      <Text style={styles.allowBtnText}>{card.actionLabel}</Text>
                    </Pressable>
                  ) : null}
                  {card.optional && card.id !== "battery" && batteryStatus !== "skipped" ? (
                    <Pressable style={styles.skipBtn} onPress={skipBattery}>
                      <Text style={styles.skipBtnText}>Skip for now</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <Pressable style={styles.continueBtn} onPress={() => void finish()}>
        <Text style={styles.continueText}>Continue</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
    paddingHorizontal: 20,
  },
  heading: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 8,
  },
  subheading: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  scroll: { flex: 1 },
  scrollContent: { gap: 12, paddingBottom: 12 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
    padding: 14,
    gap: 10,
  },
  cardHeader: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "rgba(52,211,153,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 4,
  },
  cardDesc: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    lineHeight: 18,
  },
  statusText: {
    color: "#34d399",
    fontSize: 12,
    fontWeight: "700",
  },
  statusDenied: {
    color: "#f87171",
  },
  cardActions: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  equalActions: {
    flexDirection: "row",
    gap: 10,
  },
  equalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  equalBtnPrimary: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  },
  equalBtnSecondary: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  equalBtnPrimaryText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
  },
  equalBtnSecondaryText: {
    color: "rgba(255,255,255,0.75)",
    fontWeight: "700",
    fontSize: 13,
  },
  allowBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  allowBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
  },
  skipBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  skipBtnText: {
    color: "rgba(255,255,255,0.5)",
    fontWeight: "600",
    fontSize: 13,
  },
  continueBtn: {
    marginTop: 8,
    backgroundColor: "#fff",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  continueText: {
    color: "#000",
    fontWeight: "800",
    fontSize: 16,
  },
});
