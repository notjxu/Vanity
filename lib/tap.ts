import crypto from "crypto";

const TAP_API_BASE = "https://api.tap.company/v2";

interface CreateChargeArgs {
  amountCents: number;
  currency: string;           // "BHD"
  orderId: string;
  customerEmail: string;
  redirectUrl: string;        // where the shopper lands after paying
}

/**
 * Creates a Tap charge. Amount is sent in the currency's major unit
 * (BHD uses 3 decimal places), so we convert from cents/fils here rather
 * than trusting the caller to get the divisor right per-currency.
 */
export async function createTapCharge({
  amountCents,
  currency,
  orderId,
  customerEmail,
  redirectUrl,
}: CreateChargeArgs) {
  // Money is stored in the DB as the currency's smallest unit (fils for BHD,
  // 3 decimals; cents for most others, 2 decimals) — see ARCHITECTURE.md
  // "money handling" for why this matters for BHD specifically.
  const decimals = currency === "BHD" || currency === "KWD" || currency === "OMR" ? 3 : 2;
  const majorAmount = amountCents / Math.pow(10, decimals);

  const res = await fetch(`${TAP_API_BASE}/charges`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TAP_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: majorAmount,
      currency,
      customer_initiated: true,
      threeDSecure: true,
      save_card: false,
      description: `Vanity order ${orderId}`,
      metadata: { order_id: orderId },
      receipt: { email: true, sms: false },
      customer: { email: customerEmail },
      source: { id: "src_all" }, // hosted checkout: cards + Apple Pay + BenefitPay
      redirect: { url: redirectUrl },
      post: { url: `${process.env.APP_URL}/api/webhooks/tap` },
    }),
  });

  if (!res.ok) {
    throw new Error(`Tap charge creation failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

interface TapChargePayload {
  id: string;
  amount: number;
  currency: string;
  status: string;
  reference?: { gateway?: string; payment?: string };
  transaction?: { created?: string };
}

/**
 * Rebuilds Tap's hashstring per their documented field order and compares
 * it to the `hashstring` request header using a constant-time check.
 * https://developers.tap.company/docs/webhook#validate-the-webhook-hashstring
 */
export function verifyTapWebhook(payload: TapChargePayload, receivedHashstring: string): boolean {
  const secret = process.env.TAP_SECRET_KEY!;
  const toHash =
    `x_id${payload.id}` +
    `x_amount${payload.amount}` +
    `x_currency${payload.currency}` +
    `x_gateway_reference${payload.reference?.gateway ?? ""}` +
    `x_payment_reference${payload.reference?.payment ?? ""}` +
    `x_status${payload.status}` +
    `x_created${payload.transaction?.created ?? ""}`;

  const expected = crypto.createHmac("sha256", secret).update(toHash).digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(receivedHashstring ?? "", "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
