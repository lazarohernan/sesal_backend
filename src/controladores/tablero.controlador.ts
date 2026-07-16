import type { FastifyRequest, FastifyReply } from "fastify";

import {
  obtenerDatosMapaHonduras,
  obtenerResumenTablero
} from "../servicios/tablero.servicio";
import { obtenerAniosDisponibles } from "../servicios/pivot.servicio";
import { AlcanceRegionalError, obtenerRegionesPermitidasUsuario } from "../utilidades/alcance-regional.util";
import { logger } from "../utilidades/registro.utilidad";

export const obtenerResumenControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    reply.header("Cache-Control", "private, no-store");
    reply.header("Vary", "Cookie, Authorization");

    const { anio, departamentoId } = request.query as Record<string, string | undefined>;
    const anioNumero = anio ? Number(anio) : undefined;
    const departamentoIdNumero = departamentoId ? Number(departamentoId) : undefined;

    if (anio && (!Number.isFinite(anioNumero) || anioNumero! < 2008 || anioNumero! > 2030)) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "El parámetro 'anio' debe ser un número válido entre 2008 y 2030",
        campos: { anio }
      });
    }

    if (
      departamentoId &&
      (!Number.isInteger(departamentoIdNumero) || departamentoIdNumero! < 1 || departamentoIdNumero! > 18)
    ) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "El parámetro 'departamentoId' debe ser un número válido entre 1 y 18",
        campos: { departamentoId }
      });
    }

    const regionesPermitidas = obtenerRegionesPermitidasUsuario(request.usuarioActual);
    const resumen = await obtenerResumenTablero(anioNumero, regionesPermitidas, departamentoIdNumero);

    return reply.status(200).send({
      datos: resumen,
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    if (error instanceof AlcanceRegionalError) {
      return reply.status(error.statusCode).send({
        codigo: error.codigo,
        mensaje: error.message
      });
    }
    logger.error("Error al obtener resumen del tablero", error);
    throw error;
  }
};

export const obtenerMapaHondurasControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const regionesPermitidas = obtenerRegionesPermitidasUsuario(request.usuarioActual);
    const datos = await obtenerDatosMapaHonduras(regionesPermitidas);

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
    logger.error("Error al obtener datos del mapa Honduras", error);
    throw error;
  }
};

export const obtenerAniosDisponiblesControlador = async (
  _request: FastifyRequest,
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
