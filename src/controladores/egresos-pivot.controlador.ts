import type { FastifyRequest, FastifyReply } from "fastify";
import {
  obtenerCatalogoEgresos,
  obtenerValoresDimensionEgresos,
  ejecutarConsultaEgresos,
  obtenerResumenEgresos,
} from "../servicios/egresos-pivot.servicio";
import { logger } from "../utilidades/registro.utilidad";

export const catalogoEgresosControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const catalogo = obtenerCatalogoEgresos();
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

    const valores = await obtenerValoresDimensionEgresos(
      dimensionId ?? "",
      busqueda,
      limite
    );

    return reply.send({ valores });
  } catch (error) {
    logger.error("Error al obtener valores dimensión egresos", error);
    throw error;
  }
};

export const aniosEgresosControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    return reply.send({ anios: [2026] });
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

    if (!payload.values || !Array.isArray(payload.values)) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "Se requiere al menos una medida en 'values'",
      });
    }

    const resultado = await ejecutarConsultaEgresos(payload);

    return reply.send({
      resultado: {
        datos: resultado.datos,
        totalGeneral: null,
        aniosConsultados: [2026],
        metadata: {
          ...resultado.metadata,
          dimensionesSeleccionadas: [
            ...resultado.metadata.dimensionesFilas,
            ...resultado.metadata.dimensionesColumnas,
          ],
        },
      },
      generadoEn: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Error en consulta pivot egresos", error);
    throw error;
  }
};

export const resumenEgresosControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const datos = await obtenerResumenEgresos();
    return reply.send({
      datos,
      anio: 2026,
      generadoEn: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Error al obtener resumen egresos", error);
    throw error;
  }
};
