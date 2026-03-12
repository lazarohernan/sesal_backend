import type { FastifyRequest, FastifyReply } from "fastify";

import {
  obtenerDatosMapaHonduras,
  obtenerResumenTablero
} from "../servicios/tablero.servicio";
import { obtenerAniosDisponibles } from "../servicios/pivot.servicio";
import { logger } from "../utilidades/registro.utilidad";

export const obtenerResumenControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const { anio } = request.query as Record<string, string | undefined>;
    const anioNumero = anio ? Number(anio) : undefined;

    if (anio && (!Number.isFinite(anioNumero) || anioNumero! < 2008 || anioNumero! > 2030)) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "El parámetro 'anio' debe ser un número válido entre 2008 y 2030",
        campos: { anio }
      });
    }

    const resumen = await obtenerResumenTablero(anioNumero);

    return reply.status(200).send({
      datos: resumen,
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    logger.error("Error al obtener resumen del tablero", error);
    throw error;
  }
};

export const obtenerMapaHondurasControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const datos = await obtenerDatosMapaHonduras();

    return reply.status(200).send({
      datos,
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    logger.error("Error al obtener datos del mapa Honduras", error);
    throw error;
  }
};

export const obtenerAniosDisponiblesControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const anios = await obtenerAniosDisponibles();

    return reply.status(200).send({
      datos: anios,
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    logger.error("Error al obtener años disponibles", error);
    throw error;
  }
};
