import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiFetch, readApiErrorMessage } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { colors, typography } from "../theme";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { navigateToRootStack } from "../navigation/navigateRoot";
import { useOrganizerPaymentsSocket } from "../hooks/useOrganizerPaymentsSocket";
import { buildPayoutHistoryHtml, shareRevenuePdf } from "../lib/revenuePdf";

const TEAL = "#00E5B0";

type Balance = {
  eligibleForPayout: number;
  totalPaidOut: number;
  pendingPayout: number;
  availableBalance: number;
};

type RevenueMini = {
  totalGrossRevenue: number;
  platformFee: number;
  eligibleForPayout: number;
};

type PayoutDetailRow = {
  payout_method?: string;
  upi_id?: string | null;
  bank_name?: string | null;
  bank_account_number_masked?: string | null;
};

type PayoutHistoryRow = {
  id: number;
  amount?: number;
  status?: string;
  requested_at?: string;
  processed_at?: string | null;
  payout_method_snapshot?: string | null;
  failure_reason?: string | null;
};

export function PayoutScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const historySectionY = useRef(0);

  const [balance, setBalance] = useState<Balance>({
    eligibleForPayout: 0,
    totalPaidOut: 0,
    pendingPayout: 0,
    availableBalance: 0,
  });
  const [mini, setMini] = useState<RevenueMini>({
    totalGrossRevenue: 0,
    platformFee: 0,
    eligibleForPayout: 0,
  });
  const [payoutDetails, setPayoutDetails] = useState<PayoutDetailRow | null>(null);
  const [history, setHistory] = useState<PayoutHistoryRow[]>([]);
  const [amountStr, setAmountStr] = useState("");
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const uid = user?.id != null ? Number(user.id) : NaN;

  const fetchBalanceOnly = useCallback(async () => {
    if (!Number.isFinite(uid)) return;
    const res = await apiFetch(`/api/organizer/payout/balance/${uid}`);
    if (!res.ok) return;
    const j = (await res.json()) as Balance;
    setBalance({
      eligibleForPayout: Number(j.eligibleForPayout ?? 0),
      totalPaidOut: Number(j.totalPaidOut ?? 0),
      pendingPayout: Number(j.pendingPayout ?? 0),
      availableBalance: Number(j.availableBalance ?? 0),
    });
  }, [uid]);

  const loadAll = useCallback(async () => {
    if (!Number.isFinite(uid)) return;
    setLoading(true);
    setError(null);
    try {
      const [revRes, histRes, detRes, balRes] = await Promise.all([
        apiFetch(`/api/organizer/revenue/${uid}`),
        apiFetch(`/api/organizer/payout/history/${uid}`),
        apiFetch(`/api/organizer/payout-details/${uid}`),
        apiFetch(`/api/organizer/payout/balance/${uid}`),
      ]);
      if (revRes.ok) {
        const r = (await revRes.json()) as RevenueMini;
        setMini({
          totalGrossRevenue: Number(r.totalGrossRevenue ?? 0),
          platformFee: Number(r.platformFee ?? 0),
          eligibleForPayout: Number(r.eligibleForPayout ?? 0),
        });
      }
      if (balRes.ok) {
        const j = (await balRes.json()) as Balance;
        setBalance({
          eligibleForPayout: Number(j.eligibleForPayout ?? 0),
          totalPaidOut: Number(j.totalPaidOut ?? 0),
          pendingPayout: Number(j.pendingPayout ?? 0),
          availableBalance: Number(j.availableBalance ?? 0),
        });
      }
      if (histRes.ok) setHistory((await histRes.json()) as PayoutHistoryRow[]);
      if (detRes.ok) {
        const row = await detRes.json();
        setPayoutDetails(row && typeof row === "object" ? (row as PayoutDetailRow) : null);
      }
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const t = setInterval(() => {
      void fetchBalanceOnly();
    }, 30000);
    return () => clearInterval(t);
  }, [fetchBalanceOnly]);

  useOrganizerPaymentsSocket({
    userId: Number.isFinite(uid) ? uid : undefined,
    role: user?.role,
    onPayoutUpdated: () => {
      void loadAll();
    },
  });

  useLayoutEffect(() => {
    navigation.setOptions({
      title: "Payout Dashboard",
      headerRight: () => (
        <Pressable
          onPress={() =>
            scrollRef.current?.scrollTo({ y: Math.max(0, historySectionY.current - 12), animated: true })
          }
          hitSlop={12}
        >
          <Text style={{ color: TEAL, fontWeight: "700", fontSize: 15 }}>History</Text>
        </Pressable>
      ),
    });
  }, [navigation]);

  const hasMethod = payoutDetails != null;
  const method = String(payoutDetails?.payout_method ?? "") === "bank" ? "bank" : "upi";
  const methodSummary =
    method === "upi"
      ? `UPI — ${String(payoutDetails?.upi_id ?? "").trim()}`
      : `Bank — ${String(payoutDetails?.bank_name ?? "").trim()} ${String(payoutDetails?.bank_account_number_masked ?? "").trim()}`;

  const avail = balance.availableBalance;
  const pendingAmt = balance.pendingPayout;
  const hasPending = pendingAmt > 0.01;

  const parsedAmount = parseFloat(amountStr.replace(/,/g, ""));
  const amount = Number.isFinite(parsedAmount) ? parsedAmount : NaN;
  const validAmount =
    Number.isFinite(amount) && amount >= 100 && amount <= avail + 0.001 && !hasPending;

  const setMax = () => setAmountStr(avail > 0 ? String(Math.floor(avail * 100) / 100) : "");

  const submitRequest = async () => {
    if (!Number.isFinite(uid) || !Number.isFinite(amount)) return;
    setRequesting(true);
    setError(null);
    try {
      const res = await apiFetch("/api/organizer/payout/request", {
        method: "POST",
        body: JSON.stringify({ organizerId: uid, amount }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        availableBalance?: number;
        pendingPayout?: number;
        eligibleForPayout?: number;
        totalPaidOut?: number;
      };
      if (!res.ok) {
        setError(body.error ?? (await readApiErrorMessage(res)));
        return;
      }
      setConfirmOpen(false);
      setAmountStr("");
      setSuccess(`✓ Payout of ₹${amount.toLocaleString("en-IN")} requested! Processing in 2-3 days.`);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setRequesting(false);
    }
  };

  const exportHistoryPdf = async () => {
    try {
      const html = buildPayoutHistoryHtml(
        history as unknown as Array<Record<string, unknown>>,
        user?.name ?? "Organizer",
        new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
      );
      await shareRevenuePdf(html);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert("Export failed", msg || "Could not generate or share PDF.");
      setError(msg);
    }
  };

  const goProfile = () => {
    navigateToRootStack(navigation, "Main", { screen: "ProfileTab" });
  };

  const goRevenue = () => {
    navigateToRootStack(navigation, "Main", {
      screen: "MyTripsTab",
      params: { openTab: "Revenue Analytics" },
    });
  };

  const disabledReason = !hasMethod
    ? "Add payout method first"
    : hasPending
      ? "Pending request in progress"
      : Number.isFinite(amount) && amount < 100
        ? "Minimum ₹100"
        : Number.isFinite(amount) && amount > avail + 0.01
          ? "Insufficient balance"
          : !Number.isFinite(amount) || amount <= 0
            ? "Enter an amount"
            : null;

  const primaryLabel =
    disabledReason != null
      ? disabledReason
      : `Request Payout of ₹${Number.isFinite(amount) ? amount.toLocaleString("en-IN") : "0"}`;

  const badgeForStatus = (s: string) => {
    const x = s.toLowerCase();
    if (x === "completed") return { bg: "rgba(16,185,129,0.25)", fg: "#34d399", label: "COMPLETED ✓" };
    if (x === "processing") return { bg: "rgba(59,130,246,0.25)", fg: "#60a5fa", label: "PROCESSING" };
    if (x === "pending") return { bg: "rgba(245,158,11,0.25)", fg: "#fbbf24", label: "PENDING" };
    if (x === "failed") return { bg: "rgba(248,113,113,0.25)", fg: "#f87171", label: "FAILED" };
    return { bg: "rgba(255,255,255,0.1)", fg: "#fff", label: s.toUpperCase() };
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32, paddingHorizontal: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {loading ? (
          <View style={{ paddingVertical: 40, alignItems: "center" }}>
            <ActivityIndicator color={TEAL} />
          </View>
        ) : null}

        {success ? (
          <View style={styles.successBanner}>
            <Text style={styles.successText}>{success}</Text>
          </View>
        ) : null}

        {/* Section A — Balance */}
        <View style={styles.balanceCard}>
          <Text style={typography.label}>AVAILABLE BALANCE</Text>
          <Text style={styles.balanceAmt}>₹ {avail.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</Text>
          <Text style={styles.balanceSub}>
            Eligible: ₹{balance.eligibleForPayout.toLocaleString("en-IN")} · Paid: ₹
            {balance.totalPaidOut.toLocaleString("en-IN")}
          </Text>
          <Text style={styles.balanceSub}>Pending: ₹{pendingAmt.toLocaleString("en-IN")}</Text>
        </View>

        {/* Section B — Request */}
        <Text style={[typography.label, { marginTop: 24, marginBottom: 8 }]}>REQUEST PAYOUT</Text>
        <View style={styles.amountRow}>
          <Text style={styles.rupee}>₹</Text>
          <TextInput
            style={styles.amountInput}
            placeholder="0"
            placeholderTextColor={colors.muted2}
            keyboardType="decimal-pad"
            value={amountStr}
            onChangeText={setAmountStr}
          />
          <Pressable style={styles.maxBtn} onPress={setMax}>
            <Text style={styles.maxBtnText}>MAX</Text>
          </Pressable>
        </View>

        {Number.isFinite(amount) && amount < 100 && amountStr.length > 0 ? (
          <Text style={styles.err}>Minimum payout is ₹100</Text>
        ) : null}
        {Number.isFinite(amount) && amount > avail + 0.01 ? (
          <Text style={styles.err}>Exceeds available balance</Text>
        ) : null}
        {hasPending ? <Text style={styles.warn}>You have a pending payout request</Text> : null}
        {Number.isFinite(amount) && validAmount ? (
          <Text style={styles.ok}>✓ Ready to request</Text>
        ) : null}
        {error ? <Text style={styles.err}>{error}</Text> : null}

        <View style={styles.methodBox}>
          <Text style={styles.methodLabel}>{hasMethod ? `Via: ${methodSummary}` : "No payout method saved"}</Text>
          <Pressable onPress={goProfile}>
            <Text style={styles.changeLink}>Change →</Text>
          </Pressable>
        </View>

        <Pressable
          style={[styles.primaryBtn, (!validAmount || !hasMethod || hasPending || requesting) && styles.primaryBtnDis]}
          disabled={!validAmount || !hasMethod || hasPending || requesting}
          onPress={() => {
            setError(null);
            if (!validAmount || !hasMethod || hasPending) return;
            setConfirmOpen(true);
          }}
        >
          {requesting ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.primaryBtnText}>{primaryLabel}</Text>
          )}
        </Pressable>

        {/* Section C — Revenue mini */}
        <Text style={[typography.label, { marginTop: 28, marginBottom: 10 }]}>REVENUE (SUMMARY)</Text>
        <View style={styles.miniGrid}>
          <View style={styles.miniCell}>
            <Text style={styles.miniVal}>₹{mini.totalGrossRevenue.toLocaleString("en-IN")}</Text>
            <Text style={styles.miniLbl}>Gross</Text>
          </View>
          <View style={styles.miniCell}>
            <Text style={styles.miniVal}>₹{mini.platformFee.toLocaleString("en-IN")}</Text>
            <Text style={styles.miniLbl}>Platform fee (10%)</Text>
          </View>
          <View style={styles.miniCell}>
            <Text style={[styles.miniVal, { color: TEAL }]}>₹{mini.eligibleForPayout.toLocaleString("en-IN")}</Text>
            <Text style={styles.miniLbl}>Eligible for you</Text>
          </View>
        </View>
        <Pressable onPress={goRevenue} style={{ marginBottom: 8 }}>
          <Text style={styles.link}>See full breakdown →</Text>
        </Pressable>

        {/* Section D — History */}
        <View
          onLayout={(e) => {
            historySectionY.current = e.nativeEvent.layout.y;
          }}
          style={{ marginTop: 16 }}
        >
          <View style={styles.historyHeader}>
            <Text style={typography.label}>PAYOUT HISTORY</Text>
            <Pressable onPress={() => void exportHistoryPdf()} hitSlop={8}>
              <Text style={styles.exportLink}>↑ Export PDF</Text>
            </Pressable>
          </View>

          {history.length === 0 ? (
            <Text style={styles.empty}>
              No payout requests yet.{"\n"}Request your first payout above.
            </Text>
          ) : (
            history.map((p) => {
              const b = badgeForStatus(String(p.status ?? ""));
              return (
                <View key={p.id} style={styles.histRow}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={styles.histAmt}>₹{Number(p.amount ?? 0).toLocaleString("en-IN")}</Text>
                      <View style={[styles.badge, { backgroundColor: b.bg }]}>
                        <Text style={[styles.badgeTxt, { color: b.fg }]}>{b.label}</Text>
                      </View>
                    </View>
                    <Text style={styles.histMeta}>{p.payout_method_snapshot ?? "—"}</Text>
                    <Text style={styles.histMeta}>
                      Requested:{" "}
                      {p.requested_at
                        ? new Date(p.requested_at).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                    </Text>
                    {p.processed_at ? (
                      <Text style={styles.histMeta}>
                        Processed:{" "}
                        {new Date(p.processed_at).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </Text>
                    ) : null}
                    {String(p.status ?? "").toLowerCase() === "failed" && p.failure_reason ? (
                      <Text style={styles.errSmall}>{p.failure_reason}</Text>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      <Modal visible={confirmOpen} transparent animationType="slide">
        <View style={styles.sheetOverlay}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setConfirmOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.sheetTitle}>Confirm Payout Request</Text>
            <Text style={styles.sheetRow}>
              Amount: <Text style={styles.sheetEm}>₹ {Number.isFinite(amount) ? amount.toLocaleString("en-IN") : "—"}</Text>
            </Text>
            <Text style={styles.sheetMuted}>Platform fee already deducted</Text>
            <Text style={styles.sheetRow}>Via: {methodSummary}</Text>
            <Text style={styles.sheetMuted}>Timeline: 2–3 business days</Text>
            <View style={{ flexDirection: "row", gap: 12, marginTop: 20 }}>
              <Pressable style={styles.btnWhite} onPress={() => setConfirmOpen(false)}>
                <Text style={styles.btnWhiteText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.btnTeal}
                onPress={() => void submitRequest()}
                disabled={requesting}
              >
                {requesting ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={styles.btnTealText}>Confirm & Request</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  balanceCard: {
    backgroundColor: "#111111",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(0,229,176,0.35)",
  },
  balanceAmt: { fontSize: 32, fontWeight: "800", color: TEAL, marginTop: 8 },
  balanceSub: { color: colors.muted, marginTop: 6, fontSize: 14 },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rupee: { color: colors.text, fontSize: 20, fontWeight: "700", marginRight: 4 },
  amountInput: { flex: 1, color: colors.text, fontSize: 22, fontWeight: "700", paddingVertical: 14 },
  maxBtn: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "rgba(0,229,176,0.15)", borderRadius: 8 },
  maxBtnText: { color: TEAL, fontWeight: "800", fontSize: 13 },
  methodBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 16,
    marginBottom: 12,
  },
  methodLabel: { color: colors.text, flex: 1, fontSize: 14 },
  changeLink: { color: TEAL, fontWeight: "700" },
  primaryBtn: {
    backgroundColor: TEAL,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryBtnDis: { backgroundColor: "#333" },
  primaryBtnText: { color: "#000", fontWeight: "800", fontSize: 16 },
  miniGrid: { flexDirection: "row", gap: 8 },
  miniCell: {
    flex: 1,
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
  },
  miniVal: { color: colors.text, fontWeight: "800", fontSize: 15 },
  miniLbl: { color: colors.muted, fontSize: 10, marginTop: 4, textAlign: "center" },
  link: { color: TEAL, fontWeight: "700", marginTop: 10 },
  historyHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  exportLink: { color: TEAL, fontWeight: "700", fontSize: 13 },
  empty: { color: colors.muted, lineHeight: 22, marginBottom: 16 },
  histRow: {
    backgroundColor: "#111",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  histAmt: { color: colors.text, fontSize: 18, fontWeight: "800" },
  histMeta: { color: colors.muted, fontSize: 12, marginTop: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeTxt: { fontSize: 10, fontWeight: "800" },
  err: { color: colors.danger, marginTop: 6, fontSize: 13 },
  errSmall: { color: colors.danger, marginTop: 4, fontSize: 12 },
  warn: { color: colors.warn, marginTop: 6, fontSize: 13 },
  ok: { color: colors.success, marginTop: 6, fontSize: 13 },
  successBanner: {
    backgroundColor: "rgba(16,185,129,0.15)",
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  successText: { color: colors.success, fontWeight: "600" },
  sheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  sheet: {
    backgroundColor: "#111",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: "800", marginBottom: 12 },
  sheetRow: { color: colors.text, marginTop: 6, fontSize: 15 },
  sheetEm: { fontWeight: "800", color: TEAL },
  sheetMuted: { color: colors.muted, marginTop: 4, fontSize: 13 },
  btnWhite: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnWhiteText: { color: "#000", fontWeight: "800" },
  btnTeal: {
    flex: 1,
    backgroundColor: TEAL,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnTealText: { color: "#000", fontWeight: "800" },
});
