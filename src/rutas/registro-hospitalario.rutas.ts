import type { FastifyPluginAsync } from "fastify";
import {
  guardarRegistroControlador,
  obtenerRegistroControlador,
  obtenerEstadoRegistrosControlador,
  obtenerVersionFormularioControlador,
  actualizarVersionFormularioControlador
} from "../controladores/registro-hospitalario.controlador";
import { requerirConfiguracionBD } from "../middleware/configuracion-bd.middleware";
import { requireRegionalCaptureRole, requireCentralRole, requireRegistroReadAccess } from "../middleware/usuarios.middleware";

const registroHospitalarioRutas: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requerirConfiguracionBD);

  // Versión activa del formulario — cualquier usuario autenticado puede leer
  fastify.get("/version-formulario", obtenerVersionFormularioControlador);
  // Cambiar versión — solo rol central (admin)
  fastify.put("/version-formulario", { preHandler: [requireCentralRole] }, actualizarVersionFormularioControlador);

  // Endpoints de captura — requieren rol regional
  fastify.get("/estado", { preHandler: [requireRegionalCaptureRole] }, obtenerEstadoRegistrosControlador);
  fastify.get("/", { preHandler: [requireRegistroReadAccess] }, obtenerRegistroControlador);
  fastify.post("/", { preHandler: [requireRegionalCaptureRole] }, guardarRegistroControlador);
  fastify.put("/", { preHandler: [requireRegionalCaptureRole] }, guardarRegistroControlador);
};

export default registroHospitalarioRutas;
