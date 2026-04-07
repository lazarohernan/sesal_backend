import type { FastifyReply, FastifyRequest } from "fastify";

import { authServicio } from "../servicios/auth.servicio";
import { construirCookieSesion, construirCookieSesionExpirada } from "../utilidades/auth-cookie.util";

interface LoginBody {
  identificador?: string;
  password?: string;
  recordar?: boolean;
}

interface PasswordResetRequestBody {
  identificador?: string;
}

interface PasswordResetConfirmBody {
  token?: string;
  password?: string;
}

interface ChangePasswordBody {
  passwordNueva?: string;
}

const validarPasswordSegura = (password: string) => {
  if (password.length < 8) {
    return "La nueva contrasena debe tener al menos 8 caracteres.";
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password) || !/[^a-zA-Z0-9]/.test(password)) {
    return "La nueva contrasena debe incluir letras, numeros y un caracter especial.";
  }
  return null;
};

export const loginControlador = async (
  request: FastifyRequest<{ Body: LoginBody }>,
  reply: FastifyReply
) => {
  const identificador = request.body?.identificador?.trim() ?? "";
  const password = request.body?.password ?? "";
  const recordar = Boolean(request.body?.recordar);

  if (!identificador || !password) {
    return reply.status(400).send({
      status: 400,
      codigo: "CREDENCIALES_INCOMPLETAS",
      mensaje: "Debe ingresar usuario y contrasena."
    });
  }

  const sesion = await authServicio.login({
    identificador,
    password,
    recordar,
    ip: request.ip ?? null,
    userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null
  });

  if (!sesion) {
    return reply.status(401).send({
      status: 401,
      codigo: "CREDENCIALES_INVALIDAS",
      mensaje: "Usuario o contrasena invalidos."
    });
  }

  reply.header("Cache-Control", "no-store");
  reply.header("Set-Cookie", construirCookieSesion(sesion.token, sesion.maxAgeSeconds));

  return reply.send({
    autenticado: true,
    usuario: sesion.usuario
  });
};

export const sessionControlador = async (request: FastifyRequest, reply: FastifyReply) => {
  if (!request.usuarioActual) {
    return reply.status(401).send({
      status: 401,
      codigo: "SESION_NO_VALIDA",
      mensaje: "No hay una sesion activa."
    });
  }

  reply.header("Cache-Control", "no-store");
  return reply.send({
    autenticado: true,
    usuario: request.usuarioActual
  });
};

export const logoutControlador = async (request: FastifyRequest, reply: FastifyReply) => {
  if (request.sessionToken) {
    await authServicio.cerrarSesion(request.sessionToken);
  }

  reply.header("Cache-Control", "no-store");
  reply.header("Set-Cookie", construirCookieSesionExpirada());

  return reply.send({
    autenticado: false
  });
};

export const passwordResetRequestControlador = async (
  request: FastifyRequest<{ Body: PasswordResetRequestBody }>,
  reply: FastifyReply
) => {
  const identificador = request.body?.identificador?.trim() ?? "";

  const resultado = await authServicio.solicitarRecuperacion(
    identificador,
    request.ip ?? null,
    typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null
  );

  const respuesta: Record<string, unknown> = {
    ok: true,
    mensaje: "Si la cuenta existe, se genero un proceso de recuperacion."
  };

  if (resultado.resetUrl && process.env.NODE_ENV !== "production") {
    respuesta.resetUrl = resultado.resetUrl;
    respuesta.expiresAt = resultado.expiresAt;
  }

  return reply.send(respuesta);
};

export const passwordResetVerifyControlador = async (
  request: FastifyRequest<{ Querystring: { token?: string } }>,
  reply: FastifyReply
) => {
  const token = request.query?.token?.trim() ?? "";
  if (!token) {
    return reply.status(400).send({
      status: 400,
      codigo: "TOKEN_REQUERIDO",
      mensaje: "Se requiere un token de recuperacion."
    });
  }

  const resultado = await authServicio.validarTokenRecuperacion(token);
  if (!resultado) {
    return reply.status(400).send({
      status: 400,
      codigo: "TOKEN_INVALIDO",
      mensaje: "El enlace de recuperacion no es valido o ya expiro."
    });
  }

  return reply.send({
    valido: true,
    cuenta: resultado
  });
};

export const passwordResetConfirmControlador = async (
  request: FastifyRequest<{ Body: PasswordResetConfirmBody }>,
  reply: FastifyReply
) => {
  const token = request.body?.token?.trim() ?? "";
  const password = request.body?.password ?? "";

  if (!token || !password) {
    return reply.status(400).send({
      status: 400,
      codigo: "DATOS_INCOMPLETOS",
      mensaje: "Debe proporcionar token y nueva contrasena."
    });
  }

  const errorPassword = validarPasswordSegura(password);
  if (errorPassword) {
    return reply.status(400).send({
      status: 400,
      codigo: "PASSWORD_INVALIDA",
      mensaje: errorPassword
    });
  }

  const actualizado = await authServicio.restablecerPassword(token, password);
  if (!actualizado) {
    return reply.status(400).send({
      status: 400,
      codigo: "TOKEN_INVALIDO",
      mensaje: "El enlace de recuperacion no es valido o ya expiro."
    });
  }

  reply.header("Set-Cookie", construirCookieSesionExpirada());

  return reply.send({
    ok: true,
    mensaje: "La contrasena se actualizo correctamente."
  });
};

export const changePasswordControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  if (!request.usuarioActual) {
    return reply.status(401).send({
      status: 401,
      codigo: "SESION_NO_VALIDA",
      mensaje: "Debe iniciar sesion para continuar."
    });
  }

  const body = (request.body ?? {}) as ChangePasswordBody;
  const passwordNueva = body.passwordNueva ?? "";

  if (!passwordNueva) {
    return reply.status(400).send({
      status: 400,
      codigo: "DATOS_INCOMPLETOS",
      mensaje: "Debe ingresar la nueva contrasena."
    });
  }

  const errorPassword = validarPasswordSegura(passwordNueva);
  if (errorPassword) {
    return reply.status(400).send({
      status: 400,
      codigo: "PASSWORD_INVALIDA",
      mensaje: errorPassword
    });
  }

  const usuarioActualizado = await authServicio.cambiarPasswordAutenticado({
    userId: request.usuarioActual.id,
    nuevoPassword: passwordNueva,
    sessionTokenActual: request.sessionToken ?? null
  });

  if (!usuarioActualizado) {
    return reply.status(400).send({
      status: 400,
      codigo: "PASSWORD_ACTUAL_INVALIDA",
      mensaje: "No se pudo actualizar la contrasena."
    });
  }

  reply.header("Cache-Control", "no-store");
  return reply.send({
    ok: true,
    mensaje: "La contrasena se actualizo correctamente.",
    usuario: usuarioActualizado
  });
};
