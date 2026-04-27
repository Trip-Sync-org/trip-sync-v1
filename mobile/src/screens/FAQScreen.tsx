import React, { useState } from "react";
import { LayoutAnimation, Pressable, StyleSheet, Text, UIManager, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { ProfileLayout } from "../components/profile/ProfileLayout";
import { useAuthPalette } from "../theme/authTheme";

if (UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Props = NativeStackScreenProps<RootStackParamList, "FAQ">;

const faqData = [
  {
    section: "General",
    items: [
      { q: "How to contact with riders?", a: "You can contact riders through the in-app chat or call feature on trip detail page." },
      { q: "How to change my selected destination?", a: "Go to your trip settings and update your destination before the trip starts." },
      { q: "What is cost of each item?", a: "Pricing varies by destination and package. Check trip details for full cost breakdown." },
    ],
  },
  {
    section: "Contact",
    items: [
      { q: "What is the customer care number?", a: "Call us at +1 800 000 0000, available 24x7." },
      { q: "Can I Cancel the order after one week?", a: "Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium." },
      { q: "How to call any service now?", a: "Tap on Call Center option in Contact Us to connect immediately." },
    ],
  },
];

export function FAQScreen({ navigation }: Props) {
  const c = useAuthPalette();
  const [open, setOpen] = useState<Record<string, boolean>>({ "Contact-1": true });

  const toggle = (key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <ProfileLayout navigation={navigation} title="FAQs" fallback="ContactUs">
      <Text style={[styles.heading, { color: c.textPrimary }]}>FAQ</Text>
      <Text style={[styles.subtitle, { color: c.textSecondary }]}>Find important information and update about any recent changes and fees here.</Text>

      {faqData.map((sec) => (
        <View key={sec.section}>
          <Text style={[styles.section, { color: "#4FA88A" }]}>{sec.section}</Text>
          {sec.items.map((item, idx) => {
            const key = `${sec.section}-${idx}`;
            const isOpen = !!open[key];
            return (
              <Pressable key={key} onPress={() => toggle(key)} style={[styles.row, { borderColor: c.borderDefault }]}>
                <View style={styles.rowHead}>
                  <Text style={[styles.q, { color: c.textPrimary }]}>{item.q}</Text>
                  <Text style={{ color: isOpen ? "#4FA88A" : c.textSecondary }}>{isOpen ? "▲" : "▼"}</Text>
                </View>
                {isOpen ? <Text style={[styles.answer, { color: c.textSecondary }]}>{item.a}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ))}

      <Pressable style={[styles.homeBtn, { borderColor: c.borderDefault }]} onPress={() => navigation.replace("Main")}>
        <Text style={{ color: c.textPrimary, fontWeight: "600" }}>Go to Homepage  ➜</Text>
      </Pressable>
    </ProfileLayout>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 26 / 1.54, fontWeight: "700", marginTop: 6 },
  subtitle: { fontSize: 14, marginTop: 8, lineHeight: 20 },
  section: { marginTop: 18, marginBottom: 8, fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  row: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 12, marginTop: -1 },
  rowHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  q: { fontSize: 15, fontWeight: "500", flex: 1, paddingRight: 10 },
  answer: { fontSize: 13, lineHeight: 20, marginTop: 8 },
  homeBtn: { marginTop: 24, borderWidth: 1.5, borderRadius: 12, padding: 14, alignItems: "center" },
});
