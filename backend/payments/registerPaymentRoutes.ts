/**
///backend/payments/registerPaymentRoutes.ts
 * Cashfree hosted checkout + organizer payouts (Express).
 */
import type { Express, Request, Response } from "express";
import type { Server } from "socket.io";
import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { Cashfree, CFEnvironment } from "cashfree-pg";
import { computeOrganizerRevenue } from "./organizerRevenue.js";

export type PaymentRoutesContext = {
  supabase: SupabaseClient;
  io: Server | null;
  /** Public base URL for return/webhook links */
  backendPublicUrl: string;
  platformFeePercent: number;
  adminSecretKey: string;
  incrementOrganizerCouponUsage: (couponId: number) => Promise<boolean>;
  /**
   * Resolve public.users id from route param (numeric id, auth UUID, or email).
   * Required for mobile clients where `user.id` may not be numeric.
   */
  resolveOrganizerId: (input: unknown) => Promise<number | null>;
};

function parseBookingIdFromOrderId(orderId: string): number | null {
  const m = String(orderId || "").match(/^TS_\d+_(\d+)_\d+$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function maskAccountNumber(last4: string): string {
  return `••••••${last4}`;
}

/** Mask all but last 4 digits of a bank account */
function maskFullAccountNumber(acct: string): string {
  const s = String(acct || "").trim();
  if (s.length <= 4) return s;
  return `••••••${s.slice(-4)}`;
}

function sanitizeTransferId(raw: string): string {
  // Strip all hyphens/special chars and truncate to 40 chars
  return raw.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 40);
}

function sanitizeBeneficiaryName(raw: string): string {
  // Strip any non-alpha/non-space characters
  return String(raw || "").replace(/[^a-zA-Z ]/g, "").slice(0, 100);
}

function sanitizeRemarks(raw: string): string {
  return String(raw || "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);
}

function getCashfreeSignature(): string | null {
  const clientId = String(process.env.CASHFREE_PAYOUT_CLIENT_ID || "").trim();
  const rawPublicKey = String(process.env.CASHFREE_PUBLIC_KEY || "").trim();
  if (!clientId || !rawPublicKey) {
    console.warn("[cashfree-payout] Missing CASHFREE_PAYOUT_CLIENT_ID or CASHFREE_PUBLIC_KEY for 2FA");
    return null;
  }
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const dataToEncrypt = `${clientId}.${timestamp}`;
    const cleanedKey = rawPublicKey.replace(/\s+/g, "");
    let pemKey: string;
    if (cleanedKey.includes("-----BEGINPUBLICKEY-----")) {
      pemKey = cleanedKey
        .replace(/-----BEGINPUBLICKEY-----/g, "-----BEGIN PUBLIC KEY-----\n")
        .replace(/-----ENDPUBLICKEY-----/g, "\n-----END PUBLIC KEY-----");
    } else {
      pemKey = `-----BEGIN PUBLIC KEY-----\n${cleanedKey}\n-----END PUBLIC KEY-----`;
    }
    const encrypted = crypto.publicEncrypt(
      { key: pemKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
      Buffer.from(dataToEncrypt)
    );
    return encrypted.toString("base64");
  } catch (e) {
    console.warn("[cashfree-payout] signature generation error:", e);
    return null;
  }
}

/**
 * Cashfree Payouts v2 API: POST /payout/transfers
 * Uses x-client-id / x-client-secret + optional x-cf-signature auth.
 */
async function initiateCashfreeBankTransfer(opts: {
  transferId: string; amount: number; accountNumber: string; ifsc: string; accountHolderName: string; remarks: string;
}): Promise<{ success: boolean; referenceId?: string; error?: string }> {
  const clientId = String(process.env.CASHFREE_PAYOUT_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.CASHFREE_PAYOUT_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) return { success: false, error: "Cashfree payout credentials not configured" };

  const cashfreeBaseUrl = String(process.env.CASHFREE_BASE_URL ?? "https://sandbox.cashfree.com").trim();
  const url = `${cashfreeBaseUrl.replace(/\/$/, "")}/payout/transfers`;

  const body = {
    transfer_id: sanitizeTransferId(opts.transferId),
    transfer_amount: opts.amount,
    transfer_mode: "banktransfer",
    transfer_remarks: sanitizeRemarks(opts.remarks || "TripSync payout"),
    beneficiary_details: {
      beneficiary_name: sanitizeBeneficiaryName(opts.accountHolderName),
      beneficiary_instrument_details: {
        bank_account_number: opts.accountNumber,
        bank_ifsc: opts.ifsc,
      },
      beneficiary_contact_details: {
        beneficiary_email: "org@tripsync.app",
        beneficiary_phone: "9999999999",
      },
    },
  };

  const headers: Record<string, string> = {
    "x-client-id": clientId,
    "x-client-secret": clientSecret,
    "x-api-version": "2024-01-01",
    "Content-Type": "application/json",
  };

  const sig = getCashfreeSignature();
  if (sig) {
    headers["x-cf-signature"] = sig;
  } else {
    console.warn("[cashfree-payout] No 2FA signature generated — request may be rejected if Public Key 2FA is enabled");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    console.log("[cashfree-payout] signature present:", !!sig, "url:", url, "transferId:", body.transfer_id);
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const text = await res.text();
    console.log("[cashfree-payout] v2 response status:", res.status, "body:", text.slice(0, 600));

    let data: Record<string, unknown> = {};
    try { data = JSON.parse(text); } catch {
      return { success: false, error: `Non-JSON response: ${text.slice(0, 200)}` };
    }

    const responseStatus = String(data?.status || "").toUpperCase();
    if (responseStatus === "RECEIVED" || responseStatus === "SUCCESS") {
      // Extract cf_transfer_id as the reference ID
      const cfTransferId = String((data as any)?.data?.cf_transfer_id || data?.cf_transfer_id || "");
      return { success: true, referenceId: cfTransferId || body.transfer_id };
    }

    return { success: false, error: String(data?.message || data?.sub_code || text || "Payout failed") };
  } catch (e) {
    clearTimeout(timeoutId);
    if ((e as any)?.name === "AbortError") {
      console.error("[cashfree-payout] fetch timed out after 15s");
      return { success: false, error: "Cashfree API timeout" };
    }
    console.error("[cashfree-payout] fetch error:", e);
    return { success: false, error: String(e) };
  }
}

/**
 * Credit an organizer's wallet after a successful booking payment.
 * Uses wallet_ledger to prevent double-crediting (checks existing booking_id).
 */
async function creditOrganizerWallet(opts: {
  supabase: SupabaseClient;
  organizerId: number;
  bookingId: number;
  tripId: number;
  grossAmount: number;
  platformFeeAmount: number;
}): Promise<boolean> {
  const { supabase, organizerId, bookingId, tripId, grossAmount, platformFeeAmount } = opts;

  if (grossAmount <= 0) return true;

  // Check wallet_ledger for existing booking_id to prevent double-credit
  const { data: existing } = await supabase
    .from("wallet_ledger")
    .select("id")
    .eq("booking_id", bookingId)
    .eq("type", "booking_credit")
    .maybeSingle();

  if (existing) {
    console.log(`[wallet] booking ${bookingId} already credited, skipping`);
    return true;
  }

  const netAmount = grossAmount - platformFeeAmount;

  // Upsert organizer_wallet
  // We do this in a transaction-safe way using a Supabase function approach,
  // but since we don't have a custom RPC, we'll do it application-side.
  // First read the current wallet
  const { data: wallet } = await supabase
    .from("organizer_wallet")
    .select("total_earned, total_paid_out, pending_payout, platform_fee_deducted")
    .eq("organizer_id", String(organizerId))
    .maybeSingle();

  if (wallet) {
    // Update existing
    const { error: upErr } = await supabase
      .from("organizer_wallet")
      .update({
        total_earned: Number(wallet.total_earned || 0) + netAmount,
        platform_fee_deducted: Number(wallet.platform_fee_deducted || 0) + platformFeeAmount,
        updated_at: new Date().toISOString(),
      })
      .eq("organizer_id", String(organizerId));
    if (upErr) {
      console.error("[wallet] upsert update error:", upErr.message);
      return false;
    }
  } else {
    // Insert new
    const { error: insErr } = await supabase
      .from("organizer_wallet")
      .insert({
        organizer_id: String(organizerId),
        total_earned: netAmount,
        platform_fee_deducted: platformFeeAmount,
        total_paid_out: 0,
        pending_payout: 0,
      });
    if (insErr) {
      console.error("[wallet] upsert insert error:", insErr.message);
      return false;
    }
  }

  // Write wallet_ledger entry
  const { error: ledgerErr } = await supabase
    .from("wallet_ledger")
    .insert({
      organizer_id: String(organizerId),
      amount: netAmount,
      type: "booking_credit",
      booking_id: bookingId,
      description: `Booking #${bookingId} for trip #${tripId}`,
    });

  if (ledgerErr) {
    console.error("[wallet] ledger insert error:", ledgerErr.message);
  }

  return true;
}

export function registerPaymentRoutes(app: Express, ctx: PaymentRoutesContext): void {
  const {
    supabase,
    io,
    backendPublicUrl,
    platformFeePercent,
    adminSecretKey,
    incrementOrganizerCouponUsage,
    resolveOrganizerId,
  } = ctx;

  const cashfreeAppId = String(process.env.CASHFREE_APP_ID ?? "").trim();
  const cashfreeSecretKey = String(process.env.CASHFREE_SECRET_KEY ?? "").trim();
  const cashfreeBaseUrl = String(process.env.CASHFREE_BASE_URL ?? "https://sandbox.cashfree.com").trim();
  const cashfreeApiVersion = String(process.env.CASHFREE_API_VERSION ?? "2025-01-01").trim();
  const cashfreeEnabled = Boolean(cashfreeAppId && cashfreeSecretKey);
  const cashfreePayoutEnabled = Boolean(
    String(process.env.CASHFREE_PAYOUT_CLIENT_ID ?? "").trim() &&
    String(process.env.CASHFREE_PAYOUT_CLIENT_SECRET ?? "").trim()
  );

  const cashfree = new Cashfree(
    cashfreeBaseUrl.includes("sandbox") ? CFEnvironment.SANDBOX : CFEnvironment.PRODUCTION,
    cashfreeAppId,
    cashfreeSecretKey,
  );

  const hasBookingCashfreeColsCache: { value: boolean | null } = { value: null };
  const hasPayoutTransferColCache: { value: boolean | null } = { value: null };

  function detectPublicBaseUrl(req: Request): string {
    const explicit = String(backendPublicUrl || "").trim();
    // If an explicit public URL is set and it is not localhost, trust it.
    if (explicit && !/^https?:\/\/localhost(?::\d+)?$/i.test(explicit) && !explicit.startsWith("http://127.")) {
      return explicit.replace(/\/$/, "");
    }
    // Vercel / reverse-proxy headers
    const xfProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const xfHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
    const host = xfHost || String(req.headers.host || "").trim();
    // Detect local/LAN hosts: localhost, 127.x, 10.x, 192.168.x, or any private IP range
    const isLanOrLocal =
      host.includes("localhost") ||
      host.startsWith("127.") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host.startsWith("[::1]");
    const isLocal = isLanOrLocal || host.endsWith(".local") || host.startsWith("0.0.0.0");
    const proto = isLocal ? "http" : (xfProto || "https");
    if (host && !host.includes("localhost") && !host.startsWith("127.")) {
      return `${proto}://${host}`.replace(/\/$/, "");
    }
    // Fallback: if we still only have localhost, return the explicit value anyway
    // so that local dev continues to work, but log a warning.
    const fallback = explicit.replace(/\/$/, "") || "http://localhost:3000";
    if (!fallback.includes("localhost") && !fallback.startsWith("http://127.")) {
      return fallback;
    }
    console.warn("[payments] detectPublicBaseUrl falling back to localhost — Cashfree return/webhook URLs will NOT work outside this machine. Set BACKEND_URL env var to your deployed/public URL.");
    return fallback;
  }

  async function hasBookingCashfreeColumns(): Promise<boolean> {
    if (hasBookingCashfreeColsCache.value != null) return hasBookingCashfreeColsCache.value;
    const { error } = await supabase
      .from("bookings")
      .select("cashfree_order_id,cashfree_txn_id")
      .limit(1);
    hasBookingCashfreeColsCache.value = !error;
    if (error) {
      console.warn("[payments] bookings cashfree columns missing:", error.message);
    }
    return hasBookingCashfreeColsCache.value;
  }

  async function hasPayoutTransferColumn(): Promise<boolean> {
    if (hasPayoutTransferColCache.value != null) return hasPayoutTransferColCache.value;
    const { error } = await supabase.from("payout_requests").select("cashfree_transfer_id").limit(1);
    hasPayoutTransferColCache.value = !error;
    if (error) {
      console.warn("[payments] payout_requests cashfree_transfer_id missing:", error.message);
    }
    return hasPayoutTransferColCache.value;
  }

  function verifyWebhook(rawBody: string, timestamp: string, signature: string): boolean {
    const data = timestamp + rawBody;
    const expectedSig = crypto.createHmac("sha256", cashfreeSecretKey).update(data).digest("base64");
    return expectedSig === signature;
  }

  app.post("/api/payments/create-order", async (req: Request, res: Response) => {
    if (!cashfreeEnabled) {
      return res.status(503).json({ error: "Cashfree is not configured" });
    }
    try {
      const tripId = Number(req.body?.tripId);
      const bookingId = Number(req.body?.bookingId);
      const amountIn = Number(req.body?.amount);
      const userName = String(req.body?.userName ?? "TripSync User").trim() || "TripSync User";
      const userEmail = String(req.body?.userEmail ?? "").trim().toLowerCase();
      const userPhone = String(req.body?.userPhone ?? "9999999999").replace(/\D/g, "").slice(-10);
      if (!Number.isFinite(tripId) || !Number.isFinite(bookingId) || !Number.isFinite(amountIn)) {
        return res.status(400).json({ error: "tripId, bookingId and amount are required" });
      }
      const couponCodeHint = String(req.body?.couponCode ?? "").trim();
      const { data: booking } = await supabase
        .from("bookings")
        .select("id, final_amount, payment_status, coupon_id, discount_amount")
        .eq("id", bookingId)
        .maybeSingle();
      if (!booking) {
        return res.status(404).json({ error: "Booking not found" });
      }
      const bookingStatus = String((booking as { payment_status?: unknown }).payment_status ?? "").toLowerCase();
      if (bookingStatus === "paid" || bookingStatus === "confirmed") {
        return res.status(409).json({ error: "Booking already paid" });
      }
      const bookingFinalAmount = Number((booking as { final_amount?: unknown }).final_amount ?? NaN);
      const payable = Number.isFinite(bookingFinalAmount) ? bookingFinalAmount : amountIn;
      if (!Number.isFinite(payable) || payable <= 0) {
        return res.status(400).json({ error: "No payment required for this booking" });
      }
      const finalAmount = Number(payable.toFixed(2));
      const discountAmount = Number((booking as { discount_amount?: unknown }).discount_amount ?? 0);
      let couponCode = couponCodeHint;
      const couponId = Number((booking as { coupon_id?: unknown }).coupon_id ?? NaN);
      if (!couponCode && Number.isFinite(couponId)) {
        const { data: coupon } = await supabase
          .from("organizer_coupons")
          .select("code")
          .eq("id", couponId)
          .maybeSingle();
        couponCode = String((coupon as { code?: unknown })?.code ?? "").trim();
      }

      const orderId = `TS_${tripId}_${bookingId}_${Date.now()}`;
      const publicBaseUrl = detectPublicBaseUrl(req);
      const noteParts = ["Trip Ticket - TripSync"];
      if (couponCode) noteParts.push(`Coupon ${couponCode}`);
      if (discountAmount > 0) noteParts.push(`Discount INR ${discountAmount.toFixed(0)}`);
      const orderRequest = {
        order_id: orderId,
        order_amount: Number(finalAmount.toFixed(2)),
        order_currency: "INR",
        customer_details: {
          customer_id: `user_${bookingId}`,
          customer_name: userName,
          customer_email: userEmail || "user@tripsync.app",
          customer_phone: userPhone.length === 10 ? userPhone : "9999999999",
        },
        order_meta: {
          return_url: `${publicBaseUrl}/api/payments/return?order_id={order_id}`,
          notify_url: `${publicBaseUrl}/api/payments/webhook`,
        },
        order_note: noteParts.join(" | ").slice(0, 120),
      };

      const response = await cashfree.PGCreateOrder(orderRequest as any, cashfreeApiVersion);
      const paymentSessionId = response?.data?.payment_session_id;
      if (!paymentSessionId) {
        return res.status(500).json({ error: "Could not create order" });
      }

      // Best-effort update; do not block checkout if DB update is slow.
      void (async () => {
        try {
          const updatePayload: Record<string, unknown> = { payment_status: "pending" };
          if (await hasBookingCashfreeColumns()) updatePayload.cashfree_order_id = orderId;
          const { error: upErr } = await supabase.from("bookings").update(updatePayload).eq("id", bookingId);
          if (upErr) console.error("[payments/create-order] booking update:", upErr.message);
        } catch (upErr) {
          console.error("[payments/create-order] booking update crash:", upErr);
        }
      })();

      const checkoutBase = cashfreeBaseUrl.replace(/\/$/, "");
      return res.json({
        orderId,
        paymentSessionId,
        orderAmount: finalAmount,
        checkoutUrl: `${checkoutBase}/pg/view/sessions/${paymentSessionId}`,
        cashfreeMode: cashfreeBaseUrl.includes("sandbox") ? "sandbox" : "production",
      });
    } catch (error: any) {
      console.error("Cashfree create order error:", error?.response?.data || error);
      return res.status(500).json({
        error: error?.response?.data?.message || "Could not create order",
      });
    }
  });

  app.post("/api/payments/webhook", async (req: Request, res: Response) => {
    try {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? "");
      const rawBody = raw.toString();
      const timestamp = String(req.headers["x-webhook-timestamp"] ?? "");
      const signature = String(req.headers["x-webhook-signature"] ?? "");
      if (!timestamp || !signature || !verifyWebhook(rawBody, timestamp, signature)) {
        console.error("Webhook signature mismatch — possible fraud");
        return res.status(400).json({ error: "Invalid signature" });
      }

      const event = JSON.parse(rawBody) as {
        type?: string;
        data?: {
          order?: { order_id?: string; order_amount?: number };
          payment?: { cf_payment_id?: string; payment_amount?: number };
        };
      };
      const type = String(event?.type ?? "");
      const orderId = String(event?.data?.order?.order_id ?? "");
      const bookingId = parseBookingIdFromOrderId(orderId);
      if (!bookingId) return res.status(200).json({ ok: true });

      const { data: booking } = await supabase
        .from("bookings")
        .select("id,trip_id,user_id,coupon_id")
        .eq("id", bookingId)
        .maybeSingle();
      if (!booking) return res.status(200).json({ ok: true });

      if (type === "PAYMENT_SUCCESS_WEBHOOK") {
        const paidAmount = Number(event?.data?.payment?.payment_amount ?? event?.data?.order?.order_amount ?? 0);
        const platformFee = paidAmount * (platformFeePercent / 100);
        const organizerNet = paidAmount - platformFee;
        const payload: Record<string, unknown> = {
          payment_status: "paid",
          amount_paid: paidAmount,
          paid_at: new Date().toISOString(),
          platform_fee_amount: platformFee,
          organizer_net_amount: organizerNet,
          status: "confirmed",
        };
        if (await hasBookingCashfreeColumns()) {
          payload.cashfree_txn_id = String(event?.data?.payment?.cf_payment_id ?? "");
        }
        const { error: upErr } = await supabase
          .from("bookings")
          .update(payload)
          .eq("id", bookingId)
          .eq("payment_status", "pending");
        if (upErr) console.error("[payments/webhook] success update:", upErr.message);

        const couponId = (booking as { coupon_id?: unknown }).coupon_id;
        if (couponId != null && Number.isFinite(Number(couponId))) {
          const okInc = await incrementOrganizerCouponUsage(Number(couponId));
          if (!okInc) console.warn("[payments/webhook] coupon increment failed", couponId);
        }

        // Credit organizer wallet
        const tripId = Number((booking as { trip_id?: unknown }).trip_id);
        const userId = Number((booking as { user_id?: unknown }).user_id);
        const organizerId = Number((booking as { organizer_id?: unknown }).organizer_id) || (await (async () => {
          const { data: tripData } = await supabase.from("trips").select("organizer_id").eq("id", tripId).single();
          return tripData ? Number(tripData.organizer_id) : null;
        })());

        if (organizerId && Number.isFinite(organizerId)) {
          void creditOrganizerWallet({
            supabase,
            organizerId,
            bookingId,
            tripId,
            grossAmount: paidAmount,
            platformFeeAmount: platformFee,
          }).then((ok) => {
            if (ok && io) {
              io.to(`organizer-${organizerId}`).emit("wallet-balance-updated", { organizerId });
            }
          });
        }

        if (io) {
          io.to(`trip-${tripId}`).emit("payment:confirmed", {
            bookingId,
            tripId,
            userId,
            amount: paidAmount,
          });
        }
        return res.status(200).json({ ok: true });
      }

      if (type === "PAYMENT_FAILED_WEBHOOK") {
        await supabase.from("bookings").update({ payment_status: "failed" }).eq("id", bookingId);
        if (io) {
          io.to(`trip-${Number((booking as { trip_id?: unknown }).trip_id)}`).emit("payment:failed", {
            bookingId,
            tripId: Number((booking as { trip_id?: unknown }).trip_id),
            userId: Number((booking as { user_id?: unknown }).user_id),
          });
        }
      }

      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error("[payments/webhook]", e);
      return res.status(200).json({ ok: true });
    }
  });

  app.get("/api/payments/verify/:orderId", async (req: Request, res: Response) => {
    if (!cashfreeEnabled) return res.status(503).json({ error: "Cashfree is not configured" });
    const orderId = String(req.params.orderId ?? "");
    try {
      const response = await cashfree.PGFetchOrder(orderId, cashfreeApiVersion);
      const orderStatus = String(response?.data?.order_status ?? "ACTIVE");
      let bookingQuery = supabase.from("bookings").select("id,payment_status,coupon_id").limit(1);
      if (await hasBookingCashfreeColumns()) bookingQuery = bookingQuery.eq("cashfree_order_id", orderId);
      const { data: booking } = await bookingQuery.maybeSingle();

      // Reconcile eventual consistency: if Cashfree says PAID but webhook hasn't updated DB yet.
      if (booking && orderStatus === "PAID" && String(booking.payment_status ?? "") !== "paid") {
        const bookingId = Number((booking as { id?: unknown }).id);
        const paidAmount = Number(response?.data?.order_amount ?? 0);
        const platformFee = paidAmount * (platformFeePercent / 100);
        const organizerNet = paidAmount - platformFee;
        const updatePayload: Record<string, unknown> = {
          payment_status: "paid",
          amount_paid: paidAmount,
          paid_at: new Date().toISOString(),
          platform_fee_amount: platformFee,
          organizer_net_amount: organizerNet,
          status: "confirmed",
        };
        if (await hasBookingCashfreeColumns()) {
          updatePayload.cashfree_txn_id = String(response?.data?.cf_order_id ?? orderId);
        }
        const { error: upErr } = await supabase.from("bookings").update(updatePayload).eq("id", bookingId);
        if (upErr) {
          console.error("[payments/verify] paid reconciliation failed:", upErr.message);
        } else {
          const couponId = (booking as { coupon_id?: unknown }).coupon_id;
          if (couponId != null && Number.isFinite(Number(couponId))) {
            const okInc = await incrementOrganizerCouponUsage(Number(couponId));
            if (!okInc) console.warn("[payments/verify] coupon increment failed", couponId);
          }
          // Also credit wallet for reconciled payments
          const { data: reconciledBooking } = await supabase
            .from("bookings")
            .select("trip_id, user_id")
            .eq("id", bookingId)
            .maybeSingle();
          if (reconciledBooking) {
            const tripId = Number(reconciledBooking.trip_id);
            const { data: tripData } = await supabase.from("trips").select("organizer_id").eq("id", tripId).single();
            const organizerId = tripData ? Number(tripData.organizer_id) : null;
            if (organizerId && Number.isFinite(organizerId)) {
              void creditOrganizerWallet({
                supabase,
                organizerId,
                bookingId,
                tripId,
                grossAmount: paidAmount,
                platformFeeAmount: platformFee,
              }).then((ok) => {
                if (ok && io) {
                  io.to(`organizer-${organizerId}`).emit("wallet-balance-updated", { organizerId });
                }
              });
            }
          }
        }
      }

      // Re-read after reconciliation attempt.
      let finalBookingQuery = supabase.from("bookings").select("id,payment_status").limit(1);
      if (await hasBookingCashfreeColumns()) finalBookingQuery = finalBookingQuery.eq("cashfree_order_id", orderId);
      const { data: finalBooking } = await finalBookingQuery.maybeSingle();
      return res.json({
        orderStatus,
        paymentStatus: finalBooking?.payment_status ?? booking?.payment_status ?? "pending",
        bookingId: finalBooking?.id ?? booking?.id ?? parseBookingIdFromOrderId(orderId),
      });
    } catch (error: any) {
      return res.status(500).json({ error: error?.response?.data?.message || "Could not verify order" });
    }
  });

  app.get("/api/payments/return", async (req: Request, res: Response) => {
    const orderId = String(req.query.order_id ?? "");
    if (!cashfreeEnabled || !orderId) {
      return res.redirect(`tripsync://payment/failure?order_id=${encodeURIComponent(orderId)}`);
    }
    try {
      const response = await cashfree.PGFetchOrder(orderId, cashfreeApiVersion);
      const status = String(response?.data?.order_status ?? "");
      if (status === "PAID") {
        return res.redirect(`tripsync://payment/success?order_id=${encodeURIComponent(orderId)}`);
      }
      return res.redirect(`tripsync://payment/failure?order_id=${encodeURIComponent(orderId)}`);
    } catch {
      return res.redirect(`tripsync://payment/failure?order_id=${encodeURIComponent(orderId)}`);
    }
  });

  /** GET /api/organizer/earnings/:userId — legacy summary; balances match revenue engine */
  app.get("/api/organizer/earnings/:userId", async (req: Request, res: Response) => {
    const organizerId = await resolveOrganizerId(req.params.userId);
    if (organizerId == null) {
      return res.status(400).json({ error: "Invalid organizer id" });
    }

    const r = await computeOrganizerRevenue(supabase, organizerId, platformFeePercent);
    const recentTransactions = r.transactions.slice(0, 20).map((t) => ({
      id: t.bookingId,
      trip_id: null as number | null,
      trip_name: t.tripTitle,
      member_name: t.memberName,
      amount: t.amountPaid,
      paid_at: t.paidAt,
      payment_status: "paid",
      paymentType: t.paymentType,
      couponCode: t.couponCode,
      couponDiscount: t.couponDiscount,
    }));

    return res.json({
      totalEarned: r.totalGrossRevenue,
      platformFees: r.platformFee,
      netEarnable: r.eligibleForPayout,
      totalPaidOut: r.totalPaidOut,
      availableBalance: r.availableBalance,
      pendingPayout: r.pendingPayout,
      recentTransactions,
    });
  });

  /** GET /api/organizer/revenue/:userId — full breakdown + last 30 transactions. Optional: ?from=YYYY-MM-DD&to=YYYY-MM-DD */
  app.get("/api/organizer/revenue/:userId", async (req: Request, res: Response) => {
    const organizerId = await resolveOrganizerId(req.params.userId);
    if (organizerId == null) {
      return res.status(400).json({ error: "Invalid organizer id" });
    }

    const from = typeof req.query.from === "string" ? req.query.from.trim() : "";
    const to = typeof req.query.to === "string" ? req.query.to.trim() : "";
    const range = from && to ? { from, to } : undefined;
    const selectedYearRaw = Number(req.query.year);
    const selectedYear = Number.isFinite(selectedYearRaw) ? selectedYearRaw : new Date().getFullYear();

    const r = await computeOrganizerRevenue(supabase, organizerId, platformFeePercent, range);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthlyData = months.map((monthName, month) => ({
      month,
      monthName,
      totalAmount: 0,
      bookingCount: 0,
    }));
    const { data: organizerTrips } = await supabase
      .from("trips")
      .select("id")
      .eq("organizer_id", organizerId);
    const tripIds = (organizerTrips ?? []).map((t) => Number((t as { id?: unknown }).id)).filter(Number.isFinite);
    if (tripIds.length > 0) {
      const { data: paidRows } = await supabase
        .from("bookings")
        .select("paid_at, created_at, amount_paid")
        .in("trip_id", tripIds)
        .eq("payment_status", "paid");
      for (const row of paidRows ?? []) {
        const paidAt = (row as { paid_at?: unknown }).paid_at;
        const createdAt = (row as { created_at?: unknown }).created_at;
        const stamp = paidAt != null ? String(paidAt) : createdAt != null ? String(createdAt) : "";
        if (!stamp) continue;
        const dt = new Date(stamp);
        if (!Number.isFinite(dt.getTime()) || dt.getFullYear() !== selectedYear) continue;
        const m = dt.getMonth();
        if (m < 0 || m > 11) continue;
        const amt = Number((row as { amount_paid?: unknown }).amount_paid ?? 0);
        monthlyData[m].totalAmount += Number.isFinite(amt) ? amt : 0;
        monthlyData[m].bookingCount += 1;
      }
    }
    return res.json({
      ...r,
      monthlyData,
      selectedYear,
      transactions: r.transactions.slice(0, 30),
    });
  });

  /** GET /api/organizer/revenue/mini/:userId — mini revenue snapshot */
  app.get("/api/organizer/revenue/mini/:userId", async (req: Request, res: Response) => {
    const organizerId = await resolveOrganizerId(req.params.userId);
    if (organizerId == null) {
      return res.status(400).json({ error: "Invalid organizer id" });
    }

    const { data: trips } = await supabase
      .from("trips")
      .select("id")
      .eq("organizer_id", organizerId);
    const tripIds = (trips ?? []).map((t: any) => Number(t.id)).filter(Number.isFinite);

    if (tripIds.length === 0) {
      return res.json({ totalBookings: 0, totalRevenue: 0 });
    }

    const { data: bookings } = await supabase
      .from("bookings")
      .select("amount_paid")
      .in("trip_id", tripIds)
      .eq("payment_status", "paid");

    let totalRevenue = 0;
    for (const b of bookings ?? []) {
      totalRevenue += Number((b as { amount_paid?: unknown }).amount_paid ?? 0);
    }

    return res.json({
      totalBookings: (bookings ?? []).length,
      totalRevenue,
    });
  });

  /** GET /api/organizer/payout/balance/:userId */
  app.get("/api/organizer/payout/balance/:userId", async (req: Request, res: Response) => {
    const organizerId = await resolveOrganizerId(req.params.userId);
    if (organizerId == null) {
      return res.status(400).json({ error: "Invalid organizer id" });
    }

    const r = await computeOrganizerRevenue(supabase, organizerId, platformFeePercent);
    return res.json({
      eligibleForPayout: r.eligibleForPayout,
      totalPaidOut: r.totalPaidOut,
      pendingPayout: r.pendingPayout,
      availableBalance: r.availableBalance,
    });
  });

  /** GET /api/organizers/:id/payout-balance — reads from organizer_wallet */
  app.get("/api/organizers/:id/payout-balance", async (req: Request, res: Response) => {
    const organizerId = await resolveOrganizerId(req.params.id);
    if (organizerId == null) {
      return res.status(400).json({ error: "Invalid organizer id" });
    }

    // Try organizer_wallet first
    const { data: wallet } = await supabase
      .from("organizer_wallet")
      .select("total_earned, total_paid_out, pending_payout, platform_fee_deducted")
      .eq("organizer_id", String(organizerId))
      .maybeSingle();

    if (wallet) {
      const totalEarned = Number(wallet.total_earned || 0);
      const totalPaidOut = Number(wallet.total_paid_out || 0);
      const pendingPayout = Number(wallet.pending_payout || 0);
      const availableBalance = Math.max(0, totalEarned - totalPaidOut - pendingPayout);
      return res.json({
        eligibleForPayout: totalEarned,
        totalPaidOut,
        pendingPayout,
        availableBalance,
      });
    }

    // Fallback to computeOrganizerRevenue if wallet table not populated yet
    const r = await computeOrganizerRevenue(supabase, organizerId, platformFeePercent);
    return res.json({
      eligibleForPayout: r.eligibleForPayout,
      totalPaidOut: r.totalPaidOut,
      pendingPayout: r.pendingPayout,
      availableBalance: r.availableBalance,
    });
  });

  // ===================================================================
  // BANK ACCOUNT ROUTES
  // ===================================================================

  /** GET /api/organizers/:id/bank-accounts — list bank accounts */
  app.get("/api/organizers/:id/bank-accounts", async (req: Request, res: Response) => {
    const uid = await resolveOrganizerId(req.params.id);
    if (uid == null) return res.status(400).json({ error: "Invalid organizer id" });

    const { data, error } = await supabase
      .from("organizer_bank_accounts")
      .select("*")
      .eq("organizer_id", String(uid))
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("bank-accounts list:", error.message);
      return res.status(500).json({ error: "Failed to fetch bank accounts" });
    }

    // Mask account numbers — show only last 4 digits
    const masked = (data ?? []).map((r: any) => ({
      id: r.id,
      accountNumber: maskFullAccountNumber(String(r.account_number || "")),
      ifsc: String(r.ifsc || ""),
      bankName: String(r.bank_name || ""),
      accountHolderName: String(r.account_holder_name || ""),
      isPrimary: Boolean(r.is_primary),
      isVerified: Boolean(r.is_verified),
      createdAt: r.created_at,
    }));

    return res.json(masked);
  });

  /** POST /api/organizers/:id/bank-accounts — add a bank account */
  app.post("/api/organizers/:id/bank-accounts", async (req: Request, res: Response) => {
    const uid = await resolveOrganizerId(req.params.id);
    if (uid == null) return res.status(400).json({ error: "Invalid organizer id" });

    const { account_number, ifsc, account_holder_name, bank_name } = req.body ?? {};

    if (!account_number || !ifsc || !account_holder_name) {
      return res.status(400).json({ error: "account_number, ifsc, and account_holder_name are required" });
    }

    const ifscUpper = String(ifsc).trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscUpper)) {
      return res.status(400).json({ error: "Invalid IFSC code format" });
    }

    // Check if this is the first account
    const { count } = await supabase
      .from("organizer_bank_accounts")
      .select("*", { count: "exact", head: true })
      .eq("organizer_id", String(uid));

    const isFirst = (count ?? 0) === 0;

    const { data, error } = await supabase
      .from("organizer_bank_accounts")
      .insert({
        organizer_id: String(uid),
        account_number: String(account_number).trim(),
        ifsc: ifscUpper,
        bank_name: String(bank_name || "").trim(),
        account_holder_name: String(account_holder_name).trim(),
        is_primary: isFirst,
        is_verified: false,
      })
      .select()
      .single();

    if (error) {
      console.error("bank-accounts create:", error.message);
      return res.status(500).json({ error: "Failed to save bank account" });
    }

    return res.json({
      id: data.id,
      accountNumber: maskFullAccountNumber(String(data.account_number || "")),
      ifsc: String(data.ifsc || ""),
      bankName: String(data.bank_name || ""),
      accountHolderName: String(data.account_holder_name || ""),
      isPrimary: Boolean(data.is_primary),
      isVerified: Boolean(data.is_verified),
    });
  });

  /** DELETE /api/organizers/:id/bank-accounts/:accountId — delete a bank account */
  app.delete("/api/organizers/:id/bank-accounts/:accountId", async (req: Request, res: Response) => {
    const uid = await resolveOrganizerId(req.params.id);
    if (uid == null) return res.status(400).json({ error: "Invalid organizer id" });
    const accountId = String(req.params.accountId ?? "");
    if (!accountId) return res.status(400).json({ error: "Invalid account id" });

    // Check if there are pending payouts against this account
    const { data: pendingPayouts } = await supabase
      .from("payout_requests")
      .select("id")
      .eq("bank_account_id", accountId)
      .in("status", ["pending", "processing"])
      .limit(1);

    if (pendingPayouts && pendingPayouts.length > 0) {
      return res.status(400).json({ error: "Cannot delete account with pending payout requests" });
    }

    const { error } = await supabase
      .from("organizer_bank_accounts")
      .delete()
      .eq("id", accountId)
      .eq("organizer_id", String(uid));

    if (error) {
      console.error("bank-accounts delete:", error.message);
      return res.status(500).json({ error: "Failed to delete bank account" });
    }

    return res.json({ deleted: true });
  });

  // ===================================================================
  // PAYOUT REQUEST ROUTES
  // ===================================================================

  /** GET /api/organizers/:id/payouts — list payout requests */
  app.get("/api/organizers/:id/payouts", async (req: Request, res: Response) => {
    const uid = await resolveOrganizerId(req.params.id);
    if (uid == null) return res.status(400).json({ error: "Invalid organizer id" });

    const { data, error } = await supabase
      .from("payout_requests")
      .select("*")
      .eq("organizer_id", uid)
      .order("requested_at", { ascending: false });

    if (error) {
      console.error("payouts list:", error.message);
      return res.status(500).json({ error: "Failed to load payouts" });
    }

    const mapped = (data ?? []).map((r: any) => ({
      id: String(r.id),
      amount: Number(r.amount || 0),
      status: String(r.status || "pending").toLowerCase(),
      createdAt: r.requested_at || r.created_at || new Date().toISOString(),
      processedAt: r.processed_at || null,
      utr: r.utr || null,
      accountLabel: r.account_label || null,
      note: r.note || null,
    }));

    return res.json(mapped);
  });

  /** POST /api/organizers/:id/payouts — request a payout */
  app.post("/api/organizers/:id/payouts", async (req: Request, res: Response) => {
    const uid = await resolveOrganizerId(req.params.id);
    if (uid == null) return res.status(400).json({ error: "Invalid organizer id" });

    const amount = Number(req.body?.amount);
    const bankAccountId = String(req.body?.bank_account_id ?? "").trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Positive amount is required" });
    }

    if (amount < 100) {
      return res.status(400).json({ error: "Minimum payout is ₹100" });
    }

    if (!bankAccountId) {
      return res.status(400).json({ error: "bank_account_id is required" });
    }

    // Validate bank account belongs to this organizer
    const { data: bankAccount } = await supabase
      .from("organizer_bank_accounts")
      .select("id, account_number, ifsc, account_holder_name, bank_name")
      .eq("id", bankAccountId)
      .eq("organizer_id", String(uid))
      .maybeSingle();

    if (!bankAccount) {
      return res.status(400).json({ error: "Bank account not found or does not belong to you" });
    }

    // Check for existing pending/processing payout
    const { data: pendingRows } = await supabase
      .from("payout_requests")
      .select("id")
      .eq("organizer_id", uid)
      .in("status", ["pending", "processing"])
      .limit(1);

    if ((pendingRows ?? []).length > 0) {
      return res.status(400).json({ error: "You already have a payout request in progress" });
    }

    // Check balance from organizer_wallet
    let availableBalance = 0;
    const { data: wallet } = await supabase
      .from("organizer_wallet")
      .select("total_earned, total_paid_out, pending_payout")
      .eq("organizer_id", String(uid))
      .maybeSingle();

    if (wallet) {
      const totalEarned = Number(wallet.total_earned || 0);
      const totalPaidOut = Number(wallet.total_paid_out || 0);
      const pendingPayout = Number(wallet.pending_payout || 0);
      availableBalance = Math.max(0, totalEarned - totalPaidOut - pendingPayout);
    } else {
      // Fallback to revenue engine
      const r = await computeOrganizerRevenue(supabase, uid, platformFeePercent);
      availableBalance = r.availableBalance;
    }

    if (amount > availableBalance + 0.01) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // Create account label for history display
    const accountLabel = `${String(bankAccount.bank_name || "Bank")} ••••${String(bankAccount.account_number || "").slice(-4)}`;

    // Deduct from wallet pending_payout (reserve it)
    const { error: walletErr } = await supabase
      .from("organizer_wallet")
      .update({
        pending_payout: Number(wallet?.pending_payout || 0) + amount,
        updated_at: new Date().toISOString(),
      })
      .eq("organizer_id", String(uid));

    if (walletErr) {
      console.error("[payout] wallet reserve error:", walletErr.message);
    }

    // Write wallet_ledger entry
    await supabase
      .from("wallet_ledger")
      .insert({
        organizer_id: String(uid),
        amount: -amount,
        type: "payout_debit",
        description: `Payout request #${Date.now()}`,
      });

    // Create payout request
    const { data: inserted, error: insErr } = await supabase
      .from("payout_requests")
      .insert({
        organizer_id: String(uid),
        amount,
        status: "pending",
        net_amount: amount,
        bank_account_id: bankAccountId,
        account_label: accountLabel,
      })
      .select("id")
      .single();

    if (insErr || !inserted) {
      console.error("payout insert:", insErr?.message);
      // Refund the wallet reservation
      await supabase
        .from("organizer_wallet")
        .update({
          pending_payout: Math.max(0, Number(wallet?.pending_payout || 0)),
          updated_at: new Date().toISOString(),
        })
        .eq("organizer_id", String(uid));
      return res.status(500).json({ error: "Failed to create payout request" });
    }

    const payoutId = String(inserted.id);

    // Try Cashfree Payouts if configured (uses outer cashfreePayoutEnabled from function scope)
    if (cashfreePayoutEnabled) {
      const shortUuid = payoutId.replace(/-/g, "").slice(-12);
      const tsSuffix = String(Date.now()).slice(-6);
      const transferId = `PAYOUT_${shortUuid}_${tsSuffix}`;
      const transferResult = await initiateCashfreeBankTransfer({
        transferId,
        amount,
        accountNumber: String(bankAccount.account_number),
        ifsc: String(bankAccount.ifsc),
        accountHolderName: String(bankAccount.account_holder_name),
        remarks: `TripSync payout organizer ${uid}`,
      });

      if (transferResult.success) {
        await supabase
          .from("payout_requests")
          .update({
            status: "processing",
            utr: transferResult.referenceId || null,
          })
          .eq("id", inserted.id);
      } else {
        console.warn("[payout] Cashfree transfer failed, leaving as pending:", transferResult.error);
      }
    }

    // Emit socket event
    if (io) {
      io.to(`organizer-${uid}`).emit("payout-status-updated", {
        payoutId,
        status: "pending",
        amount,
        utr: null,
      });
    }

    return res.json({
      id: payoutId,
      amount,
      status: "pending",
      message: cashfreePayoutEnabled
        ? "Payout initiated. Processing via bank transfer."
        : "Payout requested. Admin will process within 2-3 business days.",
    });
  });

  /** POST /api/admin/payouts/:payoutId/status — admin updates payout status */
  app.post("/api/admin/payouts/:payoutId/status", async (req: Request, res: Response) => {
    const adminKey = String(req.headers["x-admin-key"] ?? req.headers["admin-secret-key"] ?? "");
    if (!adminSecretKey || adminKey !== adminSecretKey) {
      return res.status(403).json({ error: "Unauthorized — invalid admin key" });
    }

    const payoutId = String(req.params.payoutId ?? "");
    if (!payoutId) return res.status(400).json({ error: "Invalid payout id" });

    const status = String(req.body?.status ?? "").toLowerCase();
    if (!["completed", "failed"].includes(status)) {
      return res.status(400).json({ error: "Status must be 'completed' or 'failed'" });
    }

    const utr = String(req.body?.utr ?? "").trim() || null;
    const note = String(req.body?.note ?? "").trim() || null;

    // Fetch the payout request
    const { data: payout } = await supabase
      .from("payout_requests")
      .select("id, organizer_id, amount, status")
      .eq("id", payoutId)
      .maybeSingle();

    if (!payout) return res.status(404).json({ error: "Payout request not found" });

    const currentStatus = String(payout.status || "").toLowerCase();
    if (currentStatus === "completed" || currentStatus === "failed") {
      return res.status(400).json({ error: `Payout is already ${currentStatus}` });
    }

    const amount = Number(payout.amount || 0);
    const organizerId = Number(payout.organizer_id);

    // Update payout request
    const updatePayload: Record<string, unknown> = {
      status,
      processed_at: new Date().toISOString(),
    };
    if (utr) updatePayload.utr = utr;
    if (note) updatePayload.note = note;

    const { error: upErr } = await supabase
      .from("payout_requests")
      .update(updatePayload)
      .eq("id", payoutId);

    if (upErr) {
      console.error("admin payout status update:", upErr.message);
      return res.status(500).json({ error: "Failed to update payout status" });
    }

    // Update wallet
    const { data: wallet } = await supabase
      .from("organizer_wallet")
      .select("total_paid_out, pending_payout, total_earned")
      .eq("organizer_id", String(organizerId))
      .maybeSingle();

    if (wallet) {
      if (status === "completed") {
        await supabase
          .from("organizer_wallet")
          .update({
            total_paid_out: Number(wallet.total_paid_out || 0) + amount,
            pending_payout: Math.max(0, Number(wallet.pending_payout || 0) - amount),
            updated_at: new Date().toISOString(),
          })
          .eq("organizer_id", String(organizerId));
      } else if (status === "failed") {
        // Refund pending_payout back (no net change to total_earned, just release the reserve)
        await supabase
          .from("organizer_wallet")
          .update({
            pending_payout: Math.max(0, Number(wallet.pending_payout || 0) - amount),
            updated_at: new Date().toISOString(),
          })
          .eq("organizer_id", String(organizerId));
      }
    }

    // Write wallet_ledger entry
    await supabase
      .from("wallet_ledger")
      .insert({
        organizer_id: String(organizerId),
        amount: status === "completed" ? -amount : amount,
        type: status === "completed" ? "payout_debit" : "refund_debit",
        payout_request_id: payoutId,
        description: status === "completed"
          ? `Payout completed (UTR: ${utr || "N/A"})`
          : `Payout failed — refunded (${note || "No reason"})`,
      });

    // Emit socket event
    if (io) {
      io.to(`organizer-${organizerId}`).emit("payout-status-updated", {
        payoutId,
        status,
        amount,
        utr: utr || null,
      });
      io.to(`organizer-${organizerId}`).emit("wallet-balance-updated", { organizerId });
    }

    return res.json({ ok: true, status });
  });

  /** POST /api/payments/webhook/cashfree-payout — Cashfree webhook for payout status */
  app.post("/api/payments/webhook/cashfree-payout", async (req: Request, res: Response) => {
    try {
      const rawBody = Buffer.isBuffer(req.body) ? req.body.toString() : String(req.body ?? "");
      const signature = String(req.headers["x-webhook-signature"] ?? "");
      const timestamp = String(req.headers["x-webhook-timestamp"] ?? "");

      if (timestamp && signature) {
        const expectedSig = crypto
          .createHmac("sha256", cashfreeSecretKey)
          .update(timestamp + rawBody)
          .digest("base64");
        if (expectedSig !== signature) {
          console.error("[cashfree-payout webhook] signature mismatch");
          return res.status(200).json({ ok: true }); // always return 200
        }
      }

      const event = JSON.parse(rawBody) as {
        type?: string;
        data?: {
          transfer?: {
            transferId?: string;
            status?: string;
            utr?: string;
            referenceId?: string;
          };
        };
      };

      const transferId = String(event?.data?.transfer?.transferId ?? "");
      const transferStatus = String(event?.data?.transfer?.status ?? "").toLowerCase();
      const utr = String(event?.data?.transfer?.utr ?? "").trim() || null;

      if (!transferId) return res.status(200).json({ ok: true });

      // Extract payoutId from transferId (format: PAYOUT_<id>_<timestamp>) — note: no hyphens in sanitized IDs
      const m = transferId.match(/^PAYOUT_([a-f0-9]+)_\d+$/);
      if (!m) return res.status(200).json({ ok: true });
      const payoutId = m[1];

      const mappedStatus = transferStatus === "success" ? "completed" : transferStatus === "failed" ? "failed" : null;
      if (!mappedStatus) return res.status(200).json({ ok: true });

      // Fetch the payout request
      const { data: payout } = await supabase
        .from("payout_requests")
        .select("id, organizer_id, amount, status")
        .eq("id", payoutId)
        .maybeSingle();

      if (!payout) return res.status(200).json({ ok: true });

      const currentStatus = String(payout.status || "").toLowerCase();
      if (currentStatus === "completed" || currentStatus === "failed") {
        return res.status(200).json({ ok: true });
      }

      const organizerId = Number(payout.organizer_id);
      const amount = Number(payout.amount || 0);

      // Update payout
      const payoutUpdate: Record<string, unknown> = {
        status: mappedStatus,
        processed_at: new Date().toISOString(),
      };
      if (utr) payoutUpdate.utr = utr;
      await supabase.from("payout_requests").update(payoutUpdate).eq("id", payoutId);

      // Update wallet
      const { data: wallet } = await supabase
        .from("organizer_wallet")
        .select("total_paid_out, pending_payout, total_earned")
        .eq("organizer_id", String(organizerId))
        .maybeSingle();

      if (wallet) {
        if (mappedStatus === "completed") {
          await supabase
            .from("organizer_wallet")
            .update({
              total_paid_out: Number(wallet.total_paid_out || 0) + amount,
              pending_payout: Math.max(0, Number(wallet.pending_payout || 0) - amount),
              updated_at: new Date().toISOString(),
            })
            .eq("organizer_id", String(organizerId));
        } else if (mappedStatus === "failed") {
          await supabase
            .from("organizer_wallet")
            .update({
              pending_payout: Math.max(0, Number(wallet.pending_payout || 0) - amount),
              updated_at: new Date().toISOString(),
            })
            .eq("organizer_id", String(organizerId));
        }
      }

      // Wallet ledger
      await supabase
        .from("wallet_ledger")
        .insert({
          organizer_id: String(organizerId),
          amount: mappedStatus === "completed" ? -amount : amount,
          type: mappedStatus === "completed" ? "payout_debit" : "refund_debit",
          payout_request_id: payoutId,
          description: mappedStatus === "completed"
            ? `Payout completed via Cashfree (UTR: ${utr || "N/A"})`
            : "Payout failed via Cashfree",
        });

      // Socket events
      if (io) {
        io.to(`organizer-${organizerId}`).emit("payout-status-updated", {
          payoutId,
          status: mappedStatus,
          amount,
          utr: utr || null,
        });
        io.to(`organizer-${organizerId}`).emit("wallet-balance-updated", { organizerId });
      }

      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error("[cashfree-payout webhook]", e);
      return res.status(200).json({ ok: true });
    }
  });

  /** POST /api/organizer/payout/request — legacy endpoint */
  app.post("/api/organizer/payout/request", async (req: Request, res: Response) => {
    const organizerId = Number(req.body?.organizerId ?? req.body?.userId);
    const amount = Number(req.body?.amount);
    const tripId = req.body?.tripId != null ? Number(req.body.tripId) : null;

    if (!Number.isFinite(organizerId) || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "organizerId and positive amount are required" });
    }

    const { data: org } = await supabase.from("users").select("id, role").eq("id", organizerId).maybeSingle();
    if (!org || String((org as { role?: string }).role) !== "organizer") {
      return res.status(403).json({ error: "Only organizers can request payouts" });
    }

    const { data: details } = await supabase
      .from("organizer_payout_details")
      .select("*")
      .eq("user_id", organizerId)
      .maybeSingle();

    if (!details) {
      return res.status(400).json({ error: "Please add payout method in Profile first" });
    }

    const { data: pendingRows } = await supabase
      .from("payout_requests")
      .select("id")
      .eq("organizer_id", organizerId)
      .in("status", ["pending", "processing"])
      .limit(1);

    if ((pendingRows ?? []).length > 0) {
      return res.status(400).json({ error: "You already have a payout request in progress" });
    }

    if (amount < 100) {
      return res.status(400).json({ error: "Minimum payout is ₹100" });
    }

    const fin = await computeOrganizerRevenue(supabase, organizerId, platformFeePercent);
    if (amount > fin.availableBalance + 0.01) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    const method = String((details as { payout_method?: string }).payout_method ?? "");
    const snapshot =
      method === "upi"
        ? `UPI ${String((details as { upi_id?: string }).upi_id ?? "").slice(0, 3)}…`
        : `Bank ${maskAccountNumber(String((details as { bank_account_number?: string }).bank_account_number ?? "0000").slice(-4))}`;

    const { data: inserted, error: insErr } = await supabase
      .from("payout_requests")
      .insert({
        organizer_id: organizerId,
        amount,
        trip_id: tripId && Number.isFinite(tripId) ? tripId : null,
        status: "pending",
        net_amount: amount,
        payout_method_snapshot: snapshot,
      })
      .select("id")
      .single();

    if (insErr || !inserted) {
      console.error("payout insert:", insErr?.message);
      return res.status(500).json({ error: "Failed to create payout request" });
    }

    console.log("PAYOUT REQUEST:", { organizerId, amount, method: snapshot });

    const after = await computeOrganizerRevenue(supabase, organizerId, platformFeePercent);

    if (io) {
      io.emit("payout:updated", {
        requestId: inserted.id,
        organizerId,
        status: "pending",
        amount,
      });
    }

    return res.json({
      requestId: inserted.id,
      status: "pending",
      message: "Payout requested. Processing within 2-3 business days.",
      eligibleForPayout: after.eligibleForPayout,
      totalPaidOut: after.totalPaidOut,
      pendingPayout: after.pendingPayout,
      availableBalance: after.availableBalance,
    });
  });

  /** GET /api/organizer/payout/history/:userId */
  app.get("/api/organizer/payout/history/:userId", async (req: Request, res: Response) => {
    const uid = await resolveOrganizerId(req.params.userId);
    if (uid == null) return res.status(400).json({ error: "Invalid organizer id" });

    const { data, error } = await supabase
      .from("payout_requests")
      .select("*")
      .eq("organizer_id", uid)
      .order("requested_at", { ascending: false });

    if (error) {
      console.error("payout history:", error.message);
      return res.status(500).json({ error: "Failed to load history" });
    }
    return res.json(data ?? []);
  });

  /** POST /api/organizer/payout-details */
  app.post("/api/organizer/payout-details", async (req: Request, res: Response) => {
    const userId = Number(req.body?.userId);
    const payoutMethod = String(req.body?.payoutMethod ?? req.body?.payout_method ?? "").toLowerCase();
    const upiId = String(req.body?.upiId ?? req.body?.upi_id ?? "").trim();
    const bankAccountName = String(req.body?.bankAccountName ?? req.body?.bank_account_name ?? "").trim();
    const bankName = String(req.body?.bankName ?? req.body?.bank_name ?? "").trim();
    const bankAccountNumber = String(req.body?.bankAccountNumber ?? req.body?.bank_account_number ?? "").trim();
    const bankIfsc = String(req.body?.bankIfsc ?? req.body?.bank_ifsc ?? "")
      .trim()
      .toUpperCase();

    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: "userId is required" });
    }

    if (payoutMethod === "upi") {
      if (!/^[^\s@]+@[^\s@]+$/.test(upiId) || !/\.[a-zA-Z]{2,}/.test(upiId.split("@")[1] ?? "")) {
        return res.status(400).json({ error: "Invalid UPI ID" });
      }
      const { data, error } = await supabase
        .from("organizer_payout_details")
        .upsert(
          {
            user_id: userId,
            payout_method: "upi",
            upi_id: upiId,
            bank_account_name: null,
            bank_name: null,
            bank_account_number: null,
            bank_ifsc: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        )
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    if (payoutMethod === "bank") {
      if (!bankAccountName || !bankName || !bankAccountNumber || !bankIfsc) {
        return res.status(400).json({ error: "All bank fields are required" });
      }
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankIfsc)) {
        return res.status(400).json({ error: "Invalid IFSC" });
      }
      const { data, error } = await supabase
        .from("organizer_payout_details")
        .upsert(
          {
            user_id: userId,
            payout_method: "bank",
            upi_id: null,
            bank_account_name: bankAccountName,
            bank_name: bankName,
            bank_account_number: bankAccountNumber,
            bank_ifsc: bankIfsc,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        )
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    return res.status(400).json({ error: "payoutMethod must be upi or bank" });
  });

  /** GET /api/organizer/payout-details/:userId */
  app.get("/api/organizer/payout-details/:userId", async (req: Request, res: Response) => {
    const uid = await resolveOrganizerId(req.params.userId);
    if (uid == null) return res.status(400).json({ error: "Invalid organizer id" });

    const { data, error } = await supabase.from("organizer_payout_details").select("*").eq("user_id", uid).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.json(null);

    const row = data as Record<string, unknown>;
    const acct = String(row.bank_account_number ?? "");
    const masked =
      acct.length > 4
        ? `${"•".repeat(Math.min(6, acct.length - 4))}${acct.slice(-4)}`
        : acct
          ? "••••"
          : null;

    return res.json({
      ...row,
      bank_account_number_masked: masked,
      bank_account_number: undefined,
    });
  });

  /** POST /api/admin/payout/:requestId/process */
  app.post("/api/admin/payout/:requestId/process", async (req: Request, res: Response) => {
    const adminKey = String(req.headers["x-admin-key"] ?? "");
    if (!adminSecretKey || adminKey !== adminSecretKey) return res.status(403).json({ error: "Unauthorized" });
    const requestId = Number(req.params.requestId);
    if (!Number.isFinite(requestId)) return res.status(400).json({ error: "Invalid request" });
    if (!cashfreePayoutEnabled) return res.status(503).json({ error: "Cashfree payouts not configured" });

    const { data: requestRow } = await supabase
      .from("payout_requests")
      .select("id,organizer_id,net_amount")
      .eq("id", requestId)
      .maybeSingle();
    if (!requestRow) return res.status(404).json({ error: "Payout request not found" });

    const { data: payoutDetails } = await supabase
      .from("organizer_payout_details")
      .select("*")
      .eq("user_id", Number((requestRow as { organizer_id?: unknown }).organizer_id))
      .maybeSingle();
    if (!payoutDetails) {
      return res.status(400).json({ error: "Organizer payout details missing" });
    }

    const amount = Number((requestRow as { net_amount?: unknown }).net_amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid payout amount" });
    }

    const bankAccountName = String((payoutDetails as { bank_account_name?: unknown }).bank_account_name || "Organizer");
    const bankAccountNumber = String((payoutDetails as { bank_account_number?: unknown }).bank_account_number || "");
    const bankIfsc = String((payoutDetails as { bank_ifsc?: unknown }).bank_ifsc || "");

    if (!bankAccountNumber || !bankIfsc) {
      return res.status(400).json({ error: "Bank account details incomplete for payout" });
    }

    const tsSuffix = String(Date.now()).slice(-6);
    const transferResult = await initiateCashfreeBankTransfer({
      transferId: `PAYOUT_admin_${requestId}_${tsSuffix}`,
      amount,
      accountNumber: bankAccountNumber,
      ifsc: bankIfsc,
      accountHolderName: bankAccountName,
      remarks: `TripSync admin payout organizer ${String((requestRow as { organizer_id?: unknown }).organizer_id)}`,
    });

    const ok = transferResult.success;
    const payload: Record<string, unknown> = {
      status: ok ? "processing" : "failed",
      processed_at: new Date().toISOString(),
      failure_reason: ok ? null : String(transferResult.error ?? "Payout failed"),
    };
    if (ok && (await hasPayoutTransferColumn())) {
      payload.cashfree_transfer_id = transferResult.referenceId || null;
    }
    const { error: updateErr } = await supabase.from("payout_requests").update(payload).eq("id", requestId);
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    if (io) {
      const oid = Number((requestRow as { organizer_id?: unknown }).organizer_id);
      io.emit("payout:updated", { requestId, organizerId: oid, status: payload.status });
    }

    if (!ok) {
      console.error("Cashfree payout failed:", transferResult.error);
      return res.status(400).json({ error: String(transferResult.error ?? "Payout failed") });
    }

    return res.json({ ok: true, transferId: transferResult.referenceId, status: "processing" });
  });
}