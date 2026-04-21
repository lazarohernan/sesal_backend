import type { FastifyReply, FastifyRequest } from "fastify";

import { seguimientoServicio } from "../servicios/seguimiento.servicio";
import {
  AlcanceRegionalError,
  obtenerRegionesPermitidasUsuario,
  resolverRegionesPermitidas
} from "../utilidades/alcance-regional.util";
import { logger } from "../utilidades/registro.utilidad";

const ANIO_MIN = 2026;
const ANIO_MAX = 2099;
const MES_MIN = 1;
const MES_MAX = 12;
const REGION_MIN = 1;
const REGION_MAX = 20;

const sanitizarEntero = (valor: unknown, min: number, max: number) => {
  const num = Number(valor);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  if (num < min || num > max) return null;
  return num;
};

export const obtenerResumenSeguimientoControlador = async (
  request: FastifyRequest<{ Querystring: { anio?: string; mes?: string } }>,
  reply: FastifyReply
) => {
  const anio = sanitizarEntero(request.query?.anio, ANIO_MIN, ANIO_MAX);
  const mes = sanitizarEntero(request.query?.mes, MES_MIN, MES_MAX);

  if (anio === null || mes === null) {
    return reply.status(400).send({
      codigo: "PARAMETRO_INVALIDO",
      mensaje: `Debe indicar 'anio' (${ANIO_MIN}-${ANIO_MAX}) y 'mes' (${MES_MIN}-${MES_MAX}).`
    });
  }

  try {
    const regionesPermitidas = obtenerRegionesPermitidasUsuario(request.usuarioActual);
    const regiones = await seguimientoServicio.obtenerResumen(anio, mes);
    const regionesFiltradas = regionesPermitidas?.length
      ? regiones.filter((region) => regionesPermitidas.includes(region.id))
      : regiones;

    return reply.send({
      datos: regionesFiltradas,
      periodo: { anio, mes },
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    if (error instanceof AlcanceRegionalError) {
      return reply.status(error.statusCode).send({
        codigo: error.codigo,
        mensaje: error.message
      });
    }
    logger.error("Error al obtener resumen de seguimiento", error);
    throw error;
  }
};

export const obtenerDetalleSeguimientoRegionControlador = async (
  request: FastifyRequest<{ Params: { regionId: string }; Querystring: { anio?: string; mes?: string } }>,
  reply: FastifyReply
) => {
  const anio = sanitizarEntero(request.query?.anio, ANIO_MIN, ANIO_MAX);
  const mes = sanitizarEntero(request.query?.mes, MES_MIN, MES_MAX);
  const regionId = sanitizarEntero(request.params?.regionId, REGION_MIN, REGION_MAX);

  if (anio === null || mes === null || regionId === null) {
    return reply.status(400).send({
      codigo: "PARAMETRO_INVALIDO",
      mensaje: "Debe indicar región, año y mes válidos para consultar el seguimiento."
    });
  }

  try {
    resolverRegionesPermitidas(request.usuarioActual, regionId);
    const detalle = await seguimientoServicio.obtenerDetalleRegion(anio, mes, regionId);
    return reply.send({
      datos: detalle,
      periodo: { anio, mes },
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    if (error instanceof AlcanceRegionalError) {
      return reply.status(error.statusCode).send({
        codigo: error.codigo,
        mensaje: error.message
      });
    }
    logger.error("Error al obtener detalle de seguimiento", error);
    throw error;
  }
};

export const marcarSeguimientoRevisadoControlador = async (
  request: FastifyRequest<{ Params: { id: string }; Body: { observaciones?: string } }>,
  reply: FastifyReply
) => {
  const id = Number(request.params?.id ?? 0);
  if (!Number.isInteger(id) || id <= 0) {
    return reply.status(400).send({
      codigo: "PARAMETRO_INVALIDO",
      mensaje: "Debe indicar un identificador de seguimiento válido."
    });
  }

  if (!request.usuarioActual) {
    return reply.status(401).send({
      codigo: "NO_AUTORIZADO",
      mensaje: "Debe iniciar sesión para continuar."
    });
  }

  try {
    const actualizado = await seguimientoServicio.marcarRevisado({
      id,
      reviewedByUserId: request.usuarioActual.id,
      reviewedByNombre: request.usuarioActual.nombreMostrar,
      observaciones: request.body?.observaciones ?? null
    });

    if (!actualizado) {
      return reply.status(404).send({
        codigo: "NO_ENCONTRADO",
        mensaje: "No se encontró el registro de seguimiento indicado."
      });
    }

    return reply.send({
      ok: true,
      mensaje: "Registro marcado como revisado.",
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    logger.error("Error al marcar seguimiento como revisado", error);
    throw error;
  }
};
