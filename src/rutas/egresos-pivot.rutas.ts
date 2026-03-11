import type { FastifyPluginAsync } from "fastify";
import {
  catalogoEgresosControlador,
  valoresDimensionEgresosControlador,
  aniosEgresosControlador,
  consultaEgresosControlador,
  resumenEgresosControlador,
} from "../controladores/egresos-pivot.controlador";
import { establecerConfiguracionBD, requerirConfiguracionBD, logConfiguracionBD } from "../middleware/configuracion-bd.middleware";

const egresosPivotRutas: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", establecerConfiguracionBD);
  fastify.addHook("onRequest", logConfiguracionBD);
  fastify.addHook("preHandler", requerirConfiguracionBD);

  fastify.get("/catalogo", catalogoEgresosControlador);
  fastify.get("/anios", aniosEgresosControlador);
  fastify.get("/dimensiones/:dimensionId/valores", valoresDimensionEgresosControlador);
  fastify.post("/consulta", consultaEgresosControlador);
  fastify.get("/resumen", resumenEgresosControlador);
};

export default egresosPivotRutas;
