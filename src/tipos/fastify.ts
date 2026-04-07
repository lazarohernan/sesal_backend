import "fastify";

import type { UsuarioAutenticado } from "../servicios/auth.servicio";

declare module "fastify" {
  interface FastifyRequest {
    usuarioActual?: UsuarioAutenticado;
    sessionToken?: string;
  }
}

export {};
