import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { ProfileLayout } from "../components/profile/ProfileLayout";
import { useAuthPalette } from "../theme/authTheme";

type Props = NativeStackScreenProps<RootStackParamList, "SupportChat">;

type Msg = { id: string; text: string; time: string; isUser: boolean };

export function SupportChatScreen({ navigation }: Props) {
  const c = useAuthPalette();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Msg[]>([
    { id: "1", text: "Hey, I need help !", time: "08:10 AM", isUser: true },
    { id: "2", text: "Good morning ! How Can I Help?", time: "08:20 AM", isUser: false },
    { id: "3", text: "I ordered today, but I forget to add some furniture, so How can I add more?", time: "08:22 AM", isUser: true },
    { id: "4", text: "Ok, you just need to search for history and there you can see your order details.", time: "08:25 AM", isUser: false },
  ]);

  const canSend = useMemo(() => message.trim().length > 0, [message]);
  const send = () => {
    if (!canSend) return;
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages((prev) => [...prev, { id: `${prev.length + 1}`, text: message.trim(), time, isUser: true }]);
    setMessage("");
  };

  return (
    <ProfileLayout navigation={navigation} title="Support Chat" fallback="ContactUs">
      <Text style={[styles.heading, { color: c.textPrimary }]}>Support Chat</Text>
      <Text style={[styles.subtitle, { color: c.textSecondary }]}>
        Please wait our support team will reply you as soon as possible.
      </Text>

      <View style={[styles.agentRow, { borderColor: c.borderDefault }]}>
        <View style={styles.krCircle}>
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 11 }}>KR</Text>
          <View style={styles.onlineDot} />
        </View>
        <View>
          <Text style={[styles.agentName, { color: c.textPrimary }]}>Kane Reene</Text>
          <Text style={[styles.agentStatus, { color: c.textSecondary }]}>Online • just now</Text>
        </View>
      </View>

      {messages.map((m) => (
        <View key={m.id} style={[styles.bubble, m.isUser ? styles.userBubble : styles.agentBubble, { backgroundColor: m.isUser ? "#4FA88A" : c.bgInput }]}>
          <Text style={{ color: m.isUser ? "#FFFFFF" : c.textPrimary }}>{m.text}</Text>
          <Text style={[styles.timeText, { color: c.textSecondary }]}>{m.time}</Text>
        </View>
      ))}

      <View style={[styles.typing, { backgroundColor: c.bgInput }]}>
        <Text style={{ color: c.textSecondary }}>● ● ●</Text>
      </View>

      <View style={[styles.inputBar, { backgroundColor: c.bgInput, borderColor: c.borderDefault }]}>
        <Text>📎</Text>
        <Text>🎤</Text>
        <TextInput
          style={[styles.input, { color: c.textPrimary }]}
          placeholder="Aa message"
          placeholderTextColor={c.textSecondary}
          value={message}
          onChangeText={setMessage}
        />
        <Text>😊</Text>
        <Pressable onPress={send}>
          <Text style={{ color: canSend ? "#4FA88A" : c.textSecondary }}>➤</Text>
        </Pressable>
      </View>
    </ProfileLayout>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 26 / 1.54, fontWeight: "700", marginTop: 6 },
  subtitle: { fontSize: 14, marginTop: 8, marginBottom: 12, lineHeight: 20 },
  agentRow: { flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 12, marginBottom: 10 },
  krCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#4FA88A", alignItems: "center", justifyContent: "center", marginRight: 10 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#4CAF50", position: "absolute", right: -1, bottom: -1 },
  agentName: { fontSize: 13, fontWeight: "600" },
  agentStatus: { fontSize: 11, marginTop: 2 },
  bubble: { maxWidth: "76%", borderRadius: 16, padding: 12, marginVertical: 5 },
  userBubble: { alignSelf: "flex-end", borderBottomRightRadius: 4 },
  agentBubble: { alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  timeText: { fontSize: 10, marginTop: 6, alignSelf: "flex-end" },
  typing: { alignSelf: "flex-start", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginVertical: 8 },
  inputBar: { borderWidth: 1, borderRadius: 14, minHeight: 46, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, marginTop: 8 },
  input: { flex: 1, fontSize: 14, paddingVertical: 8 },
});
