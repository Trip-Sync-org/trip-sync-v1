import { useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { API_BASE_URL } from "../config";

type SocketPayload = { organizerId?: number | null };

/**
 * Listens for organizer-scoped payment/payout events (global `io.emit` from the API).
 */
export function useOrganizerPaymentsSocket(opts: {
  userId: number | undefined;
  role: string | undefined;
  onPaymentConfirmed?: () => void;
  onPayoutUpdated?: () => void;
}): void {
  const { userId, role, onPaymentConfirmed, onPayoutUpdated } = opts;
  const payRef = useRef(onPaymentConfirmed);
  const payoutRef = useRef(onPayoutUpdated);
  payRef.current = onPaymentConfirmed;
  payoutRef.current = onPayoutUpdated;

  useEffect(() => {
    if (role !== "organizer" || userId == null) return;

    const socket = io(API_BASE_URL, {
      path: "/socket.io/",
      transports: ["websocket", "polling"],
    });

    const onPay = (payload: SocketPayload) => {
      const oid = payload?.organizerId != null ? Number(payload.organizerId) : NaN;
      if (Number.isFinite(oid) && oid === userId) payRef.current?.();
    };

    const onPayout = (payload: SocketPayload) => {
      const oid = payload?.organizerId != null ? Number(payload.organizerId) : NaN;
      if (Number.isFinite(oid) && oid === userId) payoutRef.current?.();
    };

    socket.on("payment:confirmed", onPay);
    socket.on("payout:updated", onPayout);
    return () => {
      socket.off("payment:confirmed", onPay);
      socket.off("payout:updated", onPayout);
      socket.disconnect();
    };
  }, [userId, role]);
}
