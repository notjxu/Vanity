import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { publicApiLimiter, clientIp } from "@/lib/rate-limit";

const redis = Redis.fromEnv();
const CACHE_KEY = "cache:products:active";
const CACHE_TTL_SECONDS = 60; // short TTL: admin edits should show up within a minute

export async function GET(req: NextRequest) {
  const { success } = await publicApiLimiter.limit(clientIp(req));
  if (!success) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const cached = await redis.get(CACHE_KEY);
  if (cached) {
    return NextResponse.json(cached, { headers: { "x-cache": "HIT" } });
  }

  const { data, error } = await supabaseAdmin
    .from("products")
    .select(
      "id, slug, name, description, base_price_cents, currency, " +
      "product_variants(id, size, color, sku, price_cents, stock_count), " +
      "product_images(storage_path, alt_text, sort_order)"
    )
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Could not load products." }, { status: 500 });
  }

  await redis.set(CACHE_KEY, data, { ex: CACHE_TTL_SECONDS });
  return NextResponse.json(data, { headers: { "x-cache": "MISS" } });
}
