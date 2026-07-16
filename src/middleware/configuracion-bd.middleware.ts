import type { FastifyRequest, FastifyReply } from "fastify";
import { obtenerPoolActual } from "../base_datos/pool";
import { configuracionBDServicio } from "../servicios/configuracion-bd.servicio";

export const requerirConfiguracionBD = async (_request: FastifyRequest, reply: FastifyReply) => {
  try {
    const config = configuracionBDServicio.obtenerConfiguracion();
    const configuracionValida = Boolean(
      config?.host &&
      config?.username &&
      config?.database &&
      Number.isFinite(config.port)
    );

    if (!configuracionValida) {
      return reply.status(503).send({
        success: false,
        error: "Configuracion de base de datos incompleta",
        message: "La aplicacion no tiene una configuracion valida de base de datos.",
        requiresConfig: true
      });
    }

    obtenerPoolActual();
  } catch (error) {
    console.error("Error validando configuracion de BD:", error);
    return reply.status(503).send({
      success: false,
      error: "No se pudo validar la configuracion de base de datos",
      requiresConfig: true
    });
  }
};
