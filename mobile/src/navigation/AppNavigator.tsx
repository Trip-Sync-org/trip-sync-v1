import React from "react";
import { ActivityIndicator, View } from "react-native";
import { NavigationContainer, DarkTheme, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useAuth } from "../context/AuthContext";
import { useAppTheme } from "../context/ThemeContext";
import { colors } from "../theme";
import { LandingScreen } from "../screens/LandingScreen";
import { LoginScreen } from "../screens/LoginScreen";
import { SignupScreen } from "../screens/SignupScreen";
import { ExploreScreen } from "../screens/ExploreScreen";
import { UserDashboardScreen } from "../screens/UserDashboardScreen";
import { OrganizerScreen } from "../screens/OrganizerScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { TripDetailScreen } from "../screens/TripDetailScreen";
import { CreateEventScreen } from "../screens/CreateEventScreen";
import { LiveTripScreen } from "../screens/LiveTripScreen";
import { EndTripDashboardScreen } from "../screens/EndTripDashboardScreen";

export type RootStackParamList = {
  Landing: undefined;
  Login: undefined;
  Signup: undefined;
  Main: undefined;
  TripDetail: { id: string };
  CreateEvent: undefined;
  LiveTrip: { id: string };
  EndTripDashboard: {
    tripId: string;
    tripName?: string;
    distanceKm?: number;
    durationSec?: number;
    riders?: number;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

function MainTabs() {
  const { user } = useAuth();
  const { colors: tc } = useAppTheme();
  const isOrg = user?.role === "organizer";

  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: tc.bg },
        headerTintColor: tc.text,
        tabBarStyle: { backgroundColor: tc.surface, borderTopColor: tc.border },
        tabBarActiveTintColor: tc.text,
        tabBarInactiveTintColor: tc.muted,
      }}
    >
      <Tab.Screen
        name="ExploreTab"
        component={ExploreScreen}
        options={{ title: "Explore", tabBarLabel: "Explore" }}
      />
      <Tab.Screen
        name="MyTripsTab"
        component={isOrg ? OrganizerScreen : UserDashboardScreen}
        options={{
          title: isOrg ? "Organizer" : "My trips",
          tabBarLabel: isOrg ? "Host" : "Trips",
        }}
      />
      <Tab.Screen name="ProfileTab" component={ProfileScreen} options={{ title: "Profile" }} />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  const { user, loading } = useAuth();
  const { mode, colors: tc } = useAppTheme();

  const navTheme = React.useMemo(
    () => ({
      ...(mode === "dark" ? DarkTheme : DefaultTheme),
      colors: {
        ...(mode === "dark" ? DarkTheme.colors : DefaultTheme.colors),
        background: tc.bg,
        card: tc.surface,
        text: tc.text,
        border: tc.border,
        primary: colors.accent,
      },
    }),
    [mode, tc.bg, tc.surface, tc.text, tc.border],
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: tc.bg, justifyContent: "center" }}>
        <ActivityIndicator size="large" color={tc.text} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: tc.bg },
          headerTintColor: tc.text,
          contentStyle: { backgroundColor: tc.bg },
        }}
      >
        {user == null ? (
          <>
            <Stack.Screen name="Landing" component={LandingScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Login" component={LoginScreen} options={{ title: "Sign in" }} />
            <Stack.Screen name="Signup" component={SignupScreen} options={{ title: "Sign up" }} />
          </>
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen name="TripDetail" component={TripDetailScreen} options={{ title: "Trip" }} />
            <Stack.Screen name="CreateEvent" component={CreateEventScreen} options={{ title: "Create Event" }} />
            <Stack.Screen name="LiveTrip" component={LiveTripScreen} options={{ headerShown: false }} />
            <Stack.Screen
              name="EndTripDashboard"
              component={EndTripDashboardScreen}
              options={{ title: "Trip summary", headerShown: true }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
