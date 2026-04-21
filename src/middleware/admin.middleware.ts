import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";

import { entorno } from "../configuracion";

const accesoDenegado = (reply: FastifyReply, requestId: string, mensaje: string) =>
  reply.status(403).send({
    status: 403,
    codigo: "ACCESO_DENEGADO",
    mensaje,
    requestId
  });

const tokenInvalido = (reply: FastifyReply, requestId: string) =>
  reply.status(401).send({
    status: 401,
    codigo: "NO_AUTORIZADO",
    mensaje: "Se requiere autenticacion administrativa para esta ruta.",
    requestId
  });

const obtenerTokenSolicitud = (request: FastifyRequest): string | null => {
  const bearer = request.headers.authorization;
  if (typeof bearer === "string" && bearer.toLowerCase().startsWith("bearer ")) {
    return bearer.slice(7).trim();
  }

  const tokenHeader = request.headers["x-admin-token"];
  if (typeof tokenHeader === "string" && tokenHeader.trim()) {
    return tokenHeader.trim();
  }

  return null;
};

const compararTokens = (esperado: string, recibido: string): boolean => {
  const esperadoBuffer = Buffer.from(esperado);
  const recibidoBuffer = Buffer.from(recibido);

  if (esperadoBuffer.length !== recibidoBuffer.length) {
    return false;
  }

  return timingSafeEqual(esperadoBuffer, recibidoBuffer);
};

export const requireAdminAccess = async (request: FastifyRequest, reply: FastifyReply) => {
  if (!request.usuarioActual) {
    return tokenInvalido(reply, request.id);
  }

  if (request.usuarioActual.rol !== "central") {
    return accesoDenegado(
      reply,
      request.id,
      "Solo los usuarios con rol central pueden acceder a rutas administrativas."
    );
  }

  const tokenConfigurado = entorno.admin.token;

  if (!tokenConfigurado) {
    if (!entorno.esProduccion) {
      return;
    }

    return reply.status(503).send({
      status: 503,
      codigo: "ADMIN_NO_CONFIGURADO",
      mensaje: "Las rutas administrativas estan deshabilitadas en este ambiente.",
      requestId: request.id
    });
  }

  const tokenSolicitud = obtenerTokenSolicitud(request);
  if (!tokenSolicitud) {
    return tokenInvalido(reply, request.id);
  }

  if (!compararTokens(tokenConfigurado, tokenSolicitud)) {
    return tokenInvalido(reply, request.id);
  }
};
