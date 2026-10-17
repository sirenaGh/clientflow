import type { RequestHandler } from "express";
import { db } from "./db.js";
import { HttpError } from "./errors.js";

// Fixed windows, shared by all replicas. The global budget cannot be bypassed
// by changing cookies, IP addresses, or untrusted forwarding headers.
export function publicLimit(
  kind: string,
  maximum: number,
  windowMs: number,
  sessionMaximum?: number,
): RequestHandler {
  return async (req, res, next) => {
    if (process.env.NODE_ENV !== "production") return next();
    const now = Date.now();
    const window = Math.floor(now / windowMs);
    const expiresAt = new Date((window + 1) * windowMs);
    const keys = [{ key: `${kind}:${window}`, maximum }];
    if (sessionMaximum && req.sessionKey)
      keys.push({
        key: `${kind}:${window}:${req.sessionKey}`,
        maximum: sessionMaximum,
      });
    const allowed = await db.$transaction(async (tx) => {
      for (const bucket of keys) {
        await tx.$executeRaw`INSERT INTO PublicRateBucket (\`key\`, hits, expiresAt) VALUES (${bucket.key}, 0, ${expiresAt}) ON DUPLICATE KEY UPDATE hits = hits`;
        const rows = await tx.$queryRaw<
          { hits: number }[]
        >`SELECT hits FROM PublicRateBucket WHERE \`key\` = ${bucket.key} FOR UPDATE`;
        if (rows[0].hits >= bucket.maximum) return false;
        await tx.publicRateBucket.update({
          where: { key: bucket.key },
          data: { hits: { increment: 1 } },
        });
      }
      return true;
    });
    if (!allowed) {
      res.set(
        "Retry-After",
        String(Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000))),
      );
      return next(
        new HttpError(
          429,
          "Public access limit reached. Please try again later.",
        ),
      );
    }
    next();
  };
}
