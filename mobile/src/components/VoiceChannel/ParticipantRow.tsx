import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { ROLE_COLORS, ROLE_LABELS } from "../../../shared/voiceConstants.js";

type Participant = {
  userId: string;
  displayName: string;
  role: string;
  isMuted?: boolean;
  isSpeaking?: boolean;
  handRaised?: boolean;
};

type Props = {
  participant: Participant;
  isCurrentUser: boolean;
  perms?: { canModerate?: boolean };
  onMute?: (userId: string, mute: boolean) => void;
  onKick?: (userId: string) => void;
  onAssignRole?: (userId: string, role: string) => void;
};

function normRole(r: string) {
  return String(r ?? "member").toLowerCase().replace(/-/g, "_");
}

export function ParticipantRow({ participant, isCurrentUser, perms, onMute, onKick, onAssignRole }: Props) {
  const { userId, displayName, role, isMuted, isSpeaking, handRaised } = participant;
  const rc = ROLE_COLORS[normRole(role) as keyof typeof ROLE_COLORS] ?? ROLE_COLORS.member;
  const label = ROLE_LABELS[normRole(role) as keyof typeof ROLE_LABELS] ?? "Member";
  const initial = (displayName || "?").slice(0, 1).toUpperCase();
  const showAdmin =
    perms?.canModerate &&
    !isCurrentUser &&
    !["organizer", "admin"].includes(normRole(role));

  let status = "• Idle";
  let statusColor = "rgba(255,255,255,0.35)";
  if (isSpeaking) {
    status = "• Speaking";
    statusColor = "#34C759";
  } else if (isMuted) {
    status = "• Muted";
  }

  return (
    <View style={[styles.row, isSpeaking && styles.rowSpeaking]}>
      <View style={[styles.avatar, isSpeaking && styles.avatarSpeak]}>
        <Text style={styles.avatarText}>{initial}</Text>
      </View>
      <View style={styles.mid}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {displayName}
          </Text>
          {handRaised ? <Text style={styles.hand}> 🖐</Text> : null}
        </View>
        <Text style={[styles.status, { color: statusColor }]}>{status}</Text>
        {showAdmin ? (
          <View style={styles.admin}>
            <Pressable onPress={() => onMute?.(userId, !isMuted)} style={styles.mini}>
              <Text style={styles.miniText}>{isMuted ? "Unmute" : "Mute"}</Text>
            </Pressable>
            <Pressable onPress={() => onKick?.(userId)} style={styles.mini}>
              <Text style={[styles.miniText, { color: "#f87171" }]}>Block</Text>
            </Pressable>
            <View style={styles.roleRow}>
              {(["member", "moderator", "co_admin"] as const).map((r) => (
                <Pressable
                  key={r}
                  onPress={() => onAssignRole?.(userId, r)}
                  style={[styles.rolePick, normRole(role) === r && styles.rolePickOn]}
                >
                  <Text style={[styles.rolePickText, normRole(role) === r && styles.rolePickTextOn]}>{r.replace("_", "-")}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </View>
      <View style={[styles.badge, { borderColor: rc, backgroundColor: `${rc}22` }]}>
        <Text style={[styles.badgeText, { color: rc }]}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2C2C2E",
    backgroundColor: "#000",
  },
  rowSpeaking: { borderLeftWidth: 3, borderLeftColor: "#34C759" },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: "#2C2C2E",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarSpeak: {
    shadowColor: "#34C759",
    shadowOpacity: 0.5,
    shadowRadius: 6,
  },
  avatarText: { fontWeight: "800", color: "rgba(255,255,255,0.55)" },
  mid: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  name: { fontWeight: "700", fontSize: 14, color: "#fff", flex: 1 },
  hand: { fontSize: 14 },
  status: { fontSize: 11, marginTop: 2 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: { fontSize: 9, fontWeight: "800" },
  admin: { marginTop: 8, gap: 6 },
  mini: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  miniText: { fontSize: 10, fontWeight: "700", color: "rgba(255,255,255,0.75)" },
  roleRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  rolePick: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  rolePickOn: { backgroundColor: "#fff", borderColor: "#fff" },
  rolePickText: { fontSize: 9, fontWeight: "800", color: "rgba(255,255,255,0.35)", textTransform: "capitalize" },
  rolePickTextOn: { color: "#000" },
});
