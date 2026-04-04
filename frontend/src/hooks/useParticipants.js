/**
 * Supabase Realtime participant state for voice-trip channel (web).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { EVENTS, tripChannel } from "../../../shared/voiceConstants.js";

function sortParticipants(list, currentUserId) {
  const order = { organizer: 0, admin: 0, co_admin: 1, "co-admin": 1, moderator: 2, member: 3 };
  const uid = String(currentUserId ?? "");
  return [...list].sort((a, b) => {
    if (a.userId === uid) return -1;
    if (b.userId === uid) return 1;
    const ra = order[a.role] ?? 9;
    const rb = order[b.role] ?? 9;
    if (ra !== rb) return ra - rb;
    return a.displayName.localeCompare(b.displayName);
  });
}

/**
 * @param {{ tripId: string, currentUser: { userId: string, displayName?: string, role?: string }, initialRows?: Array<{ userId: string, displayName: string, role: string }>, onKicked?: () => void, onModeChanged?: (mode: 'all'|'staff') => void }} opts
 */
export function useParticipants({ tripId, currentUser, initialRows = [], onKicked, onModeChanged }) {
  const [participants, setParticipants] = useState(() =>
    initialRows.map((r) => ({
      userId: String(r.userId),
      displayName: r.displayName ?? r.userId,
      role: String(r.role ?? "member").toLowerCase().replace(/-/g, "_"),
      isMuted: false,
      isSpeaking: false,
      handRaised: false,
    })),
  );
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    if (!tripId || !supabase) return;
    setParticipants((prev) => {
      const map = new Map(prev.map((p) => [p.userId, p]));
      for (const r of initialRows) {
        const id = String(r.userId);
        if (!map.has(id)) {
          map.set(id, {
            userId: id,
            displayName: r.displayName ?? id,
            role: String(r.role ?? "member").toLowerCase().replace(/-/g, "_"),
            isMuted: false,
            isSpeaking: false,
            handRaised: false,
          });
        }
      }
      return sortParticipants([...map.values()], currentUser?.userId);
    });
  }, [initialRows, tripId, currentUser?.userId]);

  useEffect(() => {
    if (!tripId || !supabase) return;
    const ch = supabase.channel(tripChannel(tripId), { config: { broadcast: { self: true } } });

    const onBroadcast = (event, handler) => {
      ch.on("broadcast", { event }, ({ payload }) => handler(payload ?? {}));
    };

    onBroadcast(EVENTS.ROLE_UPDATED, (p) => {
      const uid = String(p.userId ?? "");
      const nr = p.newRole;
      if (!uid || !nr) return;
      setParticipants((prev) =>
        sortParticipants(
          prev.map((x) => (x.userId === uid ? { ...x, role: String(nr).toLowerCase().replace(/-/g, "_") } : x)),
          currentUser?.userId,
        ),
      );
    });

    onBroadcast(EVENTS.PARTICIPANT_MUTED, (p) => {
      const uid = String(p.userId ?? "");
      const mute = Boolean(p.mute);
      setParticipants((prev) =>
        sortParticipants(
          prev.map((x) => (x.userId === uid ? { ...x, isMuted: mute } : x)),
          currentUser?.userId,
        ),
      );
    });

    onBroadcast(EVENTS.PARTICIPANT_KICKED, (p) => {
      const uid = String(p.userId ?? "");
      setParticipants((prev) => sortParticipants(prev.filter((x) => x.userId !== uid), currentUser?.userId));
      if (uid === String(currentUser?.userId)) onKicked?.();
    });

    onBroadcast(EVENTS.MODE_CHANGED, (p) => {
      const m = p.mode;
      if (m === "all" || m === "staff") onModeChanged?.(m);
    });

    onBroadcast(EVENTS.RAISE_HAND, (p) => {
      const uid = String(p.userId ?? "");
      if (!uid) return;
      setParticipants((prev) =>
        sortParticipants(
          prev.map((x) => (x.userId === uid ? { ...x, handRaised: true } : x)),
          currentUser?.userId,
        ),
      );
    });

    onBroadcast(EVENTS.LOWER_HAND, (p) => {
      const uid = String(p.userId ?? "");
      if (!uid) return;
      setParticipants((prev) =>
        sortParticipants(
          prev.map((x) => (x.userId === uid ? { ...x, handRaised: false } : x)),
          currentUser?.userId,
        ),
      );
    });

    onBroadcast(EVENTS.SPEAK_APPROVED, (p) => {
      const uid = String(p.userId ?? "");
      if (!uid) return;
      setParticipants((prev) =>
        sortParticipants(
          prev.map((x) =>
            x.userId === uid ? { ...x, handRaised: false, isSpeaking: true } : x,
          ),
          currentUser?.userId,
        ),
      );
      setTimeout(() => {
        setParticipants((prev) =>
          sortParticipants(
            prev.map((x) => (x.userId === uid ? { ...x, isSpeaking: false } : x)),
            currentUser?.userId,
          ),
        );
      }, 1600);
    });

    onBroadcast(EVENTS.WAITING_SPEAK_APPROVE, (p) => {
      const uid = String(p.memberId ?? p.userId ?? "");
      if (!uid) return;
      setParticipants((prev) =>
        sortParticipants(
          prev.map((x) => (x.userId === uid ? { ...x, handRaised: false, isSpeaking: true } : x)),
          currentUser?.userId,
        ),
      );
      setTimeout(() => {
        setParticipants((prev) =>
          sortParticipants(
            prev.map((x) => (x.userId === uid ? { ...x, isSpeaking: false } : x)),
            currentUser?.userId,
          ),
        );
      }, 1600);
    });

    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") setSubscribed(true);
    });

    return () => {
      setSubscribed(false);
      supabase.removeChannel(ch);
    };
  }, [tripId, currentUser?.userId, onKicked, onModeChanged]);

  const setSpeaking = useCallback((userId, speaking) => {
    const uid = String(userId);
    setParticipants((prev) =>
      sortParticipants(
        prev.map((x) => (x.userId === uid ? { ...x, isSpeaking: speaking } : x)),
        currentUser?.userId,
      ),
    );
  }, [currentUser?.userId]);

  const merged = useMemo(
    () => sortParticipants(participants, currentUser?.userId),
    [participants, currentUser?.userId],
  );

  return { participants: merged, subscribed, setSpeaking, setParticipants };
}

export async function broadcastRaiseHand(tripId, userId, displayName, raised) {
  if (!supabase) return;
  const ch = supabase.channel(tripChannel(tripId), { config: { broadcast: { self: true } } });
  await new Promise((resolve, reject) => {
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
      if (status === "CHANNEL_ERROR") reject(new Error("channel"));
    });
  });
  await ch.send({
    type: "broadcast",
    event: raised ? EVENTS.RAISE_HAND : EVENTS.LOWER_HAND,
    payload: { userId: String(userId), displayName: displayName ?? String(userId) },
  });
  await supabase.removeChannel(ch);
}
