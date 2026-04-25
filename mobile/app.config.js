/**
 * Expo loads `.env` before evaluating this file. Single source of truth (no app.json) so
 * `expo-doctor` is satisfied and we can set android.usesCleartextTraffic in JS (not allowed in app.json schema).
 */
module.exports = {
  expo: {
    name: "Trip-Sync",
    slug: "react-example",
    owner: "meetsantinfo",
    scheme: "tripsync",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
    },
    ios: {
      supportsTablet: true,
      infoPlist: {
        NSMicrophoneUsageDescription: "Trip-Sync needs microphone for convoy voice chat",
        UIBackgroundModes: ["audio", "voip"],
        NSAppTransportSecurity: {
          NSAllowsLocalNetworking: true,
        },
      },
    },
    android: {
      package: "com.tripsync.mobile",
      versionCode: 1,
      usesCleartextTraffic: true,
      permissions: [
        "android.permission.RECORD_AUDIO",
        "android.permission.MODIFY_AUDIO_SETTINGS",
        "android.permission.WAKE_LOCK",
        "android.permission.BLUETOOTH",
        "android.permission.BLUETOOTH_CONNECT",
        "android.permission.BLUETOOTH_SCAN",
      ],
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/android-icon-foreground.png",
        backgroundImage: "./assets/android-icon-background.png",
        monochromeImage: "./assets/android-icon-monochrome.png",
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      favicon: "./assets/favicon.png",
    },
    plugins: [
      "expo-font",
      "@react-native-community/datetimepicker",
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission:
            "Trip-Sync uses your location to set the meetup or drop-off point.",
        },
      ],
    ],
    extra: {
      eas: {
        projectId: "f2782331-62fd-4357-b83f-10faf3990f55",
      },
      mapboxPublicToken: (process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN || "").trim(),
    },
  },
};
