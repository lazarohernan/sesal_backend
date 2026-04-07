import type { FastifyPluginAsync } from "fastify";

import {
  cambiarEstadoUsuarioRegionalControlador,
  eliminarUsuarioRegionalControlador,
  resetearPasswordUsuarioRegionalControlador,
  actualizarUsuarioRegionalControlador,
  crearUsuarioRegionalControlador,
  listarUsuariosControlador
} from "../controladores/usuarios.controlador";
import { requireCentralRole } from "../middleware/usuarios.middleware";

const usuariosRutas: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requireCentralRole);

  fastify.get("/", listarUsuariosControlador);
  fastify.post("/", crearUsuarioRegionalControlador);
  fastify.patch("/:id", actualizarUsuarioRegionalControlador);
  fastify.patch("/:id/estado", cambiarEstadoUsuarioRegionalControlador);
  fastify.post("/:id/reset-password", resetearPasswordUsuarioRegionalControlador);
  fastify.delete("/:id", eliminarUsuarioRegionalControlador);
};

export default usuariosRutas;
