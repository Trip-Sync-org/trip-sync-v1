import React, { useEffect, useRef } from "react";
import { Animated, Dimensions, StatusBar, StyleSheet, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useAuth } from "../context/AuthContext";

type Props = NativeStackScreenProps<RootStackParamList, "Splash">;

const { width } = Dimensions.get("window");

export function SplashScreen({ navigation }: Props) {
  const { user } = useAuth();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.88)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 6,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(async () => {
      try {
        const onboardingDone = await AsyncStorage.getItem("onboardingDone");
        const authToken = await AsyncStorage.getItem("authToken");

        console.log("onboardingDone:", onboardingDone);
        console.log("authToken:", authToken);

        if (user || (authToken && authToken !== "null" && authToken !== "")) {
          navigation.replace("Main");
        } else if (!onboardingDone || onboardingDone !== "true") {
          navigation.replace("Onboarding");
        } else {
          navigation.replace("Login");
        }
      } catch (e) {
        console.log("AsyncStorage error:", e);
        navigation.replace("Onboarding");
      }
    }, 2200);

    return () => clearTimeout(timer);
  }, [navigation, user, fadeAnim, scaleAnim]);

  return (
    <View style={styles.container}>
      <StatusBar hidden backgroundColor="#000000" barStyle="light-content" />
      <Animated.Image
        source={require("../../assets/images/logo.png")}
        style={[
          styles.logo,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
    justifyContent: "center",
    alignItems: "center",
  },
  logo: {
    width: width * 0.55,
    height: width * 0.55,
  },
});
