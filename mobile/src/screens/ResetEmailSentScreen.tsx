import React from "react";
import { Pressable, Text } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { AuthScreenShell } from "../components/auth/AuthUI";
import { useAuthPalette } from "../theme/authTheme";

type Props = NativeStackScreenProps<RootStackParamList, "ResetEmailSent">;

export function ResetEmailSentScreen({ navigation }: Props) {
  const c = useAuthPalette();

  return (
    <AuthScreenShell
      title="Reset email sent"
      subtitle="We have sent all required instructions details to your mail."
      onBack={() => navigation.replace("Login")}
      footer={
        <Pressable
          onPress={() => navigation.navigate("Login")}
          style={{
            marginTop: 220,
            borderWidth: 1.5,
            borderColor: c.borderDefault,
            borderRadius: 12,
            height: 48,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: c.bgCard,
          }}
        >
          <Text style={{ color: c.textPrimary, fontSize: 14, fontWeight: "600" }}>Go to Login page  ➜</Text>
        </Pressable>
      }
    />
  );
}
