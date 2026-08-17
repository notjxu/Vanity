# Vanity — Deployment Guide (zero-cost stack)

## 1. Supabase (database, auth, storage, realtime)

1. Create a project at supabase.com — free tier, choose a region close to your customers (Frankfurt or Mumbai are closest to Bahrain).
2. SQL Editor → paste `schema.sql` → Run. This creates every table, RLS policy, and the `confirm_order_payment`/`validate_discount_code` functions in one pass.
3. **Promote your own account to admin** once you've signed up once through the app:
   ```sql
   update profiles set role = 'admin' where id = '<your-auth-user-id>';
   ```
4. Storage → create a bucket named `product-images`, set to public read (or skip this and use R2 — see step 2).
5. Settings → API → copy `Project URL`, `anon public` key, and `service_role` key (the last one is server-only, never exposed to the browser).
6. Settings → Database → confirm you're on the pooled connection string (`...pooler.supabase.com`) — the free tier's direct connection limit is easy to exhaust from serverless functions that each open their own connection.

## 2. Asset storage — Cloudflare R2 (optional, instead of Supabase Storage)

Worth doing if product photography will exceed Supabase's free storage; R2 gives 10GB free with no egress fee, which matters once the shop gets real traffic.

1. Cloudflare dashboard → R2 → create bucket `vanity-assets`.
2. Create an R2 API token scoped to that bucket only (Object Read & Write).
3. Note the bucket's S3-compatible endpoint, access key, and secret — these go into Vercel env vars in step 5.
4. If using R2, `product_images.storage_path` should store the R2 object key; serve images through a Cloudflare Worker or signed URL rather than making the bucket public.

## 3. Upstash Redis

1. Create a free Redis database at upstash.com — pick "Global" only if you need multi-region reads; "Regional" is fine and cheaper on request count for a single-country brand.
2. Copy the REST URL and REST token (the `@upstash/redis` and `@upstash/ratelimit` packages use the REST API, not a TCP connection — this matters because Vercel's serverless functions can't hold a persistent Redis connection open anyway).

## 4. Tap Payments

1. Sign up at tap.company, complete KYC for a Bahrain merchant account (required before going live — sandbox works immediately for testing).
2. Dashboard → API Keys → copy the **secret key** (server-only) and **publishable key** (safe for the client if you later add Tap's client-side card SDK).
3. Enable BenefitPay, Apple Pay, and the card schemes you want under Payment Methods.
4. For Apple Pay on web: download the domain verification file from the dashboard and place it at `public/.well-known/apple-developer-merchantid-domain-association` in the repo before deploying — Apple checks this at your production domain.
5. You do **not** need to separately register the webhook URL in the Tap dashboard — it's sent per-charge in the `post.url` field (see `lib/tap.ts`), so it just needs to be your live domain once deployed.

## 5. Vercel

1. Push the repo to GitHub, import it in Vercel, framework preset: Next.js.
2. Project → Settings → Environment Variables — add for **Production** and **Preview**:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | from Supabase step 5 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Supabase step 5 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from Supabase step 5 |
   | `UPSTASH_REDIS_REST_URL` | from Upstash step 2 |
   | `UPSTASH_REDIS_REST_TOKEN` | from Upstash step 2 |
   | `TAP_SECRET_KEY` | sandbox key first, swap to live key when ready |
   | `APP_URL` | your production URL, e.g. `https://vanity.bh` |
   | `R2_*` (if used) | from Cloudflare step 2 |

3. Deploy. Vercel's Hobby tier gives you HTTPS and a `*.vercel.app` domain automatically — add your real domain under Settings → Domains, which also auto-provisions the certificate.
4. Confirm `middleware.ts` is redirecting any stray HTTP request to HTTPS (it should never fire in practice on Vercel, but keep it as a second layer).

## 6. Go-live checklist

- [ ] Run a full sandbox purchase end-to-end: cart → checkout → Tap sandbox card → webhook lands → `payment_events` row appears → order flips to `paid` → `product_variants.stock_count` decrements by exactly the ordered quantity.
- [ ] Force a duplicate webhook delivery (resend from Tap's dashboard log, or replay the same payload with `curl`) and confirm stock does **not** decrement twice.
- [ ] Switch `TAP_SECRET_KEY` to the live key only after the above passes.
- [ ] Confirm the admin dashboard updates an order's status in real time with zero manual refresh, using two browser windows.
- [ ] Load-test the `/api/products` route past 60 req/min from one IP and confirm you get a 429, not a 500.
- [ ] Set a calendar reminder to check Supabase's free-tier project-pause policy if the site goes quiet for a stretch (a paused project needs manual un-pause from the dashboard before orders will work again).
