//path: mobile/src/screens/PayoutScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Platform,
  TextInput,
  KeyboardAvoidingView,
  Modal,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { apiFetch, readApiErrorMessage } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { typography, useThemeColors } from "../theme";
import { navigateToRootStack } from "../navigation/navigateRoot";
import { useOrganizerPaymentsSocket } from "../hooks/useOrganizerPaymentsSocket";
import { buildPayoutHistoryHtml, shareRevenuePdf } from "../lib/revenuePdf";
import { ConfirmModal } from "../components/ConfirmModal";

type Balance = {
  eligibleForPayout: number;
  totalPaidOut: number;
  pendingPayout: number;
  availableBalance: number;
};

type RevenueMini = {
  totalBookings: number;
  totalRevenue: number;
};

type PayoutRow = {
  id: string;
  amount: number;
  status: "completed" | "processing" | "pending" | "failed";
  createdAt: string;
  processedAt?: string | null;
  utr?: string | null;
  accountLabel?: string | null;
  note?: string | null;
};

type BankAccount = {
  id: string;
  accountNumber: string;
  ifsc: string;
  bankName?: string;
  accountHolderName?: string;
};

type Props = NativeStackScreenProps<RootStackParamList, "Payout">;

const { width: SW } = Dimensions.get("window");

export function PayoutScreen({ navigation }: Props) {
  const { user } = useAuth();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const s = useMemo(() => makeStyles(c), [c]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [revenueMini, setRevenueMini] = useState<RevenueMini | null>(null);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [payoutError, setPayoutError] = useState<string | null>(null);
  const [historyModal, setHistoryModal] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [showBankForm, setShowBankForm] = useState(false);
  const [newBank, setNewBank] = useState({ accountNumber: "", ifsc: "", accountHolderName: "" });
  const [bankBusy, setBankBusy] = useState(false);
  const [alertState, setAlertState] = useState<{ title: string; message: string } | null>(null);

  const maxPayout = balance?.eligibleForPayout ?? 0;
  const disabledReason =
    banks.length === 0
      ? "Add a bank account first"
      : amount <= 0
        ? "Enter a payout amount"
        : amount > maxPayout
          ? `Maximum eligible: ₹${maxPayout.toLocaleString("en-IN")}`
          : null;
  const canPayout = !disabledReason && !busy;

  const refresh = useCallback(async () => {
    if (!user?.id) return;
    try {
      setRefreshing(true);
      const [balRes, revRes, payRes, bankRes] = await Promise.all([
        apiFetch(`/api/organizers/${user.id}/payout-balance`),
        apiFetch(`/api/organizer/revenue/mini/${encodeURIComponent(String(user.id))}`),
        apiFetch(`/api/organizers/${user.id}/payouts`),
        apiFetch(`/api/organizers/${user.id}/bank-accounts`),
      ]);
      if (balRes.ok) {
        const b = (await balRes.json()) as Balance;
        setBalance(b);
      }
      if (revRes.ok) {
        const r = (await revRes.json()) as { totalBookings?: number; totalRevenue?: number };
        setRevenueMini({ totalBookings: r.totalBookings ?? 0, totalRevenue: r.totalRevenue ?? 0 });
      }
      if (payRes.ok) {
        const rows = (await payRes.json()) as PayoutRow[];
        setPayouts(Array.isArray(rows) ? rows.reverse() : []);
      }
      if (bankRes.ok) {
        const bs = (await bankRes.json()) as BankAccount[];
        setBanks(Array.isArray(bs) ? bs : []);
        if (bs.length > 0 && !selectedBankId) setSelectedBankId(bs[0].id);
      }
    } catch { /* keep partial */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, selectedBankId]);

  useOrganizerPaymentsSocket({
    userId: user?.id != null ? Number(user.id) : undefined,
    role: user?.activeRole,
    onPaymentConfirmed: () => void refresh(),
    onPayoutUpdated: () => void refresh(),
  });

  useEffect(() => { void refresh(); }, [refresh]);

  const requestPayout = async () => {
    if (!user?.id || !canPayout) return;
    setBusy(true);
    setPayoutError(null);
    try {
      const res = await apiFetch(`/api/organizers/${user.id}/payouts`, {
        method: "POST",
        body: JSON.stringify({ amount: Math.round(amount), bank_account_id: selectedBankId }),
      });
      if (!res.ok) { setPayoutError(await readApiErrorMessage(res)); return; }
      setSuccess(`Payout of ₹${Math.round(amount).toLocaleString("en-IN")} initiated.`);
      setTimeout(() => setSuccess(null), 3000);
      setAmount(0);
      void refresh();
    } finally { setBusy(false); }
  };

  const addBankAccount = async () => {
    if (!user?.id) return;
    if (!newBank.accountNumber.trim() || !newBank.ifsc.trim() || !newBank.accountHolderName.trim()) {
      setAlertState({ title: "Bank account", message: "All fields are required." }); return;
    }
    setBankBusy(true);
    try {
      const res = await apiFetch(`/api/organizers/${user.id}/bank-accounts`, {
        method: "POST",
        body: JSON.stringify({
          account_number: newBank.accountNumber.trim(),
          ifsc: newBank.ifsc.trim().toUpperCase(),
          account_holder_name: newBank.accountHolderName.trim(),
        }),
      });
      if (!res.ok) { setAlertState({ title: "Bank account", message: await readApiErrorMessage(res) }); return; }
      setShowBankForm(false);
      setNewBank({ accountNumber: "", ifsc: "", accountHolderName: "" });
      const bankRes = await apiFetch(`/api/organizers/${user.id}/bank-accounts`);
      if (bankRes.ok) { const bs = (await bankRes.json()) as BankAccount[]; setBanks(Array.isArray(bs) ? bs : []); }
    } finally { setBankBusy(false); }
  };

  const exportPayoutHistory = async () => {
    if (!user?.id) return; setPdfBusy(true);
    try {
      const html = buildPayoutHistoryHtml({
        organizerName: user.name ?? "Organizer",
        rows: payouts.map((r) => ({ amount: r.amount, status: r.status, date: r.createdAt, utr: r.utr ?? undefined })),
      });
      await shareRevenuePdf(html);
    } catch { setAlertState({ title: "Export failed", message: "Could not generate or share the PDF." }); } finally { setPdfBusy(false); }
  };

  const badgeForStatus = (s: string) => {
    const x = s.toLowerCase();
    if (x === "completed") return { bg: c.border, fg: c.text, label: "COMPLETED ✓" };
    if (x === "processing") return { bg: "rgba(59,130,246,0.25)", fg: "#60a5fa", label: "PROCESSING" };
    if (x === "pending") return { bg: "rgba(245,158,11,0.25)", fg: "#fbbf24", label: "PENDING" };
    if (x === "failed") return { bg: "rgba(248,113,113,0.25)", fg: "#f87171", label: "FAILED" };
    return { bg: c.border, fg: c.text, label: s.toUpperCase() };
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView ref={scrollRef} contentContainerStyle={{ paddingBottom: insets.bottom + 32, paddingHorizontal: 16 }} keyboardShouldPersistTaps="handled">
        {loading ? <View style={{ paddingVertical: 40, alignItems: "center" }}><ActivityIndicator color={c.text} /></View> : null}
        {success ? <View style={s.successBanner}><Text style={s.successText}>{success}</Text></View> : null}

        <View style={s.balanceCard}>
          <Text style={[typography.label, { color: c.muted }]}>Available Balance</Text>
          <Text style={[s.balanceAmt, { color: c.text }]}>₹{Number(balance?.availableBalance ?? 0).toLocaleString("en-IN")}</Text>
          <View style={s.balanceMeta}>
            <View>
              <Text style={[s.metaLabel, { color: c.muted }]}>Eligible for payout</Text>
              <Text style={[s.metaVal, { color: c.text }]}>₹{Number(balance?.eligibleForPayout ?? 0).toLocaleString("en-IN")}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[s.metaLabel, { color: c.muted }]}>Total paid out</Text>
              <Text style={[s.metaVal, { color: c.text }]}>₹{Number(balance?.totalPaidOut ?? 0).toLocaleString("en-IN")}</Text>
            </View>
          </View>
        </View>

        <View style={s.card}>
          <View style={s.rowBetween}>
            <Text style={[typography.label, { color: c.muted }]}>Bank Account</Text>
            <Pressable onPress={() => setShowBankForm((v) => !v)}>
              <Text style={[s.changeLink, { color: c.text }]}>{banks.length > 0 ? "+ Add" : "Add bank"}</Text>
            </Pressable>
          </View>
          {banks.length > 0 ? banks.map((b) => (
            <Pressable key={b.id} onPress={() => setSelectedBankId(b.id)} style={[s.bankRow, selectedBankId === b.id && s.bankRowActive]}>
              <View>
                <Text style={{ color: c.text, fontWeight: "700" }}>{b.bankName ?? "Bank"} · {b.accountNumber.slice(-4)}</Text>
                <Text style={[s.mutedSmall, { color: c.muted }]}>{b.accountHolderName} · {b.ifsc}</Text>
              </View>
              <Ionicons name={selectedBankId === b.id ? "radio-button-on" : "radio-button-off"} size={20} color={selectedBankId === b.id ? c.text : c.muted} />
            </Pressable>
          )) : <Text style={[s.mutedSmall, { color: c.muted }]}>No bank account added yet</Text>}
        </View>

        {showBankForm ? (
          <View style={s.bankForm}>
            <Text style={[typography.label, { color: c.muted }]}>New Bank Account</Text>
            <TextInput style={s.input} placeholder="Account holder name" placeholderTextColor={c.muted} value={newBank.accountHolderName} onChangeText={(t) => setNewBank((p) => ({ ...p, accountHolderName: t }))} />
            <TextInput style={s.input} placeholder="Account number" placeholderTextColor={c.muted} keyboardType="number-pad" value={newBank.accountNumber} onChangeText={(t) => setNewBank((p) => ({ ...p, accountNumber: t }))} />
            <TextInput style={s.input} placeholder="IFSC code" placeholderTextColor={c.muted} autoCapitalize="characters" value={newBank.ifsc} onChangeText={(t) => setNewBank((p) => ({ ...p, ifsc: t }))} />
            <Pressable style={[s.maxBtn, bankBusy && { opacity: 0.65 }]} onPress={() => void addBankAccount()} disabled={bankBusy}>
              <Text style={[s.maxBtnText, { color: c.text }]}>{bankBusy ? "Saving…" : "Save Account"}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={s.card}>
          <Text style={[typography.label, { color: c.muted }]}>Payout Amount (₹)</Text>
          <View style={s.amtRow}>
            <TextInput style={s.amtInput} keyboardType="number-pad" placeholder="0" placeholderTextColor={c.muted} value={amount > 0 ? String(amount) : ""} onChangeText={(t) => setAmount(parseInt(t.replace(/\D/g, ""), 10) || 0)} />
            <Pressable style={s.maxBtn} onPress={() => setAmount(maxPayout)}><Text style={[s.maxBtnText, { color: c.text }]}>Max</Text></Pressable>
          </View>
          <Text style={[s.mutedSmall, { color: c.muted }]}>Eligible: ₹{maxPayout.toLocaleString("en-IN")}</Text>
          {payoutError ? <View style={s.errorBox}><Text style={{ color: c.danger, fontSize: 12 }}>{payoutError}</Text></View> : null}
          <Pressable style={[s.primaryCta, !canPayout && { opacity: 0.5 }]} onPress={() => void requestPayout()} disabled={!canPayout}>
            {busy ? <ActivityIndicator color={c.bg} /> : <Text style={s.primaryCtaText}>{disabledReason ?? "Request Payout"}</Text>}
          </Pressable>
          {disabledReason ? <Text style={[s.mutedSmall, { color: c.muted }]}>{disabledReason}</Text> : null}
        </View>

        {revenueMini ? (
          <View style={[s.card, { flexDirection: "row", justifyContent: "space-between" }]}>
            <View><Text style={[typography.label, { color: c.muted }]}>Total Revenue</Text><Text style={[s.miniVal, { color: c.text }]}>₹{revenueMini.totalRevenue.toLocaleString("en-IN")}</Text></View>
            <View style={{ alignItems: "flex-end" }}><Text style={[typography.label, { color: c.muted }]}>Bookings</Text><Text style={[s.miniVal, { color: c.text }]}>{revenueMini.totalBookings}</Text></View>
          </View>
        ) : null}

        <View style={[s.card, { marginTop: 12 }]}>
          <View style={s.rowBetween}>
            <Text style={[typography.label, { color: c.muted }]}>Payout History</Text>
            <Pressable onPress={() => setHistoryModal(true)}><Text style={[s.link, { color: c.text }]}>View All</Text></Pressable>
          </View>
          {payouts.length === 0 ? <Text style={[s.mutedSmall, { color: c.muted }]}>No payouts yet</Text> : payouts.slice(0, 5).map((p) => {
            const b = badgeForStatus(p.status);
            return (
              <View key={p.id} style={s.historyRow}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontWeight: "700" }}>₹{p.amount.toLocaleString("en-IN")}</Text>
                  <Text style={[s.mutedSmall, { color: c.muted }]}>{p.createdAt.slice(0, 10)} · {p.accountLabel ?? ""}</Text>
                </View>
                <View style={[s.statusBadge, { backgroundColor: b.bg }]}><Text style={{ color: b.fg, fontSize: 9, fontWeight: "800" }}>{b.label}</Text></View>
              </View>
            );
          })}
          <Pressable style={[s.exportLink]} onPress={() => void exportPayoutHistory()}><Text style={[s.exportLinkText, { color: c.text }]}>{pdfBusy ? "Exporting…" : "↑ Export PDF"}</Text></Pressable>
        </View>
      </ScrollView>

      <Modal visible={historyModal} transparent animationType="slide">
        <View style={s.modalWrap}>
          <View style={[s.modalSheet, { backgroundColor: c.surface, borderColor: c.border }]}>
            <View style={s.sheetHeader}>
              <Text style={[typography.label, { color: c.muted }]}>Payout History</Text>
              <Pressable onPress={() => setHistoryModal(false)}><Ionicons name="close" size={24} color={c.text} /></Pressable>
            </View>
            {payouts.length === 0 ? <Text style={[s.mutedSmall, { color: c.muted, padding: 20 }]}>No payouts yet.</Text> : (
              <ScrollView style={{ maxHeight: 360 }}>{payouts.map((p) => {
                const b = badgeForStatus(p.status);
                return (
                  <View key={p.id} style={s.historyRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: c.text, fontWeight: "700" }}>₹{p.amount.toLocaleString("en-IN")}</Text>
                      <Text style={[s.mutedSmall, { color: c.muted }]}>{p.createdAt.slice(0, 10)}</Text>
                      {p.utr ? <Text style={[s.mutedSmall, { color: c.muted }]}>UTR: {p.utr}</Text> : null}
                    </View>
                    <View style={[s.statusBadge, { backgroundColor: b.bg }]}><Text style={{ color: b.fg, fontSize: 9, fontWeight: "800" }}>{b.label}</Text></View>
                  </View>
                );
              })}</ScrollView>
            )}
          </View>
        </View>
      </Modal>
      <ConfirmModal
        visible={alertState !== null}
        onClose={() => setAlertState(null)}
        onConfirm={() => setAlertState(null)}
        title={alertState?.title ?? ""}
        message={alertState?.message ?? ""}
        singleButton
      />
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: ReturnType<typeof useThemeColors>) => StyleSheet.create({
  card: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 14, marginBottom: 12 },
  balanceCard: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 16, padding: 18, marginBottom: 12, marginTop: 8 },
  balanceAmt: { fontSize: 32, fontWeight: "800", marginTop: 8 },
  balanceMeta: { flexDirection: "row", justifyContent: "space-between", marginTop: 14 },
  metaLabel: { fontSize: 10, fontWeight: "700" },
  metaVal: { fontSize: 16, fontWeight: "800", marginTop: 4 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  changeLink: { fontWeight: "700", fontSize: 13 },
  bankRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: c.border },
  bankRowActive: { opacity: 1 },
  bankForm: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 14, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 12, color: c.text, marginTop: 8 },
  amtRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  amtInput: { flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 14, color: c.text, fontSize: 22, fontWeight: "800" },
  maxBtn: { paddingVertical: 14, paddingHorizontal: 20, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  maxBtnText: { fontWeight: "800", fontSize: 13 },
  errorBox: { backgroundColor: "rgba(248,113,113,0.12)", borderRadius: 10, padding: 10, marginTop: 8 },
  primaryCta: { backgroundColor: c.text, paddingVertical: 16, borderRadius: 14, alignItems: "center", marginTop: 12 },
  primaryCtaText: { color: c.bg, fontWeight: "800", fontSize: 15 },
  miniVal: { fontSize: 20, fontWeight: "800", marginTop: 4 },
  historyRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: c.border },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  link: { fontWeight: "700", fontSize: 13 },
  exportLink: { marginTop: 10, alignItems: "center" },
  exportLinkText: { fontWeight: "700", fontSize: 13 },
  mutedSmall: { fontSize: 11, marginTop: 4 },
  successBanner: { padding: 12, borderRadius: 12, backgroundColor: c.surface, marginBottom: 12, borderWidth: 1, borderColor: c.border },
  successText: { color: c.text, fontWeight: "600", textAlign: "center" },
  modalWrap: { flex: 1, justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "75%", borderTopWidth: 1 },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
});