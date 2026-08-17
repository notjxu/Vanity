import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { checkStockAvailable } from "@/lib/inventory";
import { createTapCharge } from "@/lib/tap";
import { checkoutLimiter, clientIp } from "@/lib/rate-limit";

interface CheckoutBody {
  items: { variantId: string; quantity: number }[];
  email: string;
  discountCode?: string;
  shippingAddress: Record<string, string>;
}

export async function POST(req: NextRequest) {
  const { success } = await checkoutLimiter.limit(clientIp(req));
  if (!success) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  const body = (await req.json()) as CheckoutBody;

  if (!body.items?.length || !body.email || !body.shippingAddress) {
    return NextResponse.json({ error: "Missing required checkout fields." }, { status: 400 });
  }

  // 1. Soft stock check — fast feedback, not a guarantee (see lib/inventory.ts)
  const stockCheck = await checkStockAvailable(body.items);
  if (!stockCheck.ok) {
    return NextResponse.json(
      { error: "Some items just sold out.", shortfalls: stockCheck.shortfalls },
      { status: 409 }
    );
  }

  // 2. Price the order server-side — never trust client-submitted totals
  const variantIds = body.items.map((i) => i.variantId);
  const { data: variants, error: variantErr } = await supabaseAdmin
    .from("product_variants")
    .select("id, sku, size, color, price_cents, products(name, base_price_cents)")
    .in("id", variantIds);

  if (variantErr || !variants) {
    return NextResponse.json({ error: "Could not price order." }, { status: 500 });
  }

  let subtotalCents = 0;
  const orderItems = body.items.map((item) => {
    const v = variants.find((x) => x.id === item.variantId)!;
    const unitPrice = v.price_cents ?? (v.products as any).base_price_cents;
    const lineTotal = unitPrice * item.quantity;
    subtotalCents += lineTotal;
    return {
      variant_id: v.id,
      product_name_snapshot: (v.products as any).name,
      variant_label_snapshot: `${v.size} / ${v.color}`,
      unit_price_cents: unitPrice,
      quantity: item.quantity,
      line_total_cents: lineTotal,
    };
  });

  // 3. Apply discount code via the RPC (only sanctioned path — see schema.sql)
  let discountCents = 0;
  let discountCodeId: string | null = null;
  if (body.discountCode) {
    const { data: discount } = await supabaseAdmin
      .rpc("validate_discount_code", { p_code: body.discountCode, p_subtotal_cents: subtotalCents })
      .single();
    if (discount) {
      discountCodeId = (discount as any).id;
      discountCents =
        (discount as any).type === "percent"
          ? Math.round((subtotalCents * (discount as any).value) / 100)
          : (discount as any).value;
    }
  }

  const shippingCents = subtotalCents >= 5000 ? 0 : 1500; // flat example rule
  const totalCents = Math.max(subtotalCents - discountCents, 0) + shippingCents;

  // 4. Create the order in `awaiting_payment` — stock is untouched until the webhook fires
  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .insert({
      guest_email: body.email,
      status: "awaiting_payment",
      subtotal_cents: subtotalCents,
      discount_cents: discountCents,
      shipping_cents: shippingCents,
      total_cents: totalCents,
      currency: "BHD",
      discount_code_id: discountCodeId,
      shipping_address: body.shippingAddress,
    })
    .select()
    .single();

  if (orderErr || !order) {
    return NextResponse.json({ error: "Could not create order." }, { status: 500 });
  }

  await supabaseAdmin.from("order_items").insert(
    orderItems.map((oi) => ({ ...oi, order_id: order.id }))
  );

  // 5. Create the Tap charge and hand the shopper its redirect URL
  try {
    const charge = await createTapCharge({
      amountCents: totalCents,
      currency: "BHD",
      orderId: order.id,
      customerEmail: body.email,
      redirectUrl: `${process.env.APP_URL}/order/${order.id}/confirmation`,
    });

    await supabaseAdmin.from("orders").update({ tap_charge_id: charge.id }).eq("id", order.id);

    return NextResponse.json({ orderId: order.id, paymentUrl: charge.transaction.url });
  } catch (e) {
    await supabaseAdmin.from("orders").update({ status: "cancelled" }).eq("id", order.id);
    return NextResponse.json({ error: "Payment provider error. Order cancelled." }, { status: 502 });
  }
}
