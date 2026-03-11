import type { FastifyPluginAsync } from "fastify";
import {
  guardarRegistroControlador,
  obtenerRegistroControlador,
  obtenerEstadoRegistrosControlador
} from "../controladores/registro-hospitalario.controlador";
import { establecerConfiguracionBD, requerirConfiguracionBD, logConfiguracionBD } from "../middleware/configuracion-bd.middleware";

const registroHospitalarioRutas: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", establecerConfiguracionBD);
  fastify.addHook("onRequest", logConfiguracionBD);
  fastify.addHook("preHandler", requerirConfiguracionBD);

  fastify.get("/estado", obtenerEstadoRegistrosControlador);
  fastify.get("/", obtenerRegistroControlador);
  fastify.post("/", guardarRegistroControlador);
};

export default registroHospitalarioRutas;
