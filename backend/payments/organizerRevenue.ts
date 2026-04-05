/**
 * Organizer revenue / payout math (paid bookings only).
 * Trips use `name` + `price`; coupons use `code` + `discount_pct`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type RevenueTransactionRow = {
  bookingId: number;
  memberName: string;
  tripTitle: string;
  grossAmount: number;
  amountPaid: number;
  couponCode: string | null;
  couponDiscount: number;
  paymentType: "real" | "coupon" | "free_coupon";
  paidAt: string | null;
};

export type TripBreakdownRow = {
  tripId: number;
  tripTitle: string;
  totalBookings: number;
  realBookings: number;
  couponBookings: number;
  freeBookings: number;
  grossAmount: number;
  eligibleAmount: number;
};

export type RevenueWallet = {
  eligibleForPayout: number;
  availableBalance: number;
  totalPaidOut: number;
  pendingPayout: number;
};

export type OrganizerRevenueResult = {
  realRevenue: number;
  couponRevenue: number;
  freeCouponCount: number;
  freeCouponValue: number;
  realBookingCount: number;
  couponBookingCount: number;
  totalGrossRevenue: number;
  platformFee: number;
  /** Lifetime (all paid bookings); not reduced by period filter */
  eligibleForPayout: number;
  totalPaidOut: number;
  pendingPayout: number;
  availableBalance: number;
  tripBreakdown: TripBreakdownRow[];
  transactions: RevenueTransactionRow[];
  /** Same as wallet fields — explicit for clients */
  wallet: RevenueWallet;
  dateRange: { from: string; to: string } | null;
  /** true when `realRevenue` etc. are restricted to dateRange */
  isPeriodFiltered: boolean;
  /** Net eligible for the selected period only (when `isPeriodFiltered`) */
  periodEligibleForPayout?: number;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeRevenueDateRange(
  from?: string,
  to?: string,
): { fromMs: number; toMs: number; fromIso: string; toIso: string } | null {
  const f = from?.trim();
  const t = to?.trim();
  if (!f || !t) return null;
  const fromIso = /^\d{4}-\d{2}-\d{2}$/.test(f) ? `${f}T00:00:00.000Z` : f;
  const toIso = /^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T23:59:59.999Z` : t;
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) return null;
  return { fromMs, toMs, fromIso, toIso };
}

function paidAtInRange(paidAt: string | null, fromMs: number, toMs: number): boolean {
  if (paidAt == null || String(paidAt).trim() === "") return false;
  const ms = new Date(String(paidAt)).getTime();
  if (!Number.isFinite(ms)) return false;
  return ms >= fromMs && ms <= toMs;
}

type Row = Record<string, unknown>;

function aggregateRevenueFromRows(
  rows: Row[],
  tripIds: number[],
  tripMeta: Map<number, { name: string; price: number }>,
  couponById: Map<number, { code: string; discount_pct: number }>,
  userById: Map<number, string>,
  feeRate: number,
): Omit<
  OrganizerRevenueResult,
  "totalPaidOut" | "pendingPayout" | "availableBalance" | "eligibleForPayout" | "wallet" | "dateRange" | "isPeriodFiltered"
> {
  let realRevenue = 0;
  let couponRevenue = 0;
  let freeCouponCount = 0;
  let freeCouponValue = 0;
  let realBookingCount = 0;
  let couponBookingCount = 0;

  const tripAgg = new Map<
    number,
    {
      totalBookings: number;
      realBookings: number;
      couponBookings: number;
      freeBookings: number;
      grossAmount: number;
      eligibleAmount: number;
    }
  >();

  for (const id of tripIds) {
    tripAgg.set(id, {
      totalBookings: 0,
      realBookings: 0,
      couponBookings: 0,
      freeBookings: 0,
      grossAmount: 0,
      eligibleAmount: 0,
    });
  }

  const transactions: RevenueTransactionRow[] = [];

  for (const raw of rows) {
    const b = raw as {
      id?: unknown;
      trip_id?: unknown;
      user_id?: unknown;
      amount_paid?: unknown;
      coupon_id?: unknown | null;
      discount_amount?: unknown | null;
      paid_at?: unknown | null;
    };
    const bookingId = Number(b.id);
    const tripId = Number(b.trip_id);
    const uid = Number(b.user_id);
    const ap = num(b.amount_paid);
    const cid = b.coupon_id != null ? Number(b.coupon_id) : null;
    const hasCoupon = cid != null && Number.isFinite(cid);
    const tm = tripMeta.get(tripId);
    const face = tm?.price ?? 0;

    let paymentType: RevenueTransactionRow["paymentType"];
    if (hasCoupon && ap <= 0) {
      paymentType = "free_coupon";
      freeCouponCount += 1;
      freeCouponValue += face;
    } else if (hasCoupon && ap > 0) {
      paymentType = "coupon";
      couponRevenue += ap;
      couponBookingCount += 1;
    } else {
      paymentType = "real";
      realRevenue += ap;
      realBookingCount += 1;
    }

    const discount = num(b.discount_amount);
    const cinfo = hasCoupon && cid != null ? couponById.get(cid) : undefined;

    if (hasCoupon && ap <= 0) {
      const agg = tripAgg.get(tripId);
      if (agg) {
        agg.freeBookings += 1;
        agg.totalBookings += 1;
      }
    } else {
      const cash = ap;
      const eligiblePart = cash * (1 - feeRate);
      const agg = tripAgg.get(tripId);
      if (agg) {
        agg.totalBookings += 1;
        agg.grossAmount += cash;
        agg.eligibleAmount += eligiblePart;
        if (paymentType === "real") agg.realBookings += 1;
        else agg.couponBookings += 1;
      }
    }

    transactions.push({
      bookingId,
      memberName: userById.get(uid) ?? "Anonymous",
      tripTitle: tm?.name ?? "Trip",
      grossAmount: face,
      amountPaid: ap,
      couponCode: cinfo?.code ?? null,
      couponDiscount: discount,
      paymentType,
      paidAt: b.paid_at != null ? String(b.paid_at) : null,
    });
  }

  transactions.sort((a, b) => String(b.paidAt ?? "").localeCompare(String(a.paidAt ?? "")));

  const totalGrossRevenue = realRevenue + couponRevenue;
  const platformFee = totalGrossRevenue * feeRate;

  const tripBreakdown: TripBreakdownRow[] = tripIds.map((tid) => {
    const tm = tripMeta.get(tid)!;
    const a = tripAgg.get(tid)!;
    return {
      tripId: tid,
      tripTitle: tm.name,
      totalBookings: a.totalBookings,
      realBookings: a.realBookings,
      couponBookings: a.couponBookings,
      freeBookings: a.freeBookings,
      grossAmount: a.grossAmount,
      eligibleAmount: a.eligibleAmount,
    };
  });

  return {
    realRevenue,
    couponRevenue,
    freeCouponCount,
    freeCouponValue,
    realBookingCount,
    couponBookingCount,
    totalGrossRevenue,
    platformFee,
    tripBreakdown,
    transactions,
  };
}

export async function computeOrganizerRevenue(
  supabase: SupabaseClient,
  organizerId: number,
  platformFeePercent: number,
  opts?: { from?: string; to?: string },
): Promise<OrganizerRevenueResult> {
  const feeRate = Math.min(100, Math.max(0, platformFeePercent)) / 100;
  const range = opts ? normalizeRevenueDateRange(opts.from, opts.to) : null;

  const { data: trips } = await supabase
    .from("trips")
    .select("id, name, price")
    .eq("organizer_id", organizerId);

  const tripList = trips ?? [];
  const tripIds = tripList.map((t: { id: unknown }) => Number(t.id)).filter(Number.isFinite);
  const tripMeta = new Map<number, { name: string; price: number }>();
  for (const t of tripList) {
    const id = Number((t as { id: unknown }).id);
    tripMeta.set(id, {
      name: String((t as { name?: unknown }).name ?? "Trip"),
      price: num((t as { price?: unknown }).price),
    });
  }

  const emptyWallet = (): RevenueWallet => ({
    eligibleForPayout: 0,
    availableBalance: 0,
    totalPaidOut: 0,
    pendingPayout: 0,
  });

  if (tripIds.length === 0) {
    const w = emptyWallet();
    return {
      realRevenue: 0,
      couponRevenue: 0,
      freeCouponCount: 0,
      freeCouponValue: 0,
      realBookingCount: 0,
      couponBookingCount: 0,
      totalGrossRevenue: 0,
      platformFee: 0,
      eligibleForPayout: 0,
      totalPaidOut: 0,
      pendingPayout: 0,
      availableBalance: 0,
      tripBreakdown: [],
      transactions: [],
      wallet: w,
      dateRange: range ? { from: range.fromIso, to: range.toIso } : null,
      isPeriodFiltered: Boolean(range),
    };
  }

  const { data: bookings, error: bErr } = await supabase
    .from("bookings")
    .select(
      "id, trip_id, user_id, amount_paid, coupon_id, discount_amount, paid_at, payment_status",
    )
    .in("trip_id", tripIds)
    .eq("payment_status", "paid");

  if (bErr) {
    console.error("[revenue] bookings query:", bErr.message);
  }

  const allRows = (bookings ?? []) as Row[];

  const couponIds = Array.from(
    new Set(
      allRows
        .map((r: Row) => (r as { coupon_id?: unknown }).coupon_id)
        .filter((x): x is number | string => x != null)
        .map((x) => Number(x))
        .filter(Number.isFinite),
    ),
  );

  let couponById = new Map<number, { code: string; discount_pct: number }>();
  if (couponIds.length > 0) {
    const { data: cRows } = await supabase
      .from("organizer_coupons")
      .select("id, code, discount_pct")
      .in("id", couponIds);
    for (const c of cRows ?? []) {
      const id = Number((c as { id: unknown }).id);
      couponById.set(id, {
        code: String((c as { code?: unknown }).code ?? ""),
        discount_pct: num((c as { discount_pct?: unknown }).discount_pct),
      });
    }
  }

  const userIds = Array.from(
    new Set(
      allRows
        .map((r: Row) => Number((r as { user_id?: unknown }).user_id))
        .filter(Number.isFinite),
    ),
  );
  const userById = new Map<number, string>();
  if (userIds.length > 0) {
    const { data: users } = await supabase.from("users").select("id, name").in("id", userIds);
    for (const u of users ?? []) {
      userById.set(Number((u as { id: unknown }).id), String((u as { name?: unknown }).name ?? "Anonymous"));
    }
  }

  const lifetimeRows = allRows;
  const lifetimeAgg = aggregateRevenueFromRows(lifetimeRows, tripIds, tripMeta, couponById, userById, feeRate);
  const lifetimeEligibleForPayout = lifetimeAgg.totalGrossRevenue - lifetimeAgg.platformFee;

  const { data: payouts } = await supabase
    .from("payout_requests")
    .select("amount, status")
    .eq("organizer_id", organizerId);

  let totalPaidOut = 0;
  let pendingPayout = 0;
  for (const p of payouts ?? []) {
    const amt = num((p as { amount?: unknown }).amount);
    const st = String((p as { status?: unknown }).status ?? "").toLowerCase();
    if (st === "completed") totalPaidOut += amt;
    if (st === "pending" || st === "processing") pendingPayout += amt;
  }

  const availableBalance = Math.max(0, lifetimeEligibleForPayout - totalPaidOut - pendingPayout);

  const wallet: RevenueWallet = {
    eligibleForPayout: lifetimeEligibleForPayout,
    availableBalance,
    totalPaidOut,
    pendingPayout,
  };

  let revenueSlice = lifetimeAgg;
  let dateRange: { from: string; to: string } | null = null;
  let isPeriodFiltered = false;

  if (range) {
    const periodRows = allRows.filter((raw) => {
      const paidAt = (raw as { paid_at?: unknown }).paid_at;
      return paidAtInRange(paidAt != null ? String(paidAt) : null, range.fromMs, range.toMs);
    });
    revenueSlice = aggregateRevenueFromRows(periodRows, tripIds, tripMeta, couponById, userById, feeRate);
    dateRange = { from: range.fromIso, to: range.toIso };
    isPeriodFiltered = true;
  }

  const periodEligibleForPayout = revenueSlice.totalGrossRevenue - revenueSlice.platformFee;

  const base: OrganizerRevenueResult = {
    realRevenue: revenueSlice.realRevenue,
    couponRevenue: revenueSlice.couponRevenue,
    freeCouponCount: revenueSlice.freeCouponCount,
    freeCouponValue: revenueSlice.freeCouponValue,
    realBookingCount: revenueSlice.realBookingCount,
    couponBookingCount: revenueSlice.couponBookingCount,
    totalGrossRevenue: revenueSlice.totalGrossRevenue,
    platformFee: revenueSlice.platformFee,
    eligibleForPayout: lifetimeEligibleForPayout,
    totalPaidOut,
    pendingPayout,
    availableBalance,
    tripBreakdown: revenueSlice.tripBreakdown,
    transactions: revenueSlice.transactions,
    wallet,
    dateRange,
    isPeriodFiltered,
  };
  if (isPeriodFiltered) base.periodEligibleForPayout = periodEligibleForPayout;
  return base;
}
