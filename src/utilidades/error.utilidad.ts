import type { FastifyRequest, FastifyReply, FastifyError } from "fastify";
import { logger } from "./registro.utilidad";

export const requestIdHook = async (request: FastifyRequest, reply: FastifyReply) => {
  reply.header("x-request-id", request.id);
};

export const notFoundHandler = (request: FastifyRequest, reply: FastifyReply) => {
  reply.status(404).send({
    status: 404,
    codigo: "RUTA_NO_ENCONTRADA",
    mensaje: "Ruta no encontrada",
    path: request.url,
    requestId: request.id
  });
};

export const errorHandler = (
  err: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const requestId = request.id;

  // Errores de JSON invalido
  if ("statusCode" in err && err.statusCode === 400 && err.message?.includes("JSON")) {
    logger.warn("JSON invalido recibido", { requestId, detalle: err.message });
    return reply.status(400).send({
      status: 400,
      codigo: "JSON_INVALIDO",
      mensaje: "El cuerpo de la solicitud no es un JSON valido.",
      requestId
    });
  }

  const esCierrePrematuro = (() => {
    const codigoError = "code" in err ? String(err.code) : "";
    const mensajeError = (err.message || "").toLowerCase();
    return (
      codigoError === "ERR_STREAM_PREMATURE_CLOSE" ||
      codigoError === "FST_ERR_REP_ALREADY_SENT" ||
      mensajeError.includes("premature close")
    );
  })();

  if (esCierrePrematuro) {
    logger.warn("Cliente cerro la conexion antes de completar la respuesta", {
      requestId,
      path: request.url
    });
    if (!reply.sent) {
      return reply.status(499).send({
        status: 499,
        codigo: "SOLICITUD_ABORTADA",
        mensaje: "La solicitud fue cancelada",
        requestId
      });
    }
    return reply;
  }

  const status = ("statusCode" in err ? err.statusCode : undefined) || 500;
  const codigo = ("code" in err ? err.code : undefined) || (status === 500 ? "ERROR_INTERNO" : "ERROR");
  const mensaje = err.message || "Error procesando la solicitud";

  if (status >= 500) {
    logger.error(`Error ${status}`, { requestId, codigo, mensaje, stack: err.stack });
  } else {
    logger.warn(`Error ${status}`, { requestId, codigo, mensaje });
  }

  const cuerpo: Record<string, unknown> = { status, codigo, mensaje, requestId };
  if (process.env.NODE_ENV !== "production" && err.stack) {
    cuerpo.detalle = err.stack;
  }

  return reply.status(status).send(cuerpo);
};
