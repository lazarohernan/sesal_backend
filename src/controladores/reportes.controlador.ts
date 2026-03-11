import type { FastifyRequest, FastifyReply } from "fastify";
import { obtenerIndicadoresMunicipales, obtenerEstadisticasCache } from "../servicios/reportes.servicio";
import { logger } from "../utilidades/registro.utilidad";

export const obtenerIndicadoresMunicipalesControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const { anio, departamentoId, limite, regionId } = request.query as Record<string, string | undefined>;

    const anioNumero = Number(anio);
    const departamentoNumero = Number(departamentoId);
    const limiteNumero = Number(limite ?? 100);
    const regionNumero = regionId ? Number(regionId) : undefined;

    if (!Number.isFinite(anioNumero) || anioNumero < 2008 || anioNumero > 2030) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "El parámetro 'anio' es obligatorio y debe ser un número válido",
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
    const datos = await obtenerIndicadoresMunicipales({
      anio: anioNumero,
      departamentoId: departamentoNumero,
      limite: limiteSeguro,
      regionId: regionNumero
    });

    return reply.status(200).send({
      datos,
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    logger.error("Error al obtener indicadores municipales", error);
    throw error;
  }
};

export const obtenerEstadisticasCacheControlador = async (
  request: FastifyRequest,
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
