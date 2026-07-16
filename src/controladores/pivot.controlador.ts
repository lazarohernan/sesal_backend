import type { FastifyRequest, FastifyReply } from "fastify";

import {
  estaConsultaPivotCacheada,
  ejecutarConsultaPivot,
  obtenerAniosDisponibles,
  obtenerCatalogoPivot,
  obtenerValoresDimension,
  type PivotQueryPayload
} from "../servicios/pivot.servicio";
import { crearPivotJob, obtenerPivotJob } from "../servicios/pivot-jobs.servicio";
import {
  registrarFinConsultaPivot,
  registrarInicioConsultaPivot
} from "../servicios/pivot-analytics.servicio";
import { AlcanceRegionalError, aplicarFiltroRegionalPivot, obtenerRegionesPermitidasUsuario, resolverRegionesPermitidas, REGION_CODE_TO_NAME } from "../utilidades/alcance-regional.util";
import { logger } from "../utilidades/registro.utilidad";
import { cache } from "../utilidades/cache.utilidad";

const aplicarAlcanceRegionalPayload = (payload: PivotQueryPayload, request: FastifyRequest): PivotQueryPayload => {
  const regionesPermitidas = obtenerRegionesPermitidasUsuario(request.usuarioActual);
  if (!regionesPermitidas) {
    return payload;
  }

  return {
    ...payload,
    filters: aplicarFiltroRegionalPivot(payload.filters, regionesPermitidas)
  };
};

export const catalogoPivotControlador = async (
  _request: FastifyRequest,
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
    const regionesPermitidas = resolverRegionesPermitidas(
      request.usuarioActual,
      filtroRegion ? Number(filtroRegion) : undefined
    );

    if (dimensionId === "REGION" && regionesPermitidas?.length) {
      const valores = regionesPermitidas
        .map((regionId) => ({
          valor: regionId,
          etiqueta: REGION_CODE_TO_NAME[regionId] ?? `Region ${regionId}`
        }))
        .filter((valor) =>
          busqueda ? valor.etiqueta.toLowerCase().includes(busqueda.toLowerCase()) : true
        );
      return reply.status(200).send({ valores, generadoEn: new Date().toISOString() });
    }

    const valores = await obtenerValoresDimension(
      dimensionId,
      busqueda,
      limite,
      regionesPermitidas?.map(String),
      filtroMunicipio
    );
    return reply.status(200).send({ valores, generadoEn: new Date().toISOString() });
  } catch (error) {
    if (error instanceof AlcanceRegionalError) {
      return reply.status(error.statusCode).send({
        codigo: error.codigo,
        mensaje: error.message
      });
    }
    logger.error("Error al obtener valores de dimensión pivot", error);
    throw error;
  }
};

export const aniosDisponiblesPivotControlador = async (
  _request: FastifyRequest,
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
  const payload = aplicarAlcanceRegionalPayload(request.body as PivotQueryPayload, request);
  const cacheHit = estaConsultaPivotCacheada(payload);
  const startedAt = Date.now();
  const logId = cacheHit
    ? null
    : await registrarInicioConsultaPivot({
        payload,
        executionMode: "sync",
        requestId: request.id,
        clientIp: request.ip
      });

  try {
    const resultado = await ejecutarConsultaPivot(payload);
    if (!cacheHit) {
      await registrarFinConsultaPivot(logId, {
        status: "completed",
        durationMs: Date.now() - startedAt,
        result: resultado
      });
    }
    return reply.status(200).send({ resultado, generadoEn: new Date().toISOString() });
  } catch (error) {
    if (!cacheHit) {
      await registrarFinConsultaPivot(logId, {
        status: "failed",
        durationMs: Date.now() - startedAt,
        errorMessage: error instanceof Error ? error.message : "Error al ejecutar consulta pivot"
      });
    }
    if (error instanceof AlcanceRegionalError) {
      return reply.status(error.statusCode).send({
        codigo: error.codigo,
        mensaje: error.message
      });
    }
    logger.error("Error al ejecutar consulta pivot", error);
    throw error;
  }
};

export const crearPivotJobControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const payload = aplicarAlcanceRegionalPayload(request.body as PivotQueryPayload, request);
    const job = crearPivotJob(payload, {
      requestId: request.id,
      clientIp: request.ip
    });
    return reply.status(202).send(job);
  } catch (error) {
    if (error instanceof AlcanceRegionalError) {
      return reply.status(error.statusCode).send({
        codigo: error.codigo,
        mensaje: error.message
      });
    }
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
    if (error instanceof AlcanceRegionalError) {
      return reply.status(error.statusCode).send({
        codigo: error.codigo,
        mensaje: error.message
      });
    }
    logger.error("Error al obtener meses ocupados", error);
    throw error;
  }
};

export const estadisticasCacheControlador = async (
  _request: FastifyRequest,
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
