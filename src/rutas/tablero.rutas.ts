import type { FastifyPluginAsync } from "fastify";
import {
  obtenerAniosDisponiblesControlador,
  obtenerMapaHondurasControlador,
  obtenerResumenControlador
} from "../controladores/tablero.controlador";
import { establecerConfiguracionBD, requerirConfiguracionBD, logConfiguracionBD } from "../middleware/configuracion-bd.middleware";

const tableroRutas: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", establecerConfiguracionBD);
  fastify.addHook("onRequest", logConfiguracionBD);
  fastify.addHook("preHandler", requerirConfiguracionBD);

  fastify.get("/resumen", obtenerResumenControlador);
  fastify.get("/mapahonduras", obtenerMapaHondurasControlador);
  fastify.get("/anios", obtenerAniosDisponiblesControlador);
};

export default tableroRutas;
