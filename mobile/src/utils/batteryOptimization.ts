/**
 * Battery optimization exemption — Android only.
 *
 * NOTE: REQUEST_IGNORE_BATTERY_OPTIMIZATIONS is a Google Play restricted
 * permission requiring a declaration form in Play Console. Only request
 * this from the onboarding screen, only user-initiated, only for live-trip
 * tracking reliability. Do not add additional call sites without updating
 * the Play Console declaration.
 */
import Constants from "expo-constants";
import * as IntentLauncher from "expo-intent-launcher";
import { Linking, Platform } from "react-native";

function androidPackageName(): string {
  return Constants.expoConfig?.android?.package ?? "com.tripsync.app";
}

/**
 * Opens the system dialog to exempt this app from Doze / App Standby
 * battery optimizations. No reliable Expo managed API exists to read the
 * current exemption state — do not poll or re-prompt automatically.
 */
export async function requestBatteryOptimizationExemption(): Promise<void> {
  if (Platform.OS !== "android") return;

  const pkg = androidPackageName();
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
      { data: `package:${pkg}` },
    );
  } catch (e) {
    console.warn("[battery-opt] exemption intent failed, opening app settings", e);
    try {
      await Linking.openSettings();
    } catch (settingsErr) {
      console.warn("[battery-opt] could not open settings", settingsErr);
    }
  }
}
