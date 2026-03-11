import type { FastifyPluginAsync } from "fastify";
import {
  obtenerIndicadoresMunicipalesControlador,
  obtenerEstadisticasCacheControlador
} from "../controladores/reportes.controlador";
import {
  establecerConfiguracionBD,
  logConfiguracionBD,
  requerirConfiguracionBD
} from "../middleware/configuracion-bd.middleware";

const reportesRutas: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", establecerConfiguracionBD);
  fastify.addHook("onRequest", logConfiguracionBD);
  fastify.addHook("preHandler", requerirConfiguracionBD);

  fastify.get("/indicadores-municipales", obtenerIndicadoresMunicipalesControlador);
  fastify.get("/cache-estadisticas", obtenerEstadisticasCacheControlador);
};

export default reportesRutas;
