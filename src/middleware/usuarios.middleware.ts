import type { FastifyReply, FastifyRequest } from "fastify";

const respuestaProhibida = (reply: FastifyReply, requestId: string) =>
  reply.status(403).send({
    status: 403,
    codigo: "ACCESO_DENEGADO",
    mensaje: "Solo los usuarios con rol central pueden administrar usuarios.",
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
