import type { FastifyPluginAsync } from "fastify";

import {
  marcarSeguimientoRevisadoControlador,
  obtenerDetalleSeguimientoRegionControlador,
  obtenerResumenSeguimientoControlador
} from "../controladores/seguimiento.controlador";
import { requerirConfiguracionBD } from "../middleware/configuracion-bd.middleware";
import { requireCentralRole, requireSeguimientoAccess } from "../middleware/usuarios.middleware";

const seguimientoRutas: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requerirConfiguracionBD);
  fastify.addHook("preHandler", requireSeguimientoAccess);

  fastify.get("/resumen", obtenerResumenSeguimientoControlador);
  fastify.get("/regiones/:regionId", obtenerDetalleSeguimientoRegionControlador);
  fastify.patch<{ Params: { id: string }; Body: { observaciones?: string } }>(
    "/:id/revisar",
    { preHandler: requireCentralRole },
    marcarSeguimientoRevisadoControlador
  );
};

export default seguimientoRutas;
