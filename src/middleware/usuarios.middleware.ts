import type { FastifyReply, FastifyRequest } from "fastify";

const respuestaProhibida = (
  reply: FastifyReply,
  requestId: string,
  mensaje = "Solo los usuarios con rol central pueden administrar usuarios."
) =>
  reply.status(403).send({
    status: 403,
    codigo: "ACCESO_DENEGADO",
    mensaje,
    requestId
  });

export const requireCentralRole = async (request: FastifyRequest, reply: FastifyReply) => {
  if (!request.usuarioActual) {
    return respuestaProhibida(reply, request.id);
  }

  if (request.usuarioActual.rol !== "central") {
    return respuestaProhibida(reply, request.id);
  }
};

export const requireRegionalCaptureRole = async (request: FastifyRequest, reply: FastifyReply) => {
  if (!request.usuarioActual) {
    return respuestaProhibida(
      reply,
      request.id,
      "Solo los usuarios regionales tienen habilitado el flujo de captura."
    );
  }

  if (request.usuarioActual.rol !== "regional") {
    return respuestaProhibida(
      reply,
      request.id,
      "Solo los usuarios regionales tienen habilitado el flujo de captura."
    );
  }
};

export const requireSeguimientoAccess = async (request: FastifyRequest, reply: FastifyReply) => {
  if (!request.usuarioActual) {
    return respuestaProhibida(reply, request.id);
  }

  if (request.usuarioActual.rol === "central" || request.usuarioActual.puedeVerSeguimiento) {
    return;
  }

  return reply.status(403).send({
    status: 403,
    codigo: "ACCESO_DENEGADO",
    mensaje: "Este usuario no tiene permiso para consultar seguimiento.",
    requestId: request.id
  });
};
