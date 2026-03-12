import type { FastifyRequest, FastifyReply } from "fastify";

import {
  ejecutarConsultaPivot,
  obtenerAniosDisponibles,
  obtenerCatalogoPivot,
  obtenerValoresDimension,
  type PivotQueryPayload
} from "../servicios/pivot.servicio";
import { crearPivotJob, obtenerPivotJob } from "../servicios/pivot-jobs.servicio";
import { logger } from "../utilidades/registro.utilidad";
import { cache } from "../utilidades/cache.utilidad";

export const catalogoPivotControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const catalogo = await obtenerCatalogoPivot();
    return reply.status(200).send(catalogo);
  } catch (error) {
    logger.error("Error al obtener catálogo de pivot", error);
    throw error;
  }
};

export const valoresDimensionPivotControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const { dimensionId } = request.params as { dimensionId: string };
    const busqueda = typeof (request.query as any).busqueda === "string" ? (request.query as any).busqueda : undefined;
    const limite = (request.query as any).limite ? Number((request.query as any).limite) : undefined;
    const filtroRegion = typeof (request.query as any).filtroRegion === "string" ? (request.query as any).filtroRegion : undefined;
    const filtroMunicipio = typeof (request.query as any).filtroMunicipio === "string" ? (request.query as any).filtroMunicipio : undefined;

    const valores = await obtenerValoresDimension(dimensionId, busqueda, limite, filtroRegion, filtroMunicipio);
    return reply.status(200).send({ valores, generadoEn: new Date().toISOString() });
  } catch (error) {
    logger.error("Error al obtener valores de dimensión pivot", error);
    throw error;
  }
};

export const aniosDisponiblesPivotControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const anios = await obtenerAniosDisponibles();
    return reply.status(200).send({
      anios,
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    logger.error("Error al obtener años disponibles", error);
    throw error;
  }
};

export const ejecutarPivotControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const payload = request.body as PivotQueryPayload;
    const resultado = await ejecutarConsultaPivot(payload);
    return reply.status(200).send({ resultado, generadoEn: new Date().toISOString() });
  } catch (error) {
    logger.error("Error al ejecutar consulta pivot", error);
    throw error;
  }
};

export const crearPivotJobControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const payload = request.body as PivotQueryPayload;
    const job = crearPivotJob(payload);
    return reply.status(202).send(job);
  } catch (error) {
    logger.error("Error al crear job pivot", error);
    throw error;
  }
};

export const obtenerPivotJobControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const { jobId } = request.params as { jobId: string };
  const job = obtenerPivotJob(jobId);

  if (!job) {
    return reply.status(404).send({
      status: 404,
      codigo: "JOB_PIVOT_NO_ENCONTRADO",
      mensaje: "No se encontró el job solicitado",
      requestId: request.id
    });
  }

  return reply.status(200).send(job);
};

export const mesesOcupadosControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const anio = Number((request.query as any).anio);
    if (!anio || anio < 2008 || anio > 2030) {
      return reply.status(400).send({ mensaje: "Año inválido" });
    }

    const { obtenerMesesOcupados } = await import("../servicios/pivot.servicio");
    const meses = await obtenerMesesOcupados(anio);
    return reply.status(200).send({ meses });
  } catch (error) {
    logger.error("Error al obtener meses ocupados", error);
    throw error;
  }
};

export const estadisticasCacheControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const stats = cache.getStats();
  const hitRatio = cache.getHitRatio();

  return reply.status(200).send({
    ...stats,
    hitRatio: `${(hitRatio * 100).toFixed(2)}%`,
    generadoEn: new Date().toISOString()
  });
};
