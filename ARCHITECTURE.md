# Vanity — Architecture

## 1. System sketch

```
                         ┌─────────────────────────┐
   Shopper's browser ───▶│  Next.js (Vercel Hobby)  │
                         │  App Router, RSC + API   │
                         └───────────┬──────────────┘
                                     │
                ┌────────────────────┼─────────────────────┐
                ▼                    ▼                      ▼
      ┌──────────────────┐ ┌──────────────────┐  ┌────────────────────┐
      │  Supabase         │ │  Upstash Redis    │  │  Cloudflare R2 /    │
      │  Postgres + Auth  │ │  rate limit +      │  │  Supabase Storage   │
      │  + RLS + Realtime │ │  product cache     │  │  (product images)   │
      └─────────┬─────────┘ └──────────────────┘  └────────────────────┘
                │  webhook (server→server, signed)
                ▼
      ┌──────────────────┐
      │   Tap Payments     │  cards · Apple Pay · PayPal · BenefitPay
      │   (hosted charge)  │
      └──────────────────┘

   Admin dashboard ── Supabase Realtime channel on `orders` ── no polling
```

Everything server-side lives in Next.js API routes on Vercel — there's no separate backend service, which is what keeps this at $0. The trade-off that shapes the rest of this doc: no persistent process, no message queue, and a 10-second default execution limit per request on the Hobby plan, so anything that needs to be reliable (payment confirmation, stock updates) has to complete in one atomic round-trip rather than a multi-step background job.

## 2. Directory structure

```
vanity/
├── app/
│   ├── (storefront)/
│   │   ├── page.tsx                    # home / hero
│   │   ├── shop/[slug]/page.tsx        # product detail
│   │   ├── cart/page.tsx
│   │   └── order/[id]/confirmation/page.tsx
│   ├── (admin)/
│   │   └── admin/
│   │       ├── layout.tsx              # gated by is_admin() check server-side
│   │       ├── orders/page.tsx         # Realtime live order feed
│   │       ├── products/page.tsx       # CRUD
│   │       └── discounts/page.tsx
│   ├── api/
│   │   ├── checkout/route.ts
│   │   ├── webhooks/tap/route.ts
│   │   ├── products/route.ts
│   │   ├── discount-codes/validate/route.ts
│   │   └── admin/
│   │       ├── products/route.ts       # admin CRUD, service-role + is_admin() check
│   │       └── orders/[id]/route.ts    # manual status override, refunds
│   ├── layout.tsx
│   └── globals.css                     # design tokens as CSS custom properties
├── components/
│   ├── ui/                             # buttons, inputs, badges — shared primitives
│   ├── storefront/
│   └── admin/
├── lib/
│   ├── supabase-admin.ts               # service-role client, server-only
│   ├── supabase-browser.ts             # anon client, RLS-scoped
│   ├── tap.ts                          # charge creation + hashstring verification
│   ├── inventory.ts                    # stock check + confirm_order_payment RPC wrapper
│   └── rate-limit.ts                   # Upstash Ratelimit instances
├── supabase/
│   └── migrations/
│       └── 0001_init.sql               # = schema.sql, versioned as a migration
├── middleware.ts                       # HTTPS redirect, security headers
├── schema.sql
├── ARCHITECTURE.md
└── DEPLOYMENT.md
```

## 3. Design tokens

The brief pins this down exactly, so there's no ambiguity to fill: strict black/white, monochrome greys, no color accent. Reference photography shows the actual signature move — a faint, almost-hidden print that only catches light at an angle. That's the one thing worth spending polish on; everything else in the UI should be quiet.

```css
:root {
  --vanity-black: #0a0a0a;       /* background — not pure #000, keeps depth in photos */
  --vanity-white: #f5f5f5;       /* primary text/accent — not pure #fff, avoids harsh glare */
  --vanity-grey-100: #1a1a1a;    /* card/panel surfaces */
  --vanity-grey-300: #3a3a3a;    /* borders, dividers */
  --vanity-grey-500: #757575;    /* secondary/muted text */
  --font-display: "Neue Montreal", "Helvetica Neue", sans-serif;  /* condensed, geometric — sits close to the logo's angularity */
  --font-body: "Inter", sans-serif;
}
```

Signature element: product cards render in grayscale by default; the garment's actual print only resolves to full contrast on hover/focus — a restrained nod to the "hidden until it catches light" quality in the brand photography, done once, not repeated as a gimmick elsewhere. Standard floor applies regardless: visible focus rings in `--vanity-white` at 2px, `prefers-reduced-motion` respected (grayscale-to-color becomes an instant swap, not a transition), and layouts tested at 375/768/1024/1440.

## 4. The hard parts

1. **Payment confirmation on a stateless backend.** No queue, no worker — the webhook handler has to verify, persist, and update inventory in one request, and do it idempotently because Tap retries failed deliveries twice.
2. **Overselling limited stock.** Multiple shoppers can check out the last unit of a size at once; only one can actually get it.
3. **Money as floating point's oldest trap, plus a regional gotcha.** BHD (and KWD, OMR) use 3 decimal places, not 2 — a generic "amount in cents" helper silently corrupts every Bahraini transaction by a factor of 10 if it assumes 2. All prices are stored in the smallest unit for their currency and converted only at the Tap API boundary (`lib/tap.ts`).
4. **Free-tier ceilings that fail silently until they don't.** Supabase free tier pauses inactive projects after a week with no traffic; Upstash free tier is 10k commands/day; Vercel Hobby functions get 10s wall-clock by default. None of these throw a helpful error in advance — they just stop working. The cache and rate-limit code above is written to spend Upstash's budget deliberately (60s TTL product cache, sliding-window limits scoped per-route) rather than opportunistically.
5. **Admin dashboard without polling.** Supabase Realtime over a WebSocket subscription on `orders` gets this for free, but only because RLS is correct — a Realtime subscription still respects RLS, so an admin-only policy on `orders` is what stops a compression-shirt shopper from watching every order in the store scroll by live.

## 5. The riskiest piece: stock + payment confirmation

This is the one place a bug costs real money — either a customer pays for something you can't ship, or two customers pay for the one unit you have left. Two ways to build it:

| | **A — Confirm-on-webhook (built above)** | **B — Reserve-then-confirm** |
|---|---|---|
| **Mechanism** | No stock touched at checkout. `confirm_order_payment()` locks the variant row and decrements only when Tap confirms `CAPTURED`. | A short-TTL hold (Redis `DECR` with a floor check, or a Postgres advisory lock) is taken the moment checkout starts; released on failure/timeout, converted to a real decrement on webhook confirmation. |
| **Oversell window** | Full payment-processing duration (can include a 3D Secure redirect — minutes, not seconds). | Shrinks to the reservation TTL, typically 5–10 minutes. |
| **Shopper experience** | Can enter card details for an item that sells out underneath them; failure surfaces as an auto-refund after the fact. | "Sold out" shows before they reach checkout, not after they've paid. |
| **Moving parts** | One system of record (Postgres), one lock. | Two systems of record (Redis hold + Postgres truth) that must stay in sync; a crash between charge creation and releasing/confirming the hold needs its own cleanup path. |
| **Cost on this stack** | Free — no extra Upstash calls. | Consumes Upstash's 10k req/day budget on every add-to-cart/checkout-start, competing with the rate limiter's own usage. |
| **Failure mode when wrong** | Occasional refunded order + apology email. | Stock shown as unavailable when it's actually free (a stale hold that didn't release), or two holds both surviving a race in the decrement logic if the Lua/EVAL script isn't actually atomic. |

**Recommendation for this build: A.** A local compression-wear brand isn't running hype drops at Supreme-restock volume; the realistic failure rate for Approach A is low, and an automatic refund with an apologetic email is a fully acceptable outcome at that scale — cheaper to build, cheaper to run, and it doesn't compete with the rate limiter for Upstash quota. Move to B only if the brand starts doing genuinely limited releases (e.g., 20 units of a drop colorway) where "sorry, refunded" becomes a real trust problem rather than an occasional edge case — and if so, scope the Redis reservation to just those flagged "drop" products rather than the whole catalog, to keep the free-tier budget intact for everything else.

## 6. Security checklist

- [x] RLS on every table; discount codes never directly queryable, only through a `SECURITY DEFINER` RPC that returns nothing for an invalid code — no timing or enumeration leak.
- [x] All order mutations happen via the service-role key in API routes; no client-side INSERT/UPDATE policy exists on `orders` at all.
- [x] Webhook hashstring verified with `crypto.timingSafeEqual`, not `===`.
- [x] Every webhook delivery logged to `payment_events` before any side effect, with a unique constraint that makes retried deliveries idempotent by construction.
- [x] Upstash rate limiting on `checkout` (5/min/IP) and public reads (60/min/IP), on separate key prefixes.
- [x] `middleware.ts` enforces HTTPS and sets `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.
- [ ] Still to configure per-environment: Tap webhook IP allowlist (see DEPLOYMENT.md), Supabase project-level API rate limits, and R2 bucket CORS scoped to the production domain only.
