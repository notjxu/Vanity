import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyTapWebhook } from "@/lib/tap";
import { confirmOrderPayment } from "@/lib/inventory";

// Tap retries a failed POST up to 2 times, so this handler must be a fast,
// idempotent no-op on repeat delivery — never assume "first time = only time."
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const payload = JSON.parse(rawBody);
  const receivedHash = req.headers.get("hashstring") ?? "";

  const verified = verifyTapWebhook(payload, receivedHash);

  // Log every delivery attempt regardless of outcome — this table is the
  // audit trail if a dispute or an oversell needs to be investigated later.
  // The unique (tap_charge_id, event_type) constraint makes a duplicate
  // delivery a harmless insert conflict rather than double processing.
  const { error: logError } = await supabaseAdmin.from("payment_events").insert({
    tap_charge_id: payload.id,
    event_type: payload.status,
    hashstring_verified: verified,
    raw_payload: payload,
  });

  if (!verified) {
    // Still 200 so Tap doesn't keep retrying a payload that will never verify —
    // but never act on it. Alert on this in production (unexpected sender or a
    // rotated secret key).
    console.error("Tap webhook failed hashstring verification", { chargeId: payload.id });
    return NextResponse.json({ received: true }, { status: 200 });
  }

  if (logError && logError.code !== "23505") {
    // 23505 = unique_violation = duplicate delivery, which is fine.
    console.error("Failed to log payment event", logError);
  }

  if (payload.status === "CAPTURED") {
    const { oversold } = await confirmOrderPayment(payload.id, "paid");
    if (oversold) {
      // Approach A's failure mode: money was captured for stock that's gone.
      // Cancel + refund automatically rather than silently keeping the charge.
      await fetch(`https://api.tap.company/v2/refunds`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.TAP_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ charge_id: payload.id, amount: payload.amount, reason: "requested_by_customer" }),
      });
      // TODO: notify the customer their item sold out and the charge was refunded.
    }
  } else if (["FAILED", "CANCELLED", "DECLINED"].includes(payload.status)) {
    await confirmOrderPayment(payload.id, "cancelled");
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
