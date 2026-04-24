/**
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
  const payoutBaseUrl = `${cashfreeBaseUrl.replace(/\/$/, "")}/payout`;

  const cashfree = new Cashfree(
    cashfreeBaseUrl.includes("sandbox") ? CFEnvironment.SANDBOX : CFEnvironment.PRODUCTION,
    cashfreeAppId,
    cashfreeSecretKey,
  );

  const hasBookingCashfreeColsCache: { value: boolean | null } = { value: null };
  const hasPayoutTransferColCache: { value: boolean | null } = { value: null };

  function detectPublicBaseUrl(req: Request): string {
    const explicit = String(backendPublicUrl || "").trim();
    if (explicit && !/^https?:\/\/localhost(?::\d+)?$/i.test(explicit)) {
      return explicit.replace(/\/$/, "");
    }
    const xfProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const xfHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
    const host = xfHost || String(req.headers.host || "").trim();
    const proto = xfProto || (host.includes("localhost") || host.startsWith("127.") ? "http" : "http");
    if (host) return `${proto}://${host}`.replace(/\/$/, "");
    return explicit.replace(/\/$/, "") || "http://localhost:3000";
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

        if (io) {
          io.to(`trip-${Number((booking as { trip_id?: unknown }).trip_id)}`).emit("payment:confirmed", {
            bookingId,
            tripId: Number((booking as { trip_id?: unknown }).trip_id),
            userId: Number((booking as { user_id?: unknown }).user_id),
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

  /** POST /api/organizer/payout/request */
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
    if (!cashfreeEnabled) return res.status(503).json({ error: "Cashfree is not configured" });

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

    const transferId = `PAYOUT_${requestId}_${Date.now()}`;
    const amount = Number((requestRow as { net_amount?: unknown }).net_amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid payout amount" });
    }
    const method = String((payoutDetails as { payout_method?: unknown }).payout_method ?? "upi");

    const payoutResponse = await fetch(`${payoutBaseUrl}/v1/directTransfer`, {
      method: "POST",
      headers: {
        "X-Client-Id": cashfreeAppId,
        "X-Client-Secret": cashfreeSecretKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transferId,
        amount,
        currency: "INR",
        purpose: "Trip-Sync Organizer Payout",
        beneficiary:
          method === "upi"
            ? {
                name: String((payoutDetails as { bank_account_name?: unknown }).bank_account_name || "Organizer"),
                email: "organizer@tripsync.app",
                phone: "9999999999",
                vpa: String((payoutDetails as { upi_id?: unknown }).upi_id || ""),
              }
            : {
                name: String((payoutDetails as { bank_account_name?: unknown }).bank_account_name || "Organizer"),
                email: "organizer@tripsync.app",
                phone: "9999999999",
                bankAccount: String((payoutDetails as { bank_account_number?: unknown }).bank_account_number || ""),
                ifsc: String((payoutDetails as { bank_ifsc?: unknown }).bank_ifsc || ""),
              },
        remarks: `TripSync payout for organizer ${String((requestRow as { organizer_id?: unknown }).organizer_id)}`,
      }),
    });
    const result = (await payoutResponse.json().catch(() => ({}))) as { status?: string; message?: string };

    const ok = String(result?.status ?? "").toUpperCase() === "SUCCESS";
    const payload: Record<string, unknown> = {
      status: ok ? "processing" : "failed",
      processed_at: new Date().toISOString(),
      failure_reason: ok ? null : String(result?.message ?? "Payout failed"),
    };
    if (ok && (await hasPayoutTransferColumn())) {
      payload.cashfree_transfer_id = transferId;
    }
    const { error: updateErr } = await supabase.from("payout_requests").update(payload).eq("id", requestId);
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    if (io) {
      const oid = Number((requestRow as { organizer_id?: unknown }).organizer_id);
      io.emit("payout:updated", { requestId, organizerId: oid, status: payload.status });
    }

    if (!ok) {
      console.error("Cashfree payout failed:", result);
      return res.status(400).json({ error: String(result?.message ?? "Payout failed") });
    }

    return res.json({ ok: true, transferId, status: "processing" });
  });
}
