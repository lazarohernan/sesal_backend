import type { FastifyPluginAsync } from "fastify";
import {
  obtenerIndicadoresMunicipalesControlador,
  obtenerEstadisticasCacheControlador
} from "../controladores/reportes.controlador";
import { requireAdminAccess } from "../middleware/admin.middleware";
import { requerirConfiguracionBD } from "../middleware/configuracion-bd.middleware";

const reportesRutas: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requerirConfiguracionBD);

  fastify.get("/indicadores-municipales", obtenerIndicadoresMunicipalesControlador);
  fastify.get("/cache-estadisticas", { preHandler: requireAdminAccess }, obtenerEstadisticasCacheControlador);
};

export default reportesRutas;
