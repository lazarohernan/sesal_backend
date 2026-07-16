import type { FastifyPluginAsync } from "fastify";

import {
  changePasswordControlador,
  loginControlador,
  logoutControlador,
  passwordResetConfirmControlador,
  passwordResetRequestControlador,
  passwordResetVerifyControlador,
  sessionControlador
} from "../controladores/auth.controlador";
import { requireUserSession } from "../middleware/auth.middleware";
import { normalizarIdentificadorAuth, normalizarTokenAuth } from "../utilidades/auth-input.utilidad";
import { simpleRateLimit } from "../utilidades/rate-limit.utilidad";

const leerIdentificadorBody = (body: unknown) => {
  if (!body || typeof body !== "object") {
    return "__sin_identificador";
  }

  return normalizarIdentificadorAuth((body as { identificador?: unknown }).identificador) || "__sin_identificador";
};

const leerTokenBody = (body: unknown) => {
  if (!body || typeof body !== "object") {
    return "__sin_token";
  }

  return normalizarTokenAuth((body as { token?: unknown }).token).slice(0, 64) || "__sin_token";
};

interface LoginRoute {
  Body: {
    identificador?: string;
    password?: string;
    recordar?: boolean;
  };
}

interface PasswordResetRequestRoute {
  Body: {
    identificador?: string;
  };
}

interface PasswordResetVerifyRoute {
  Querystring: {
    token?: string;
  };
}

interface PasswordResetConfirmRoute {
  Body: {
    token?: string;
    password?: string;
  };
}

const authRutas: FastifyPluginAsync = async (fastify) => {
  const loginIpRateLimit = simpleRateLimit({
    windowMs: 15 * 60_000,
    max: 40,
    keyGenerator: (req) => `auth:login:ip:${req.ip || "unknown"}`
  });

  const loginCuentaRateLimit = simpleRateLimit({
    windowMs: 15 * 60_000,
    max: 8,
    keyGenerator: (req) => `auth:login:cuenta:${leerIdentificadorBody(req.body)}`
  });

  const resetIpRateLimit = simpleRateLimit({
    windowMs: 60 * 60_000,
    max: 12,
    keyGenerator: (req) => `auth:reset:ip:${req.ip || "unknown"}`
  });

  const resetCuentaRateLimit = simpleRateLimit({
    windowMs: 60 * 60_000,
    max: 4,
    keyGenerator: (req) => `auth:reset:cuenta:${leerIdentificadorBody(req.body)}`
  });

  const resetTokenRateLimit = simpleRateLimit({
    windowMs: 15 * 60_000,
    max: 20,
    keyGenerator: (req) => `auth:reset-token:${leerTokenBody(req.body)}:${req.ip || "unknown"}`
  });

  const resetVerifyRateLimit = simpleRateLimit({
    windowMs: 15 * 60_000,
    max: 60,
    keyGenerator: (req) => `auth:reset-verify:${req.ip || "unknown"}`
  });

  const sessionRateLimit = simpleRateLimit({
    windowMs: 60_000,
    max: 300,
    keyGenerator: (req) => `auth:session:${req.ip || "unknown"}`
  });

  const changePasswordRateLimit = simpleRateLimit({
    windowMs: 15 * 60_000,
    max: 10,
    keyGenerator: (req) => `auth:change-password:${req.usuarioActual?.id ?? req.ip ?? "unknown"}`
  });

  fastify.post<LoginRoute>("/login", { preHandler: [loginIpRateLimit, loginCuentaRateLimit] }, loginControlador);
  fastify.post<PasswordResetRequestRoute>("/password-reset/request", { preHandler: [resetIpRateLimit, resetCuentaRateLimit] }, passwordResetRequestControlador);
  fastify.get<PasswordResetVerifyRoute>("/password-reset/verify", { preHandler: resetVerifyRateLimit }, passwordResetVerifyControlador);
  fastify.post<PasswordResetConfirmRoute>("/password-reset/confirm", { preHandler: [resetIpRateLimit, resetTokenRateLimit] }, passwordResetConfirmControlador);
  fastify.post("/change-password", { preHandler: [requireUserSession, changePasswordRateLimit] }, changePasswordControlador);
  fastify.get("/session", { preHandler: [sessionRateLimit, requireUserSession] }, sessionControlador);
  fastify.post("/logout", { preHandler: requireUserSession }, logoutControlador);
};

export default authRutas;
