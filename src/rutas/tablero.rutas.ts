import type { FastifyPluginAsync } from "fastify";
import {
  obtenerAniosDisponiblesControlador,
  obtenerMapaHondurasControlador,
  obtenerResumenControlador
} from "../controladores/tablero.controlador";
import { requerirConfiguracionBD } from "../middleware/configuracion-bd.middleware";

const tableroRutas: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requerirConfiguracionBD);

  fastify.get("/resumen", obtenerResumenControlador);
  fastify.get("/mapahonduras", obtenerMapaHondurasControlador);
  fastify.get("/anios", obtenerAniosDisponiblesControlador);
};

export default tableroRutas;
