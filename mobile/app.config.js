module.exports = {
  expo: {
    name: "TripSync",
    slug: "trip-sync-deploy",
    owner: "tripsync-dev",
    scheme: "tripsync",
    version: "1.0.1",
    orientation: "portrait",
    icon: "./assets/images/apk-logo.png",
    userInterfaceStyle: "automatic",
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
      package: "com.tripsync.app",
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
        foregroundImage: "./assets/images/apk-logo.png",
        backgroundColor: "#ffffff",
      },
      predictiveBackGestureEnabled: false,
    },
    androidStatusBar: {
      backgroundColor: "#000000",
      barStyle: "light-content",
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
        projectId: "2655de30-8a6d-4f1a-a272-5c712f9abc98",
      },
      mapboxPublicToken: (process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN || "").trim(),
    },
  },
};
