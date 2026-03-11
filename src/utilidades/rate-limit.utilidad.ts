import type { FastifyRequest, FastifyReply } from "fastify";

type Options = {
  windowMs: number;
  max: number;
  keyGenerator?: (req: FastifyRequest) => string;
};

export const simpleRateLimit = (opts: Options) => {
  const windowMs = Math.max(1_000, opts.windowMs);
  const max = Math.max(1, opts.max);
  const keyGen = opts.keyGenerator || ((req: FastifyRequest) => `${req.ip || "?"}:${req.url}`);
  const buckets = new Map<string, { count: number; resetAt: number }>();

  // Limpiar entradas expiradas cada 5 minutos
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets.entries()) {
      if (entry.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }, 5 * 60 * 1000);
  cleanup.unref();

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const now = Date.now();
    const key = keyGen(request);
    const entry = buckets.get(key);

    if (!entry || entry.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      reply.header("X-RateLimit-Limit", String(max));
      reply.header("X-RateLimit-Remaining", String(max - 1));
      return;
    }

    if (entry.count < max) {
      entry.count += 1;
      reply.header("X-RateLimit-Limit", String(max));
      reply.header("X-RateLimit-Remaining", String(max - entry.count));
      return;
    }

    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    reply.header("Retry-After", String(retryAfterSec));
    return reply.status(429).send({
      status: 429,
      codigo: "LIMITE_SOLICITUDES",
      mensaje: "Has excedido el numero de solicitudes permitidas.",
      retryAfter: retryAfterSec,
      requestId: request.id
    });
  };
};
