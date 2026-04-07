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

const authRutas: FastifyPluginAsync = async (fastify) => {
  fastify.post("/login", loginControlador);
  fastify.post("/password-reset/request", passwordResetRequestControlador);
  fastify.get("/password-reset/verify", passwordResetVerifyControlador);
  fastify.post("/password-reset/confirm", passwordResetConfirmControlador);
  fastify.post("/change-password", { preHandler: requireUserSession }, changePasswordControlador);
  fastify.get("/session", { preHandler: requireUserSession }, sessionControlador);
  fastify.post("/logout", { preHandler: requireUserSession }, logoutControlador);
};

export default authRutas;
