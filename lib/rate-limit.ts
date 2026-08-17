import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

// Two limiters on separate keys so a burst on one route can't starve
// the free tier's 10k req/day budget for the others.
export const checkoutLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "1 m"),   // 5 checkout attempts/min/IP
  prefix: "rl:checkout",
});

export const publicApiLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "1 m"),  // 60 reads/min/IP
  prefix: "rl:public",
});

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
