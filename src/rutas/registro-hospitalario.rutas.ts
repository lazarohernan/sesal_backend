import type { FastifyPluginAsync } from "fastify";
import {
  guardarRegistroControlador,
  obtenerRegistroControlador,
  obtenerEstadoRegistrosControlador
} from "../controladores/registro-hospitalario.controlador";
import { requerirConfiguracionBD } from "../middleware/configuracion-bd.middleware";

const registroHospitalarioRutas: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requerirConfiguracionBD);

  fastify.get("/estado", obtenerEstadoRegistrosControlador);
  fastify.get("/", obtenerRegistroControlador);
  fastify.post("/", guardarRegistroControlador);
};

export default registroHospitalarioRutas;
