//App.tsx
import React from "react";
import { View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ClerkProvider, ClerkLoaded } from "@clerk/clerk-expo";
import { AuthProvider } from "./src/context/AuthContext";
import { ThemeProvider, useAppTheme } from "./src/context/ThemeContext";
import { AlertProvider } from "./src/context/AlertContext";
import { AppNavigator } from "./src/navigation/AppNavigator";
import tokenCache from "./src/lib/tokenCache";

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

function AppInner() {
  const { mode, colors } = useAppTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style={mode === "dark" ? "light" : "dark"} />
      <AppNavigator />
    </View>
  );
}

export default function App() {
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ClerkLoaded>
        <SafeAreaProvider>
          <ThemeProvider>
            <AuthProvider>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <AlertProvider>
                  <AppInner />
                </AlertProvider>
              </GestureHandlerRootView>
            </AuthProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}
