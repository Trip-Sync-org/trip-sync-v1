import React, { useEffect, useCallback, useRef } from 'react';
import { View, TouchableOpacity, Text, Alert, StyleSheet } from 'react-native';
import useTripVoiceStore from '../store/useTripVoiceStore';

// LiveKit imports — only available in a dev/production build (not Expo Go)
let useRoom = null;
let AudioSession = null;
try {
  const lk = require('@livekit/react-native');
  useRoom = lk.useRoom;
  AudioSession = lk.AudioSession;
} catch (_) {
  // Expo Go or package not installed — voice will be disabled gracefully
}

const SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL || 'https://socket.tripsync.live';
const LIVEKIT_WS_URL = 'wss://voice.tripsync.live';

/**
 * VoiceController
 *
 * Drop-in replacement for the old WebRTC peer-to-peer voice.
 * Uses LiveKit SFU — no peer connections managed in the app.
 *
 * Props:
 *   tripId  — numeric or string trip id (used as LiveKit room name)
 *   userId  — numeric user id (used as LiveKit participant identity)
 *   isMuted — controlled mute state from parent (LiveTripScreen member state)
 *   onVoiceRidersChange — (riders: number[]) => void  — called when participant list changes
 */
export default function VoiceController({ tripId, userId, isMuted, onVoiceRidersChange }) {
  const { status, isSpeakerOn, setStatus, toggleSpeaker } = useTripVoiceStore();
  const roomRef = useRef(null);
  const livekitAvailable = useRoom != null;

  // Initialise LiveKit room hook (only when package is available)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const room = livekitAvailable ? useRoom() : null;

  // Keep roomRef in sync so callbacks can access it without stale closure
  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  // Start/stop audio session
  useEffect(() => {
    if (!livekitAvailable || !AudioSession) return;
    AudioSession.startAudioSession();
    return () => {
      AudioSession.stopAudioSession();
    };
  }, [livekitAvailable]);

  // Fetch token and connect to LiveKit room
  const connectToVoice = useCallback(async () => {
    if (!livekitAvailable || !room) {
      Alert.alert(
        'Voice unavailable',
        'Build the app with npx expo run:android to enable LiveKit voice.',
      );
      return;
    }
    try {
      const response = await fetch(`${SOCKET_URL}/get-voice-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName: String(tripId),
          participantName: String(userId),
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Token request failed (${response.status})`);
      }
      const { token } = await response.json();

      await room.connect(LIVEKIT_WS_URL, token, {
        audio: true,
        video: false,
        adaptiveStream: false,
        dynacast: false,
      });

      console.log('[voice] connected to LiveKit room:', tripId);
    } catch (err) {
      console.error('[voice] connection error:', err);
      Alert.alert('Voice Error', err?.message || 'Could not connect to voice channel. Please try again.');
      setStatus('IDLE');
    }
  }, [tripId, userId, room, livekitAvailable, setStatus]);

  // React to status changes
  useEffect(() => {
    if (status === 'CONNECTED') {
      void connectToVoice();
    } else if (status === 'DISCONNECTED' || status === 'IDLE') {
      if (room && room.state !== 'disconnected') {
        room.disconnect();
        console.log('[voice] disconnected from LiveKit room');
      }
    }
  }, [status]); // intentionally only status — connectToVoice is stable

  // Sync mute state into LiveKit local participant
  useEffect(() => {
    if (!room?.localParticipant) return;
    room.localParticipant.setMicrophoneEnabled(!isMuted).catch((e) => {
      console.warn('[voice] setMicrophoneEnabled error:', e);
    });
  }, [isMuted, room]);

  // Track remote participants → notify parent
  useEffect(() => {
    if (!room) return;

    const updateRiders = () => {
      const ids = [];
      room.remoteParticipants.forEach((p) => {
        const uid = Number(p.identity);
        if (Number.isFinite(uid)) ids.push(uid);
      });
      onVoiceRidersChange?.(ids);
    };

    room.on('participantConnected', updateRiders);
    room.on('participantDisconnected', updateRiders);
    updateRiders(); // initial sync

    return () => {
      room.off('participantConnected', updateRiders);
      room.off('participantDisconnected', updateRiders);
    };
  }, [room, onVoiceRidersChange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (roomRef.current && roomRef.current.state !== 'disconnected') {
        roomRef.current.disconnect();
      }
    };
  }, []);

  if (status === 'IDLE') return null;

  return (
    <View style={styles.row}>
      <TouchableOpacity
        onPress={toggleSpeaker}
        style={[styles.chip, isSpeakerOn ? styles.chipSpeaker : styles.chipEarpiece]}
      >
        <Text style={styles.chipText}>{isSpeakerOn ? '🔊 Speaker' : '🔈 Earpiece'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  chipSpeaker: {
    backgroundColor: 'rgba(59,130,246,0.12)',
    borderColor: 'rgba(59,130,246,0.35)',
  },
  chipEarpiece: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(255,255,255,0.15)',
  },
  chipText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
