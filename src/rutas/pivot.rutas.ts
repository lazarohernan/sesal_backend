import type { FastifyPluginAsync } from "fastify";
import {
  aniosDisponiblesPivotControlador,
  catalogoPivotControlador,
  ejecutarPivotControlador,
  valoresDimensionPivotControlador,
  estadisticasCacheControlador,
  mesesOcupadosControlador
} from "../controladores/pivot.controlador";
import {
  establecerConfiguracionBD,
  logConfiguracionBD,
  requerirConfiguracionBD
} from "../middleware/configuracion-bd.middleware";
import { simpleRateLimit } from "../utilidades/rate-limit.utilidad";

const pivotRutas: FastifyPluginAsync = async (fastify) => {
  // Register hooks for all routes in this plugin
  fastify.addHook("onRequest", establecerConfiguracionBD);
  fastify.addHook("onRequest", logConfiguracionBD);
  fastify.addHook("preHandler", requerirConfiguracionBD);

  // Rate limiting para consultas pivot (max 300 por minuto por IP)
  // Alto porque CloudFront comparte IPs entre usuarios
  const pivotRateLimit = simpleRateLimit({
    windowMs: 60_000,
    max: 300,
    keyGenerator: (req) => `pivot:${req.ip || "unknown"}`
  });

  // Rate limiting para catalogos (max 600 por minuto)
  const catalogoRateLimit = simpleRateLimit({
    windowMs: 60_000,
    max: 600,
    keyGenerator: (req) => `catalogo:${req.ip || "unknown"}`
  });

  fastify.get("/catalogo", { preHandler: catalogoRateLimit }, catalogoPivotControlador);
  fastify.get("/anios", { preHandler: catalogoRateLimit }, aniosDisponiblesPivotControlador);
  fastify.get("/meses-ocupados", { preHandler: catalogoRateLimit }, mesesOcupadosControlador);
  fastify.get("/dimensiones/:dimensionId/valores", { preHandler: catalogoRateLimit }, valoresDimensionPivotControlador);
  fastify.post("/consulta", { preHandler: pivotRateLimit }, ejecutarPivotControlador);
  fastify.get("/cache/stats", estadisticasCacheControlador);
};

export default pivotRutas;
