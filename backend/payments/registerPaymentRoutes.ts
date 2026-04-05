/**
 * PayU hosted checkout + organizer payouts (Express).
 * Secrets: PAYU_MERCHANT_KEY, PAYU_MERCHANT_SALT — server env only.
 */
import type { Express, Request, Response } from "express";
import type { Server } from "socket.io";
import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { computeOrganizerRevenue } from "./organizerRevenue.js";

export type PaymentRoutesContext = {
  supabase: SupabaseClient;
  io: Server | null;
  /** Public base URL for PayU surl/furl, e.g. https://api.example.com or http://192.168.1.5:3000 */
  backendPublicUrl: string;
  platformFeePercent: number;
  payuKey: string;
  payuSalt: string;
  payuBaseUrl: string;
  adminSecretKey: string;
  incrementOrganizerCouponUsage: (couponId: number) => Promise<boolean>;
  /** When false, PayU checkout routes are omitted (organizer + admin routes still register). */
  enablePayuCheckout: boolean;
  /**
   * Resolve public.users id from route param (numeric id, auth UUID, or email).
   * Required for mobile clients where `user.id` may not be numeric.
   */
  resolveOrganizerId: (input: unknown) => Promise<number | null>;
};

function sha512Hex(s: string): string {
  return crypto.createHash("sha512").update(s).digest("hex");
}

/** PayU request hash (matches Trip-Sync / PayU default pipe sequence). */
export function payuRequestHash(params: {
  key: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  salt: string;
}): string {
  const { key, txnid, amount, productinfo, firstname, email, salt } = params;
  const hashStr = `${key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|||||||||||${salt}`;
  return sha512Hex(hashStr);
}

/** PayU response verification (reverse hash). */
export function payuResponseHash(params: {
  salt: string;
  status: string;
  email: string;
  firstname: string;
  productinfo: string;
  amount: string;
  txnid: string;
  key: string;
}): string {
  const { salt, status, email, firstname, productinfo, amount, txnid, key } = params;
  const hashStr = `${salt}|${status}|||||||||||${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
  return sha512Hex(hashStr);
}

function parseTxnBookingId(txnid: string): number | null {
  const parts = String(txnid || "").split("_");
  const last = parts[parts.length - 1];
  const n = Number(last);
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
    payuKey,
    payuSalt,
    payuBaseUrl,
    adminSecretKey,
    incrementOrganizerCouponUsage,
    enablePayuCheckout,
    resolveOrganizerId,
  } = ctx;

  const payuPaymentPath = `${payuBaseUrl.replace(/\/$/, "")}/_payment`;

  async function resolveUserIdByEmail(email: string): Promise<number | null> {
    const e = String(email || "").trim().toLowerCase();
    if (!e) return null;
    const { data } = await supabase.from("users").select("id").eq("email", e).maybeSingle();
    return data?.id != null ? Number(data.id) : null;
  }

  /** POST /api/payments/initiate */
  const initiateHandler = async (req: Request, res: Response) => {
    try {
      const tripId = Number(req.body?.tripId);
      const bookingId = Number(req.body?.bookingId);
      const clientAmount = Number(req.body?.amount);
      const userEmail = String(req.body?.userEmail ?? "").trim();
      const userPhone = String(req.body?.userPhone ?? "").replace(/\D/g, "").slice(0, 15);
      const userName = String(req.body?.userName ?? "TripSync User").trim() || "TripSync User";

      if (!Number.isFinite(tripId) || !Number.isFinite(bookingId)) {
        return res.status(400).json({ error: "tripId and bookingId are required" });
      }

      const uid = await resolveUserIdByEmail(userEmail);
      if (uid == null) {
        return res.status(400).json({ error: "Unknown user email" });
      }

      const { data: booking, error: bErr } = await supabase
        .from("bookings")
        .select("id, trip_id, user_id, payment_status, final_amount, coupon_id")
        .eq("id", bookingId)
        .maybeSingle();

      if (bErr || !booking) {
        return res.status(404).json({ error: "Booking not found" });
      }
      if (Number(booking.trip_id) !== tripId || Number(booking.user_id) !== uid) {
        return res.status(403).json({ error: "Booking does not match trip/user" });
      }
      if (String(booking.payment_status) !== "pending") {
        return res.status(400).json({ error: "Booking is not awaiting payment" });
      }

      const finalAmount = Number((booking as { final_amount?: unknown }).final_amount ?? NaN);
      if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
        return res.status(400).json({ error: "Invalid payable amount on booking" });
      }
      if (Number.isFinite(clientAmount) && Math.abs(clientAmount - finalAmount) > 0.01) {
        return res.status(400).json({ error: "Amount mismatch" });
      }

      const amountStr = finalAmount.toFixed(2);
      const productinfo = `Trip Ticket - ${tripId}`;
      const txnid = `TRIPSYNC_${Date.now()}_${bookingId}`;

      const hash = payuRequestHash({
        key: payuKey,
        txnid,
        amount: amountStr,
        productinfo,
        firstname: userName.slice(0, 60),
        email: userEmail.toLowerCase(),
        salt: payuSalt,
      });

      const surl = `${backendPublicUrl.replace(/\/$/, "")}/api/payments/success`;
      const furl = `${backendPublicUrl.replace(/\/$/, "")}/api/payments/failure`;

      return res.json({
        payuUrl: payuPaymentPath,
        key: payuKey,
        txnid,
        amount: amountStr,
        productinfo,
        firstname: userName.slice(0, 60),
        email: userEmail.toLowerCase(),
        phone: userPhone || "9999999999",
        surl,
        furl,
        hash,
      });
    } catch (e) {
      console.error("[payments/initiate]", e);
      return res.status(500).json({ error: "Failed to initiate payment" });
    }
  };

  if (enablePayuCheckout && payuKey && payuSalt) {
    app.post("/api/payments/initiate", initiateHandler);
  } else {
    app.post("/api/payments/initiate", (_req: Request, res: Response) => {
      return res.status(503).json({
        error: "PayU is not configured",
        hint: "Set PAYU_MERCHANT_KEY and PAYU_MERCHANT_SALT in backend/.env",
      });
    });
  }

  async function handlePayuReturn(req: Request, res: Response, expectSuccess: boolean) {
    const body = req.body as Record<string, string | undefined>;
    const status = String(body?.status ?? "");
    const txnid = String(body?.txnid ?? "");
    const hashFromPayu = String(body?.hash ?? "").toLowerCase();
    const key = String(body?.key ?? payuKey);
    const amount = String(body?.amount ?? "");
    const productinfo = String(body?.productinfo ?? "");
    const firstname = String(body?.firstname ?? "");
    const email = String(body?.email ?? "");
    const mihpayid = String(body?.mihpayid ?? "");

    const expected = payuResponseHash({
      salt: payuSalt,
      status,
      email,
      firstname,
      productinfo,
      amount,
      txnid,
      key,
    }).toLowerCase();

    if (!hashFromPayu || hashFromPayu !== expected) {
      console.warn("[payments] hash mismatch — possible tampering", { txnid, status });
      return res.status(400).send("Invalid hash");
    }

    const bookingId = parseTxnBookingId(txnid);
    if (bookingId == null) {
      return res.status(400).send("Invalid txnid");
    }

    const { data: booking } = await supabase
      .from("bookings")
      .select("id, trip_id, user_id, payment_status, coupon_id")
      .eq("id", bookingId)
      .maybeSingle();

    if (!booking) {
      return res.status(404).send("Booking not found");
    }

    const tripId = Number((booking as { trip_id?: unknown }).trip_id);
    const stLower = status.toLowerCase();

    if (!expectSuccess || stLower !== "success") {
      await supabase
        .from("bookings")
        .update({ payment_status: "failed" })
        .eq("id", bookingId)
        .eq("payment_status", "pending");

      if (io) {
        io.to(`trip-${tripId}`).emit("payment:failed", {
          bookingId,
          tripId,
          userId: Number((booking as { user_id?: unknown }).user_id),
        });
      }

      return res.redirect(302, `tripsync://payment/failure?txnid=${encodeURIComponent(txnid)}`);
    }

    if (expectSuccess && stLower === "success") {
      const paid = parseFloat(amount);
      if (!Number.isFinite(paid) || paid <= 0) {
        return res.status(400).send("Invalid amount");
      }

      const platformFee = paid * (platformFeePercent / 100);
      const organizerNet = paid - platformFee;

      const { error: upErr } = await supabase
        .from("bookings")
        .update({
          payment_status: "paid",
          payu_txn_id: mihpayid || txnid,
          amount_paid: paid,
          paid_at: new Date().toISOString(),
          platform_fee_amount: platformFee,
          organizer_net_amount: organizerNet,
          status: "confirmed",
        })
        .eq("id", bookingId)
        .eq("payment_status", "pending");

      if (upErr) {
        console.error("[payments/success] update booking:", upErr.message);
        return res.status(500).send("Update failed");
      }

      const couponId = (booking as { coupon_id?: unknown }).coupon_id;
      if (couponId != null && Number.isFinite(Number(couponId))) {
        const okInc = await incrementOrganizerCouponUsage(Number(couponId));
        if (!okInc) console.warn("[payments/success] coupon increment failed", couponId);
      }

      let organizerIdForEmit: number | null = null;
      const { data: tripRow } = await supabase.from("trips").select("organizer_id").eq("id", tripId).maybeSingle();
      if (tripRow && (tripRow as { organizer_id?: unknown }).organizer_id != null) {
        organizerIdForEmit = Number((tripRow as { organizer_id: unknown }).organizer_id);
      }

      if (io) {
        io.to(`trip-${tripId}`).emit("payment:confirmed", {
          bookingId,
          tripId,
          userId: Number((booking as { user_id?: unknown }).user_id),
          amount: paid,
          organizerId: organizerIdForEmit,
        });
        if (organizerIdForEmit != null && Number.isFinite(organizerIdForEmit)) {
          io.emit("payment:confirmed", {
            bookingId,
            tripId,
            userId: Number((booking as { user_id?: unknown }).user_id),
            amount: paid,
            organizerId: organizerIdForEmit,
          });
        }
      }

      return res.redirect(302, `tripsync://payment/success?txnid=${encodeURIComponent(txnid)}`);
    }

    return res.redirect(302, `tripsync://payment/failure?txnid=${encodeURIComponent(txnid)}`);
  }

  if (enablePayuCheckout && payuKey && payuSalt) {
    app.post("/api/payments/success", async (req: Request, res: Response) => {
      return handlePayuReturn(req, res, true);
    });

    app.post("/api/payments/failure", async (req: Request, res: Response) => {
      return handlePayuReturn(req, res, false);
    });
  }

  /** GET /api/payments/verify/:txnid */
  app.get("/api/payments/verify/:txnid", async (req: Request, res: Response) => {
    const txnid = String(req.params.txnid ?? "");
    const bookingId = parseTxnBookingId(txnid);
    if (bookingId == null) {
      return res.status(400).json({ error: "Invalid txnid" });
    }
    const { data: booking } = await supabase
      .from("bookings")
      .select("payment_status, payu_txn_id, amount_paid, paid_at")
      .eq("id", bookingId)
      .maybeSingle();

    if (!booking) return res.status(404).json({ error: "Not found" });
    return res.json({
      payment_status: booking.payment_status,
      payu_txn_id: booking.payu_txn_id,
      amount_paid: booking.amount_paid,
      paid_at: booking.paid_at,
    });
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

    const r = await computeOrganizerRevenue(supabase, organizerId, platformFeePercent, range);
    return res.json({
      ...r,
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

  /** POST /api/admin/payout/:requestId/update */
  app.post("/api/admin/payout/:requestId/update", async (req: Request, res: Response) => {
    const adminKey = String(req.headers["x-admin-key"] ?? "");
    if (!adminSecretKey || adminKey !== adminSecretKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const requestId = Number(req.params.requestId);
    const status = String(req.body?.status ?? "");
    const payuTransferId = req.body?.payu_transfer_id != null ? String(req.body.payu_transfer_id) : null;
    const failureReason = req.body?.failure_reason != null ? String(req.body.failure_reason) : null;

    if (!Number.isFinite(requestId) || !["completed", "failed", "processing"].includes(status)) {
      return res.status(400).json({ error: "Invalid request" });
    }

    const { data: row } = await supabase
      .from("payout_requests")
      .select("organizer_id")
      .eq("id", requestId)
      .maybeSingle();

    const { error } = await supabase
      .from("payout_requests")
      .update({
        status,
        processed_at: new Date().toISOString(),
        payu_transfer_id: payuTransferId,
        failure_reason: failureReason,
      })
      .eq("id", requestId);

    if (error) return res.status(500).json({ error: error.message });

    if (io && row && (row as { organizer_id?: number }).organizer_id != null) {
      const oid = Number((row as { organizer_id?: unknown }).organizer_id);
      io.emit("payout:updated", { requestId, organizerId: oid, status });
    }

    return res.json({ ok: true });
  });
}
