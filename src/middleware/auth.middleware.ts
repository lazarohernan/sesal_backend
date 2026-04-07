import type { FastifyReply, FastifyRequest } from "fastify";

import { entorno } from "../configuracion/entorno";
import { authServicio } from "../servicios/auth.servicio";
import { construirCookieSesionExpirada, obtenerCookie } from "../utilidades/auth-cookie.util";

const respuestaNoAutorizada = (reply: FastifyReply, mensaje: string) =>
  reply.status(401).send({
    status: 401,
    codigo: "NO_AUTORIZADO",
    mensaje
  });

export const requireUserSession = async (request: FastifyRequest, reply: FastifyReply) => {
  const token = obtenerCookie(request, entorno.auth.cookieName);
  if (!token) {
    return respuestaNoAutorizada(reply, "Debe iniciar sesion para continuar.");
  }

  const usuario = await authServicio.obtenerSesion(token);
  if (!usuario) {
    reply.header("Set-Cookie", construirCookieSesionExpirada());
    return respuestaNoAutorizada(reply, "La sesion no es valida o ya expiro.");
  }

  request.usuarioActual = usuario;
  request.sessionToken = token;
};
