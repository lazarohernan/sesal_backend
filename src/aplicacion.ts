import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifyCompress from "@fastify/compress";
import { randomUUID } from "node:crypto";

import { entorno } from "./configuracion";
import { registrarRutas } from "./rutas/index.routes";
import { errorHandler, notFoundHandler, requestIdHook } from "./utilidades/error.utilidad";
import { simpleRateLimit } from "./utilidades/rate-limit.utilidad";
import { logger } from "./utilidades/registro.utilidad";

const normalizarOrigen = (origen: string) => origen.trim().replace(/\/$/, "").toLowerCase();

const esOrigenLocalDesarrollo = (origin: string) => {
  try {
    const url = new URL(origin);
    return ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch (_error) {
    return false;
  }
};

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
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      const origenesPermitidos = entorno.cors.origenes;
      if (origenesPermitidos.length === 0) {
        callback(null, true);
        return;
      }

      const permitido = origenesPermitidos
        .map(normalizarOrigen)
        .includes(normalizarOrigen(origin));

      if (!permitido && !entorno.esProduccion && esOrigenLocalDesarrollo(origin)) {
        callback(null, true);
        return;
      }

      callback(null, permitido);
    }
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

  if (entorno.esProduccion && entorno.cors.origenes.length === 0) {
    logger.warn("CORS_ORIGINS no esta configurado en produccion. Se permiten origenes dinamicos.");
  }

  // --- Error handling ---
  app.setNotFoundHandler(notFoundHandler);
  app.setErrorHandler(errorHandler);

  return app;
};
