import type { FastifyPluginAsync } from "fastify";
import {
  guardarRegistroControlador,
  obtenerRegistroControlador,
  obtenerEstadoRegistrosControlador
} from "../controladores/registro-hospitalario.controlador";
import { requerirConfiguracionBD } from "../middleware/configuracion-bd.middleware";
import { requireRegionalCaptureRole } from "../middleware/usuarios.middleware";

const registroHospitalarioRutas: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requerirConfiguracionBD);
  fastify.addHook("preHandler", requireRegionalCaptureRole);

  fastify.get("/estado", obtenerEstadoRegistrosControlador);
  fastify.get("/", obtenerRegistroControlador);
  fastify.post("/", guardarRegistroControlador);
};

export default registroHospitalarioRutas;
