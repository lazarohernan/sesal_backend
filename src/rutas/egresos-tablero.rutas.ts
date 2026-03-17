import type { FastifyPluginAsync } from "fastify";

import {
  obtenerAniosEgresosTableroControlador,
  obtenerIndicadoresDepartamentoEgresosControlador,
  obtenerMapaHondurasEgresosControlador,
} from "../controladores/egresos-tablero.controlador";
import { requerirConfiguracionBD } from "../middleware/configuracion-bd.middleware";

const egresosTableroRutas: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", requerirConfiguracionBD);

  fastify.get("/mapahonduras", obtenerMapaHondurasEgresosControlador);
  fastify.get("/anios", obtenerAniosEgresosTableroControlador);
  fastify.get("/indicadores-departamento", obtenerIndicadoresDepartamentoEgresosControlador);
};

export default egresosTableroRutas;
