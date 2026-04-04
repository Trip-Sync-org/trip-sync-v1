import React from "react";
/* role colors align with shared ROLE_COLORS — local for JSX */
import "./VoiceChannel.css";

const ROLE_STYLES = {
  organizer: { color: "#F5A623", border: "rgba(245,166,35,0.35)", bg: "rgba(245,166,35,0.12)" },
  admin: { color: "#F5A623", border: "rgba(245,166,35,0.35)", bg: "rgba(245,166,35,0.12)" },
  co_admin: { color: "#7B61FF", border: "rgba(123,97,255,0.35)", bg: "rgba(123,97,255,0.12)" },
  "co-admin": { color: "#7B61FF", border: "rgba(123,97,255,0.35)", bg: "rgba(123,97,255,0.12)" },
  moderator: { color: "#34C759", border: "rgba(52,199,89,0.35)", bg: "rgba(52,199,89,0.12)" },
  member: { color: "#8E8E93", border: "rgba(142,142,147,0.35)", bg: "rgba(142,142,147,0.08)" },
};

function labelForRole(role) {
  const r = String(role ?? "member").toLowerCase();
  if (r === "organizer" || r === "admin") return "Organizer";
  if (r === "co_admin" || r === "co-admin") return "Co-Admin";
  if (r === "moderator") return "Moderator";
  return "Member";
}

export function ParticipantRow({ participant, isCurrentUser, perms, onMute, onKick, onAssignRole }) {
  const { userId, displayName, role, isMuted, isSpeaking, handRaised } = participant;
  const rs = ROLE_STYLES[String(role).toLowerCase()] || ROLE_STYLES.member;
  const initial = (displayName || "?").slice(0, 1).toUpperCase();
  const showAdmin =
    perms?.canModerate &&
    !isCurrentUser &&
    String(role).toLowerCase() !== "organizer" &&
    String(role).toLowerCase() !== "admin";

  let status = "• Idle";
  let statusClass = "vc-status-idle";
  if (isSpeaking) {
    status = "• Speaking";
    statusClass = "vc-status-speak";
  } else if (isMuted) {
    status = "• Muted";
    statusClass = "vc-status-muted";
  }

  return (
    <div className={`vc-participant ${isSpeaking ? "vc-participant-speaking" : ""}`}>
      <div className={`vc-avatar ${isSpeaking ? "vc-avatar-speak" : ""}`}>{initial}</div>
      <div className="vc-participant-mid">
        <div className="vc-name-row">
          <span className="vc-name">{displayName || userId}</span>
          {handRaised ? <span className="vc-hand">🖐</span> : null}
        </div>
        <span className={statusClass}>{status}</span>
        {showAdmin ? (
          <div className="vc-admin-row">
            <button type="button" className="vc-mini" onClick={() => onMute?.(userId, !isMuted)}>
              {isMuted ? "Unmute" : "Mute"}
            </button>
            <button type="button" className="vc-mini vc-mini-danger" onClick={() => onKick?.(userId)}>
              Block
            </button>
            <div className="vc-role-picks">
              {["member", "moderator", "co_admin"].map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`vc-role-pick ${String(role).replace(/-/g, "_") === r ? "on" : ""}`}
                  onClick={() => onAssignRole?.(userId, r)}
                >
                  {r.replace("_", "-")}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div
        className="vc-role-badge"
        style={{ color: rs.color, borderColor: rs.border, background: rs.bg }}
      >
        {labelForRole(role)}
      </div>
    </div>
  );
}
