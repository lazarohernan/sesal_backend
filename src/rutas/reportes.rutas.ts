import type { FastifyPluginAsync } from "fastify";
import {
  obtenerControlEnviosAt2Controlador,
  obtenerIndicadoresMunicipalesControlador,
  obtenerEstadisticasCacheControlador,
  obtenerResumenMaestroAt2Controlador
} from "../controladores/reportes.controlador";
import { requireAdminAccess } from "../middleware/admin.middleware";
import { requerirConfiguracionBD } from "../middleware/configuracion-bd.middleware";

const reportesRutas: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requerirConfiguracionBD);

  fastify.get("/indicadores-municipales", obtenerIndicadoresMunicipalesControlador);
  fastify.get("/control-envios-at2", obtenerControlEnviosAt2Controlador);
  fastify.get("/resumen-maestro-at2", obtenerResumenMaestroAt2Controlador);
  fastify.get("/cache-estadisticas", { preHandler: requireAdminAccess }, obtenerEstadisticasCacheControlador);
};

export default reportesRutas;
