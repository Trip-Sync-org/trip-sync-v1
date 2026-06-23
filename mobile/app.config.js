module.exports = {
  expo: {
    name: "TripSync",
    slug: "trip-sync-deploy",
    owner: "trip-sync-org",
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
      bundleIdentifier: "com.tripsync.app",
      supportsTablet: true,
      infoPlist: {
        NSMicrophoneUsageDescription: "Trip-Sync needs microphone for convoy voice chat",
        NSPhotoLibraryUsageDescription: "Allow TripSync to access your photos and videos to add media to events and attractions.",
        NSCameraUsageDescription: "Allow TripSync to take photos for your profile and events.",
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
      // NOTE: REQUEST_IGNORE_BATTERY_OPTIMIZATIONS is Play-restricted — see batteryOptimization.ts
      permissions: [
        "android.permission.RECORD_AUDIO",
        "android.permission.MODIFY_AUDIO_SETTINGS",
        "android.permission.WAKE_LOCK",
        "android.permission.BLUETOOTH",
        "android.permission.BLUETOOTH_CONNECT",
        "android.permission.BLUETOOTH_SCAN",
        "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
        "android.permission.READ_MEDIA_IMAGES",
        "android.permission.READ_MEDIA_VIDEO",
      ],
      blockedPermissions: [
        "android.permission.WRITE_EXTERNAL_STORAGE",
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
      [
        "expo-image-picker",
        {
          photosPermission:
            "Allow TripSync to access your photos and videos to add media to events, attractions, and your profile.",
          cameraPermission:
            "Allow TripSync to take photos for your profile and events.",
          microphonePermission: false,
        },
      ],
    ],
    extra: {
      eas: {
        projectId: "5e8b1fd6-efd2-46c1-a4fc-9a81cbdb7ced",
      },
      mapboxPublicToken: (process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN || "").trim(),
    },
  },
};
