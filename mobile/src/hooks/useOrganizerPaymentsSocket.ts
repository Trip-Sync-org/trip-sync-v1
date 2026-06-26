import { useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { API_BASE_URL } from "../config";

type SocketPayload = { organizerId?: number | null };

/**
 * Listens for organizer-scoped payment/payout events (global `io.emit` from the API).
 * Also listens for room-based events from the `identify` handler.
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

    // Room-based events (emitted via io.to(`organizer-${organizerId}`))
    const onPayoutStatusUpdated = () => {
      payoutRef.current?.();
    };

    const onWalletBalanceUpdated = () => {
      payRef.current?.();
    };

    socket.on("payment:confirmed", onPay);
    socket.on("payout:updated", onPayout);
    socket.on("payout-status-updated", onPayoutStatusUpdated);
    socket.on("wallet-balance-updated", onWalletBalanceUpdated);

    // Send identify so server knows to join us to the organizer room
    socket.emit("identify", { userId, tripId: -1, role });

    return () => {
      socket.off("payment:confirmed", onPay);
      socket.off("payout:updated", onPayout);
      socket.off("payout-status-updated", onPayoutStatusUpdated);
      socket.off("wallet-balance-updated", onWalletBalanceUpdated);
      socket.disconnect();
    };
  }, [userId, role]);
}