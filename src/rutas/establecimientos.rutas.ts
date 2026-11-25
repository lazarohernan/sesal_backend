import type { FastifyPluginAsync } from "fastify";
import {
  listarEstablecimientosControlador,
  listarNivelesControlador,
  listarMunicipiosControlador,
  crearEstablecimientoControlador,
  cambiarEstadoControlador,
  actualizarEstablecimientoControlador,
  actualizarAtributosControlador,
  cargarPoblacionControlador,
} from "../controladores/establecimientos.controlador";
import { requireCentralRole } from "../middleware/usuarios.middleware";

const establecimientosRutas: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requireCentralRole);

  fastify.get("/", listarEstablecimientosControlador);
  fastify.get("/niveles", listarNivelesControlador);
  fastify.get("/municipios", listarMunicipiosControlador);
  fastify.post("/", crearEstablecimientoControlador);
  fastify.patch("/:id", actualizarEstablecimientoControlador);
  fastify.patch("/:id/estado", cambiarEstadoControlador);
  fastify.patch("/:id/atributos", actualizarAtributosControlador);
  fastify.post("/poblacion", cargarPoblacionControlador);
};

export default establecimientosRutas;
