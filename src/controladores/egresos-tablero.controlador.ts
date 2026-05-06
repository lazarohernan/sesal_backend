import type { FastifyRequest, FastifyReply } from "fastify";

import {
  obtenerAniosEgresosTablero,
  obtenerDatosMapaHondurasEgresos,
  obtenerIndicadoresDepartamentoEgresos,
  obtenerIndicadoresTableroEgresos,
} from "../servicios/egresos-tablero.servicio";
import { AlcanceRegionalError, obtenerRegionesPermitidasUsuario, resolverRegionesPermitidas } from "../utilidades/alcance-regional.util";
import { logger } from "../utilidades/registro.utilidad";

const valueInvalidRegion = (valor: number) => !Number.isInteger(valor) || valor <= 0 || valor > 20;

export const obtenerMapaHondurasEgresosControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const regionesPermitidas = obtenerRegionesPermitidasUsuario(request.usuarioActual);
    const datos = await obtenerDatosMapaHondurasEgresos(regionesPermitidas);
    return reply.status(200).send({
      datos,
      generadoEn: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof AlcanceRegionalError) {
      return reply.status(error.statusCode).send({
        codigo: error.codigo,
        mensaje: error.message,
      });
    }
    logger.error("Error al obtener datos hospitalarios del mapa Honduras", error);
    throw error;
  }
};

export const obtenerAniosEgresosTableroControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const anios = await obtenerAniosEgresosTablero();
    return reply.status(200).send({
      datos: anios,
      generadoEn: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Error al obtener años hospitalarios del tablero", error);
    throw error;
  }
};

export const obtenerIndicadoresDepartamentoEgresosControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const { anio, departamentoId, regionId } = request.query as Record<string, string | undefined>;

    const anioNumero = anio ? Number(anio) : undefined;
    const departamentoNumero = Number(departamentoId);
    const regionNumero = regionId ? Number(regionId) : undefined;

    if (anio !== undefined && (!Number.isFinite(anioNumero) || anioNumero! < 2023 || anioNumero! > 2030)) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "El parámetro 'anio' debe ser un número válido entre 2023 y 2030",
        campos: { anio },
      });
    }

    if (!Number.isFinite(departamentoNumero) || departamentoNumero <= 0) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "El parámetro 'departamentoId' es obligatorio y debe ser un número válido",
        campos: { departamentoId },
      });
    }

    if (regionNumero !== undefined && (!Number.isFinite(regionNumero) || regionNumero <= 0)) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "El parámetro 'regionId' debe ser un número válido si se proporciona",
        campos: { regionId },
      });
    }

    const regionesPermitidas = resolverRegionesPermitidas(request.usuarioActual, regionNumero);

    const datos = await obtenerIndicadoresDepartamentoEgresos({
      departamentoId: departamentoNumero,
      regionIds: regionesPermitidas ?? undefined,
      anio: anioNumero,
    });

    return reply.status(200).send({
      datos,
      generadoEn: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof AlcanceRegionalError) {
      return reply.status(error.statusCode).send({
        codigo: error.codigo,
        mensaje: error.message,
      });
    }
    logger.error("Error al obtener indicadores hospitalarios por departamento", error);
    throw error;
  }
};

export const obtenerIndicadoresTableroEgresosControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const { anio, departamentoId, regionId, region } = request.query as Record<
      string,
      string | string[] | undefined
    >;

    const anioRaw = Array.isArray(anio) ? anio[0] : anio;
    const departamentoRaw = Array.isArray(departamentoId) ? departamentoId[0] : departamentoId;
    const regionIdRaw = Array.isArray(regionId) ? regionId[0] : regionId;
    const regionRaw = Array.isArray(region) ? region : region ? [region] : [];

    const anioNumero = anioRaw ? Number(anioRaw) : undefined;
    const departamentoNumero = departamentoRaw ? Number(departamentoRaw) : undefined;
    const regionesSolicitadas = [
      ...(regionIdRaw ? [Number(regionIdRaw)] : []),
      ...regionRaw.map((valor) => Number(valor)),
    ].filter((valor) => Number.isFinite(valor));

    if (anioRaw !== undefined && (!Number.isFinite(anioNumero) || anioNumero! < 2000 || anioNumero! > 2100)) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "El parámetro 'anio' debe ser un número válido entre 2000 y 2100",
        campos: { anio },
      });
    }

    if (departamentoRaw !== undefined && (!Number.isFinite(departamentoNumero) || departamentoNumero! <= 0)) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "El parámetro 'departamentoId' debe ser un número válido si se proporciona",
        campos: { departamentoId },
      });
    }

    if (regionesSolicitadas.some((valor) => valueInvalidRegion(valor))) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "El parámetro de región debe ser un número válido si se proporciona",
        campos: { regionId, region },
      });
    }

    const regionesPermitidas = resolverRegionesPermitidas(
      request.usuarioActual,
      regionesSolicitadas.length ? regionesSolicitadas : undefined
    );

    const datos = await obtenerIndicadoresTableroEgresos({
      regionIds: regionesPermitidas ?? undefined,
      anio: anioNumero,
      departamentoId: departamentoNumero,
    });

    return reply.status(200).send({
      datos,
      generadoEn: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof AlcanceRegionalError) {
      return reply.status(error.statusCode).send({
        codigo: error.codigo,
        mensaje: error.message,
      });
    }
    logger.error("Error al obtener indicadores hospitalarios optimizados", error);
    throw error;
  }
};
