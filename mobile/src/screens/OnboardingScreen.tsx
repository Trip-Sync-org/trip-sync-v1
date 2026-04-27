import React, { useRef, useState } from "react";
import { Dimensions, FlatList, Image, Pressable, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useAuthPalette } from "../theme/authTheme";

type Props = NativeStackScreenProps<RootStackParamList, "Onboarding">;

const { width } = Dimensions.get("window");

const slides = [
  {
    id: "1",
    image: require("../../assets/images/onboarding1.png.png"),
    title: "Find your destination",
    subtitle: "Plan your travel. Pick the best place for your holiday.",
  },
  {
    id: "2",
    image: require("../../assets/images/onboarding2.png.png"),
    title: "Ready to travel",
    subtitle: "Pack your bags. Don't forget your mask!",
  },
  {
    id: "3",
    image: require("../../assets/images/onboarding3.png.png"),
    title: "Enjoy your trip",
    subtitle: "Enjoy every second of your holiday. Take a photo and share it with your friends.",
  },
];

export function OnboardingScreen({ navigation }: Props) {
  const c = useAuthPalette();
  const styles = getStyles(c);
  const isDark = c.bgPage === "#000000";
  const listRef = useRef<FlatList<(typeof slides)[number]>>(null);
  const [index, setIndex] = useState(0);

  const finishOnboarding = async () => {
    try {
      await AsyncStorage.multiSet([
        ["onboardingDone", "true"],
        ["tripsync_onboarding_done", "1"],
      ]);
      console.log("Onboarding marked done");
    } catch (e) {
      console.log("Failed to save onboarding flag:", e);
    } finally {
      navigation.replace("Login");
    }
  };

  const onNext = () => {
    if (index < slides.length - 1) {
      listRef.current?.scrollToIndex({ index: index + 1, animated: true });
      return;
    }
    void finishOnboarding();
  };

  return (
    <View style={styles.page}>
      <Pressable style={styles.skipBtn} onPress={() => void finishOnboarding()}>
        <Text style={styles.skipText}>Skip</Text>
      </Pressable>
      <FlatList
        ref={listRef}
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / width);
          setIndex(i);
        }}
        renderItem={({ item }) => (
          <View style={styles.slide}>
            <View style={styles.illustrationWrap}>
              <Image source={item.image} style={styles.illustration} resizeMode="contain" />
            </View>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.subtitle}>{item.subtitle}</Text>
          </View>
        )}
      />
      <View style={styles.footer}>
        <View style={styles.dots}>
          {slides.map((s, i) => (
            <View
              key={s.id}
              style={[styles.dot, isDark ? styles.dotDark : null, i === index ? styles.dotActive : null]}
            />
          ))}
        </View>
        <Pressable style={[styles.nextBtn, index === slides.length - 1 ? styles.letsGoBtn : null]} onPress={onNext}>
          <Text style={[styles.nextText, isDark ? styles.nextTextDark : null]}>{index === slides.length - 1 ? "Let's Go" : "›"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const getStyles = (c: ReturnType<typeof useAuthPalette>) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: c.bgPage, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 32 },
    skipBtn: { alignSelf: "flex-end", paddingHorizontal: 4, paddingVertical: 4 },
    skipText: { color: c.textPrimary, fontSize: 16, fontWeight: "600" },
    slide: { width: width - 40, alignItems: "center", paddingHorizontal: 14, paddingTop: 8 },
    illustrationWrap: { width: width - 70, height: width - 20, alignItems: "center", justifyContent: "center", marginTop: 8 },
    illustration: { width: "100%", height: "100%" },
    title: { color: c.textPrimary, fontSize: 38 / 1.54, fontWeight: "700", alignSelf: "flex-start", marginTop: 24 },
    subtitle: { color: c.textSecondary, fontSize: 14, marginTop: 8, lineHeight: 22, alignSelf: "flex-start" },
    footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18 },
    dots: { flexDirection: "row", gap: 8 },
    dot: { width: 8, height: 8, borderRadius: 999, backgroundColor: c.borderDefault },
    dotActive: { width: 22, backgroundColor: c.textPrimary },
    dotDark: { backgroundColor: "#333333" },
    nextBtn: {
      width: 56,
      height: 56,
      borderRadius: 16,
      backgroundColor: c.textPrimary,
      alignItems: "center",
      justifyContent: "center",
    },
    letsGoBtn: { width: 132, borderRadius: 16 },
    nextText: { color: c.bgCard, fontSize: 24, fontWeight: "700" },
    nextTextDark: { color: "#000000" },
  });
