import { supabaseAdmin } from "./supabase-admin";

/**
 * Soft check at checkout time: tells the shopper up front if a line item
 * won't fit, but does NOT reserve anything. Stock can still move between
 * this call and payment capture — that gap is closed by confirm_order_payment's
 * row lock, not by this function. See ARCHITECTURE.md for why that's the
 * accepted trade-off (Approach A).
 */
export async function checkStockAvailable(items: { variantId: string; quantity: number }[]) {
  const { data, error } = await supabaseAdmin
    .from("product_variants")
    .select("id, stock_count")
    .in("id", items.map((i) => i.variantId));

  if (error) throw error;

  const shortfalls = items.filter((item) => {
    const variant = data.find((v) => v.id === item.variantId);
    return !variant || variant.stock_count < item.quantity;
  });

  return { ok: shortfalls.length === 0, shortfalls };
}

/**
 * The only place stock is ever decremented. Called exclusively by the Tap
 * webhook handler after signature verification. Wraps the confirm_order_payment
 * SQL function (row-locked, idempotent — see schema.sql).
 */
export async function confirmOrderPayment(tapChargeId: string, newStatus: "paid" | "cancelled") {
  const { data, error } = await supabaseAdmin
    .rpc("confirm_order_payment", { p_tap_charge_id: tapChargeId, p_new_status: newStatus })
    .single();

  if (error) throw error;
  return data as { order_id: string; oversold: boolean };
}
