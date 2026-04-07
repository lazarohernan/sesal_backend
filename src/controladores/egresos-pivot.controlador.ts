import type { FastifyRequest, FastifyReply } from "fastify";
import {
  obtenerCatalogoEgresos,
  obtenerAniosEgresos,
  obtenerValoresDimensionEgresos,
  ejecutarConsultaEgresos,
  obtenerResumenEgresos,
} from "../servicios/egresos-pivot.servicio";
import { AlcanceRegionalError, obtenerRegionesPermitidasUsuario } from "../utilidades/alcance-regional.util";
import { logger } from "../utilidades/registro.utilidad";

export const catalogoEgresosControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const catalogo = await obtenerCatalogoEgresos();
    return reply.send(catalogo);
  } catch (error) {
    logger.error("Error al obtener catálogo egresos", error);
    throw error;
  }
};

export const valoresDimensionEgresosControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const { dimensionId } = request.params as { dimensionId: string };
    const busqueda = (request.query as any).busqueda as string | undefined;
    const limite = (request.query as any).limite ? Number((request.query as any).limite) : undefined;
    const regionesPermitidas = obtenerRegionesPermitidasUsuario(request.usuarioActual);

    const valores = await obtenerValoresDimensionEgresos(
      dimensionId ?? "",
      busqueda,
      limite,
      regionesPermitidas
    );

    return reply.send({ valores });
  } catch (error) {
    if (error instanceof AlcanceRegionalError) {
      return reply.status(error.statusCode).send({
        codigo: error.codigo,
        mensaje: error.message,
      });
    }
    logger.error("Error al obtener valores dimensión egresos", error);
    throw error;
  }
};

export const aniosEgresosControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const anios = await obtenerAniosEgresos();
    return reply.send({ anios });
  } catch (error) {
    throw error;
  }
};

export const consultaEgresosControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const payload = request.body as any;
    const regionesPermitidas = obtenerRegionesPermitidasUsuario(request.usuarioActual);

    if (!payload.values || !Array.isArray(payload.values)) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "Se requiere al menos una medida en 'values'",
      });
    }

    const resultado = await ejecutarConsultaEgresos(payload, regionesPermitidas);

    return reply.send({
      resultado: {
        datos: resultado.datos,
        totalGeneral: resultado.totalGeneral,
        aniosConsultados: resultado.aniosConsultados,
        metadata: {
          ...resultado.metadata,
        },
      },
      generadoEn: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof AlcanceRegionalError) {
      return reply.status(error.statusCode).send({
        codigo: error.codigo,
        mensaje: error.message,
      });
    }
    logger.error("Error en consulta pivot egresos", error);
    throw error;
  }
};

export const resumenEgresosControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const regionesPermitidas = obtenerRegionesPermitidasUsuario(request.usuarioActual);
    const datos = await obtenerResumenEgresos(regionesPermitidas);
    return reply.send({
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
    logger.error("Error al obtener resumen egresos", error);
    throw error;
  }
};
