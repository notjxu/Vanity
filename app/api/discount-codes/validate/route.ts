import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { publicApiLimiter, clientIp } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const { success } = await publicApiLimiter.limit(clientIp(req));
  if (!success) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const { code, subtotalCents } = await req.json();

  // Same RPC the checkout route uses — the discount_codes table itself is
  // never queried directly from a client-reachable path (see schema.sql RLS).
  const { data, error } = await supabaseAdmin
    .rpc("validate_discount_code", { p_code: code, p_subtotal_cents: subtotalCents })
    .single();

  if (error || !data) {
    return NextResponse.json({ valid: false }, { status: 200 });
  }

  return NextResponse.json({ valid: true, ...data });
}
