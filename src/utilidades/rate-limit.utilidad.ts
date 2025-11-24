import type { NextFunction, Request, Response } from "express";

type Options = {
  windowMs: number;
  max: number;
  keyGenerator?: (req: Request) => string;
};

// Implementación simple en memoria (por IP+path) para evitar abuso básico
export const simpleRateLimit = (opts: Options) => {
  const windowMs = Math.max(1_000, opts.windowMs);
  const max = Math.max(1, opts.max);
  const keyGen = opts.keyGenerator || ((req: Request) => `${req.ip || "?"}:${req.path}`);
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = keyGen(req);
    const entry = buckets.get(key);

    if (!entry || entry.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", String(max - 1));
      return next();
    }

    if (entry.count < max) {
      entry.count += 1;
      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", String(max - entry.count));
      return next();
    }

    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader("Retry-After", String(retryAfterSec));
    res.status(429).json({
      status: 429,
      codigo: "LIMITE_SOLICITUDES",
      mensaje: "Has excedido el número de solicitudes permitidas.",
      retryAfter: retryAfterSec,
      requestId: (req as any).requestId
    });
  };
};

