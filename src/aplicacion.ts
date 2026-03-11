import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifyCompress from "@fastify/compress";
import { randomUUID } from "node:crypto";

import { entorno } from "./configuracion";
import { registrarRutas } from "./rutas/index.routes";
import { errorHandler, notFoundHandler, requestIdHook } from "./utilidades/error.utilidad";
import { simpleRateLimit } from "./utilidades/rate-limit.utilidad";

export const buildApp = async () => {
  const app = Fastify({
    logger: true,
    trustProxy: true,
    bodyLimit: 1_048_576,
    genReqId: () => randomUUID()
  });

  // --- Plugins ---
  await app.register(fastifyHelmet, {
    crossOriginResourcePolicy: { policy: "cross-origin" },
    frameguard: false
  });

  await app.register(fastifyCors, {
    origin: true
  });

  await app.register(fastifyCompress);

  // --- Hooks ---
  app.addHook("onRequest", requestIdHook);
  app.addHook("onRequest", simpleRateLimit({ windowMs: 60_000, max: 3000 }));

  // --- Health endpoint ---
  app.get("/salud", async (request, reply) => {
    return {
      estado: "ok",
      servicio: "bi-backend",
      ambiente: entorno.ambiente
    };
  });

  // --- API routes ---
  await app.register(registrarRutas, { prefix: "/api" });

  // --- Error handling ---
  app.setNotFoundHandler(notFoundHandler);
  app.setErrorHandler(errorHandler);

  return app;
};
