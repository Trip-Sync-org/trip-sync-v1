import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Alert,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { navigateToRootStack } from "../navigation/navigateRoot";
import { useAuth } from "../context/AuthContext";
import { colors, typography } from "../theme";
import { apiFetch, readApiErrorMessage } from "../api/client";

const TEAL = "#2dd4bf";

type PayoutMethod = "upi" | "bank";

export function ProfileScreen() {
  const { user, logout } = useAuth();
  const navigation = useNavigation();

  const [payoutMethod, setPayoutMethod] = useState<PayoutMethod>("upi");
  const [upiId, setUpiId] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountConfirm, setBankAccountConfirm] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [payoutSaving, setPayoutSaving] = useState(false);
  const [payoutVerified, setPayoutVerified] = useState(false);
  const [maskedHint, setMaskedHint] = useState<string | null>(null);

  const loadPayoutDetails = useCallback(async () => {
    if (user?.role !== "organizer" || !user?.id) return;
    setPayoutLoading(true);
    try {
      const res = await apiFetch(`/api/organizer/payout-details/${user.id}`);
      const row = await res.json().catch(() => null);
      if (!res.ok || !row) {
        setMaskedHint(null);
        return;
      }
      const m = String(row.payout_method ?? "upi") === "bank" ? "bank" : "upi";
      setPayoutMethod(m);
      if (m === "upi") setUpiId(String(row.upi_id ?? ""));
      if (m === "bank") {
        setBankAccountName(String(row.bank_account_name ?? ""));
        setBankName(String(row.bank_name ?? ""));
        setBankIfsc(String(row.bank_ifsc ?? ""));
        setMaskedHint(
          typeof row.bank_account_number_masked === "string" ? row.bank_account_number_masked : null,
        );
      }
      setPayoutVerified(Boolean(row.is_verified));
    } finally {
      setPayoutLoading(false);
    }
  }, [user?.id, user?.role]);

  useEffect(() => {
    void loadPayoutDetails();
  }, [loadPayoutDetails]);

  const upiValid =
    /^[^\s@]+@[^\s@]+$/.test(upiId.trim()) && /\.[a-zA-Z]{2,}/.test((upiId.split("@")[1] ?? "").trim());

  const ifscValid = /^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankIfsc.trim().toUpperCase());
  const bankNumbersMatch =
    bankAccountNumber.length > 0 && bankAccountNumber === bankAccountConfirm;

  const onSavePayout = async () => {
    if (!user?.id) return;
    if (payoutMethod === "upi") {
      if (!upiValid) {
        Alert.alert("UPI", "Enter a valid UPI ID (e.g. name@paytm).");
        return;
      }
    } else {
      if (!bankAccountName.trim() || !bankName.trim() || !bankAccountNumber || !ifscValid || !bankNumbersMatch) {
        Alert.alert("Bank", "Fill all bank fields; IFSC must be like ABCD0123456; account numbers must match.");
        return;
      }
    }

    setPayoutSaving(true);
    try {
      const body =
        payoutMethod === "upi"
          ? { userId: Number(user.id), payoutMethod: "upi", upiId: upiId.trim() }
          : {
              userId: Number(user.id),
              payoutMethod: "bank",
              bankAccountName: bankAccountName.trim(),
              bankName: bankName.trim(),
              bankAccountNumber: bankAccountNumber.trim(),
              bankIfsc: bankIfsc.trim().toUpperCase(),
            };
      const res = await apiFetch("/api/organizer/payout-details", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        Alert.alert("Save failed", await readApiErrorMessage(res));
        return;
      }
      Alert.alert("Saved", "Payout method saved.");
      void loadPayoutDetails();
    } finally {
      setPayoutSaving(false);
    }
  };

  const onLogout = () => {
    Alert.alert("Sign out?", undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void logout() },
    ]);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.name}>{user?.name ?? "—"}</Text>
      <Text style={styles.email}>{user?.email}</Text>
      <Text style={styles.role}>{user?.role === "organizer" ? "Organizer" : "Explorer"}</Text>

      {user?.role === "organizer" && (
        <>
          <Pressable
            style={styles.btn}
            onPress={() => navigateToRootStack(navigation, "CreateEvent")}
          >
            <Text style={styles.btnText}>Create event</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, { backgroundColor: "rgba(45,212,191,0.12)" }]}
            onPress={() => navigateToRootStack(navigation, "Payout")}
          >
            <Text style={[styles.btnText, { color: TEAL }]}>Payout dashboard</Text>
          </Pressable>

          <Text style={styles.sectionLabel}>EARNINGS PAYOUT</Text>
          {payoutLoading ? (
            <ActivityIndicator color={TEAL} style={{ marginVertical: 16 }} />
          ) : (
            <>
              <View style={styles.methodRow}>
                <Pressable
                  onPress={() => setPayoutMethod("upi")}
                  style={[
                    styles.methodCard,
                    payoutMethod === "upi" && { borderColor: TEAL, borderWidth: 2 },
                  ]}
                >
                  <Text style={[styles.methodLabel, payoutMethod === "upi" && { color: TEAL }]}>
                    UPI ID
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setPayoutMethod("bank")}
                  style={[
                    styles.methodCard,
                    payoutMethod === "bank" && { borderColor: TEAL, borderWidth: 2 },
                  ]}
                >
                  <Text style={[styles.methodLabel, payoutMethod === "bank" && { color: TEAL }]}>
                    Bank Account
                  </Text>
                </Pressable>
              </View>

              {payoutVerified ? (
                <View style={styles.badgeOk}>
                  <Text style={styles.badgeOkText}>Verified</Text>
                </View>
              ) : null}

              {payoutMethod === "upi" ? (
                <View style={styles.field}>
                  <Text style={typography.label}>UPI ID</Text>
                  <View style={styles.inputRow}>
                    <TextInput
                      style={styles.input}
                      placeholder="yourname@upi"
                      placeholderTextColor={colors.muted2}
                      value={upiId}
                      onChangeText={setUpiId}
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                    {upiValid ? <Text style={styles.check}>✓</Text> : null}
                  </View>
                </View>
              ) : (
                <>
                  <View style={styles.field}>
                    <Text style={typography.label}>Account holder name</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Name as per bank"
                      placeholderTextColor={colors.muted2}
                      value={bankAccountName}
                      onChangeText={setBankAccountName}
                    />
                  </View>
                  <View style={styles.field}>
                    <Text style={typography.label}>Bank name</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Bank name"
                      placeholderTextColor={colors.muted2}
                      value={bankName}
                      onChangeText={setBankName}
                    />
                  </View>
                  <View style={styles.field}>
                    <Text style={typography.label}>Account number</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Account number"
                      placeholderTextColor={colors.muted2}
                      value={bankAccountNumber}
                      onChangeText={setBankAccountNumber}
                      keyboardType="number-pad"
                      secureTextEntry
                    />
                    {maskedHint ? (
                      <Text style={styles.hint}>On file: {maskedHint}</Text>
                    ) : null}
                  </View>
                  <View style={styles.field}>
                    <Text style={typography.label}>Confirm account number</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Re-enter account number"
                      placeholderTextColor={colors.muted2}
                      value={bankAccountConfirm}
                      onChangeText={setBankAccountConfirm}
                      keyboardType="number-pad"
                      secureTextEntry
                    />
                  </View>
                  <View style={styles.field}>
                    <Text style={typography.label}>IFSC</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="ABCD0123456"
                      placeholderTextColor={colors.muted2}
                      value={bankIfsc}
                      onChangeText={(t) => setBankIfsc(t.toUpperCase())}
                      autoCapitalize="characters"
                      maxLength={11}
                    />
                    {ifscValid ? <Text style={styles.check}>✓</Text> : null}
                  </View>
                </>
              )}

              <Pressable
                style={[styles.btnTeal, payoutSaving && { opacity: 0.7 }]}
                onPress={() => void onSavePayout()}
                disabled={payoutSaving}
              >
                <Text style={styles.btnTealText}>{payoutSaving ? "Saving…" : "Save payout method"}</Text>
              </Pressable>
            </>
          )}
        </>
      )}

      <Pressable style={styles.outline} onPress={onLogout}>
        <Text style={styles.outlineText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 48 },
  name: { color: colors.text, fontSize: 24, fontWeight: "800" },
  email: { color: colors.muted, marginTop: 6 },
  role: { color: colors.muted, marginTop: 4, fontSize: 13 },
  btn: {
    marginTop: 28,
    backgroundColor: colors.text,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  btnText: { color: colors.bg, fontWeight: "800" },
  sectionLabel: {
    marginTop: 28,
    marginBottom: 12,
    color: colors.muted2,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  methodRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  methodCard: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
  },
  methodLabel: { color: colors.muted, fontWeight: "700", fontSize: 13 },
  field: { marginBottom: 14 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  check: { color: colors.success, fontSize: 20, fontWeight: "800" },
  hint: { color: colors.muted, fontSize: 12, marginTop: 6 },
  badgeOk: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(52,211,153,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 12,
  },
  badgeOkText: { color: colors.success, fontWeight: "700", fontSize: 12 },
  btnTeal: {
    marginTop: 8,
    backgroundColor: TEAL,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  btnTealText: { color: "#000", fontWeight: "800" },
  outline: {
    marginTop: 24,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  outlineText: { color: colors.text, fontWeight: "700" },
});
