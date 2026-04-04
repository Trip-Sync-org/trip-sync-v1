import React, { useEffect, useMemo, useRef, useState } from "react";
import { VOICE_PERMISSIONS } from "../../../../shared/voiceConstants.js";
import { useParticipants, broadcastRaiseHand } from "../../hooks/useParticipants.js";
import { useVoiceChannel } from "../../hooks/useVoiceChannel.js";
import { setVoiceAuthToken, muteParticipant, kickParticipant, assignRole, switchMode } from "../../services/voiceApi.js";
import { ParticipantRow } from "./ParticipantRow.jsx";
import "./VoiceChannel.css";

function normalizeRole(r) {
  const x = String(r ?? "member").toLowerCase().replace(/-/g, "_");
  if (x === "admin") return "organizer";
  return x;
}

/**
 * @param {{ tripId: string, currentUser: { userId: string, displayName?: string, role?: string }, members: Array<{ id?: string, userId?: number, name?: string, role?: string }>, memberCount?: number, isExpoGo?: boolean }} props
 */
export function VoiceChannel({ tripId, currentUser, members, memberCount, isExpoGo = false }) {
  const uid = String(currentUser?.userId ?? "");
  const role = normalizeRole(currentUser?.role);
  const perms = VOICE_PERMISSIONS[role] || VOICE_PERMISSIONS.member;

  const initialRows = useMemo(
    () =>
      (members || []).map((m) => {
        const id = m.id?.replace(/^m/, "") ?? m.userId;
        return {
          userId: String(id ?? ""),
          displayName: m.name ?? String(id),
          role: normalizeRole(m.role),
        };
      }),
    [members],
  );

  const [uiMode, setUiMode] = useState("staff");
  const disconnectRef = useRef(() => {});

  useEffect(() => {
    setVoiceAuthToken(uid, currentUser?.displayName, currentUser?.role, tripId);
  }, [uid, currentUser?.displayName, currentUser?.role, tripId]);

  const { participants, setSpeaking } = useParticipants({
    tripId,
    currentUser: { userId: uid, displayName: currentUser?.displayName, role },
    initialRows,
    onModeChanged: (m) => {
      if (m === "staff" && role === "member") disconnectRef.current?.();
    },
  });

  const voice = useVoiceChannel({
    tripId,
    userId: uid,
    displayName: currentUser?.displayName ?? uid,
    role,
    onLocalSpeaking: (s) => setSpeaking(uid, s),
  });

  useEffect(() => {
    disconnectRef.current = () => {
      void voice.disconnect();
    };
  }, [voice.disconnect]);

  const myHand = participants.find((p) => p.userId === uid)?.handRaised ?? false;

  const onToggleMode = async (mode) => {
    setUiMode(mode);
    try {
      await switchMode(mode === "staff" ? "staff" : "all");
    } catch {
      /* optional */
    }
  };

  const onRaise = async () => {
    await broadcastRaiseHand(tripId, uid, currentUser?.displayName ?? uid, !myHand);
  };

  const active = memberCount ?? participants.length;

  return (
    <div className="vc-card">
      <div className="vc-header">
        <div>
          <div className="vc-title">GROUP COMMS</div>
          <div className="vc-sub">{active} members active</div>
        </div>
        <div className={`vc-badge ${voice.isConnected ? "vc-badge-on" : ""}`}>
          {voice.isConnected ? "Voice Connected" : "Not Connected"}
        </div>
      </div>

      {isExpoGo ? (
        <div className="vc-warn">
          Expo Go has no WebRTC. Voice controls and Realtime sync still work. Use a dev build for live audio.
        </div>
      ) : null}

      {voice.error ? <div className="vc-warn">{voice.error}</div> : null}

      <div className="vc-tabs">
        <button
          type="button"
          className={`vc-tab ${uiMode === "open" ? "vc-tab-on" : ""}`}
          disabled={!perms.canSwitchMode}
          onClick={() => void onToggleMode("open")}
        >
          Talk All
        </button>
        <button
          type="button"
          className={`vc-tab ${uiMode === "staff" ? "vc-tab-on" : ""}`}
          disabled={!perms.canSwitchMode}
          onClick={() => void onToggleMode("staff")}
        >
          Staff Talk
        </button>
      </div>

      <div className="vc-actions">
        {!voice.isConnected ? (
          <button type="button" className="vc-btn-join" disabled={voice.isConnecting} onClick={() => void voice.connect()}>
            {voice.isConnecting ? "Connecting…" : "Join Voice Channel"}
          </button>
        ) : (
          <>
            <button type="button" className="vc-btn-disconnect" onClick={() => void voice.disconnect()}>
              Disconnect
            </button>
            <button
              type="button"
              className={`vc-btn-mute ${!voice.isMuted ? "vc-btn-mute-hot" : ""}`}
              onClick={() => voice.toggleMute()}
            >
              {voice.isMuted ? "Unmute" : "Mute"}
            </button>
          </>
        )}
      </div>

      {voice.isConnected ? (
        <button type="button" className="vc-raise" onClick={() => void onRaise()}>
          {myHand ? "Lower Hand ✋" : "Raise Hand (Request to Speak)"}
        </button>
      ) : null}

      <div className="vc-list">
        {participants.map((p) => (
          <ParticipantRow
            key={p.userId}
            participant={p}
            isCurrentUser={p.userId === uid}
            perms={{
              canModerate: Boolean(perms.canMute || perms.canKickFromVoice || perms.canAssignRole),
            }}
            onMute={async (id, mute) => {
              try {
                await muteParticipant(id, mute);
              } catch (e) {
                console.warn(e);
              }
            }}
            onKick={async (id) => {
              try {
                await kickParticipant(id, true);
              } catch (e) {
                console.warn(e);
              }
            }}
            onAssignRole={async (id, r) => {
              try {
                await assignRole(id, r);
              } catch (e) {
                console.warn(e);
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}
