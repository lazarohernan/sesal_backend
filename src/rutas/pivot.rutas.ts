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

  // Rate limiting para consultas pivot (max 10 consultas por minuto por IP)
  // Con 16GB RAM y 50 conexiones, podemos ser mas permisivos
  const pivotRateLimit = simpleRateLimit({
    windowMs: 60_000,
    max: 10,
    keyGenerator: (req) => `pivot:${req.ip || "unknown"}`
  });

  // Rate limiting mas permisivo para catalogos (max 60 por minuto)
  const catalogoRateLimit = simpleRateLimit({
    windowMs: 60_000,
    max: 60,
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
