import type { FastifyRequest, FastifyReply } from "fastify";
import {
  obtenerControlEnviosAt2,
  obtenerEstadisticasCache,
  obtenerIndicadoresMunicipales,
  obtenerResumenMaestroAt2
} from "../servicios/reportes.servicio";
import { AlcanceRegionalError, resolverRegionesPermitidas } from "../utilidades/alcance-regional.util";
import { logger } from "../utilidades/registro.utilidad";

const sanitizarEntero = (valor: unknown, min: number, max: number) => {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < min || numero > max) return null;
  return numero;
};

export const obtenerIndicadoresMunicipalesControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    reply.header("Cache-Control", "private, no-store");
    reply.header("Vary", "Cookie, Authorization");

    const { anio, departamentoId, limite, regionId } = request.query as Record<string, string | undefined>;

    const anioNumero = anio ? Number(anio) : undefined;
    const departamentoNumero = Number(departamentoId);
    const limiteNumero = Number(limite ?? 100);
    const regionNumero = regionId ? Number(regionId) : undefined;

    if (anio && (!Number.isFinite(anioNumero) || anioNumero! < 2008 || anioNumero! > 2030)) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "El parámetro 'anio' debe ser un número válido si se proporciona",
        campos: { anio }
      });
    }

    if (!Number.isFinite(departamentoNumero) || departamentoNumero <= 0) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "El parámetro 'departamentoId' es obligatorio y debe ser un número válido",
        campos: { departamentoId }
      });
    }

    if (regionNumero !== undefined && (!Number.isFinite(regionNumero) || regionNumero <= 0)) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "El parámetro 'regionId' debe ser un número válido si se proporciona",
        campos: { regionId }
      });
    }

    const limiteSeguro = Number.isFinite(limiteNumero) && limiteNumero > 0 ? limiteNumero : 0;
    const regionesPermitidas = resolverRegionesPermitidas(request.usuarioActual, regionNumero);

    const datos = await obtenerIndicadoresMunicipales({
      anio: anioNumero,
      departamentoId: departamentoNumero,
      limite: limiteSeguro,
      regionIds: regionesPermitidas ?? undefined
    });

    return reply.status(200).send({
      datos,
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    if (error instanceof AlcanceRegionalError) {
      return reply.status(error.statusCode).send({
        codigo: error.codigo,
        mensaje: error.message
      });
    }
    logger.error("Error al obtener indicadores municipales", error);
    throw error;
  }
};

export const obtenerEstadisticasCacheControlador = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const estadisticas = obtenerEstadisticasCache();

    return reply.status(200).send({
      estadisticas,
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    logger.error("Error al obtener estadísticas del cache", error);
    throw error;
  }
};

export const obtenerResumenMaestroAt2Controlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    reply.header("Cache-Control", "private, no-store");
    reply.header("Vary", "Cookie, Authorization");

    const { anio, mesInicio, mesFin, regionId } = request.query as Record<string, string | undefined>;
    const anioNumero = sanitizarEntero(anio, 2008, 2099);
    const mesInicioNumero = sanitizarEntero(mesInicio ?? "1", 1, 12);
    const mesFinNumero = sanitizarEntero(mesFin ?? "12", 1, 12);
    const regionNumero = regionId ? sanitizarEntero(regionId, 1, 20) : undefined;

    if (anioNumero === null || mesInicioNumero === null || mesFinNumero === null || regionNumero === null) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "Debe indicar año, rango de meses y región válidos."
      });
    }

    if (mesInicioNumero > mesFinNumero) {
      return reply.status(400).send({
        codigo: "RANGO_MESES_INVALIDO",
        mensaje: "El mes inicial no puede ser mayor que el mes final."
      });
    }

    const regionesPermitidas = resolverRegionesPermitidas(request.usuarioActual, regionNumero);
    const datos = await obtenerResumenMaestroAt2({
      anio: anioNumero,
      mesInicio: mesInicioNumero,
      mesFin: mesFinNumero,
      regionIds: regionesPermitidas
    });

    return reply.status(200).send({
      datos,
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    if (error instanceof AlcanceRegionalError) {
      return reply.status(error.statusCode).send({
        codigo: error.codigo,
        mensaje: error.message
      });
    }
    logger.error("Error al obtener resumen maestro AT2", error);
    throw error;
  }
};

export const obtenerControlEnviosAt2Controlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    reply.header("Cache-Control", "private, no-store");
    reply.header("Vary", "Cookie, Authorization");

    const { anio, regionId } = request.query as Record<string, string | undefined>;
    const anioNumero = sanitizarEntero(anio, 2025, 2099);
    const regionNumero = regionId ? sanitizarEntero(regionId, 1, 20) : undefined;

    if (anioNumero === null || regionNumero === null) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "Debe indicar año y región válidos para el control de envíos."
      });
    }

    const regionesPermitidas = resolverRegionesPermitidas(request.usuarioActual, regionNumero);
    const datos = await obtenerControlEnviosAt2({
      anio: anioNumero,
      regionIds: regionesPermitidas
    });

    return reply.status(200).send({
      datos,
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    if (error instanceof AlcanceRegionalError) {
      return reply.status(error.statusCode).send({
        codigo: error.codigo,
        mensaje: error.message
      });
    }
    logger.error("Error al obtener control de envíos AT2", error);
    throw error;
  }
};
