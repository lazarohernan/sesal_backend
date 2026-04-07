import type { FastifyReply, FastifyRequest } from "fastify";

import {
  type CambiarEstadoUsuarioInput,
  type ActualizarUsuarioRegionalInput,
  type ResetearPasswordUsuarioInput,
  usuariosServicio,
  type CrearUsuarioRegionalInput
} from "../servicios/usuarios.servicio";
import { logger } from "../utilidades/registro.utilidad";

interface CrearUsuarioRegionalBody {
  nombre?: string;
  username?: string;
  email?: string;
  passwordTemporal?: string;
  regiones?: unknown;
}

interface ActualizarUsuarioRegionalBody {
  nombre?: string;
  username?: string;
  email?: string;
  estado?: string;
  regiones?: unknown;
}

interface CambiarEstadoUsuarioBody {
  estado?: string;
}

const responderError = (reply: FastifyReply, status: number, codigo: string, mensaje: string) =>
  reply.status(status).send({
    status,
    codigo,
    mensaje
  });

const extraerRegiones = (valor: unknown): string[] => {
  if (!Array.isArray(valor)) {
    return [];
  }

  return valor
    .map((item) => String(item).trim())
    .filter(Boolean);
};

export const listarUsuariosControlador = async (_request: FastifyRequest, reply: FastifyReply) => {
  try {
    const usuarios = await usuariosServicio.listarUsuarios();

    return reply.send({
      datos: usuarios,
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    logger.error("Error al listar usuarios", error);
    throw error;
  }
};

export const crearUsuarioRegionalControlador = async (
  request: FastifyRequest<{ Body: CrearUsuarioRegionalBody }>,
  reply: FastifyReply
) => {
  const nombre = request.body?.nombre?.trim() ?? "";
  const username = request.body?.username?.trim() ?? "";
  const email = request.body?.email?.trim() ?? "";
  const passwordTemporal = request.body?.passwordTemporal?.trim() ?? "";
  const regiones = extraerRegiones(request.body?.regiones);

  if (!nombre || !username || !email || !passwordTemporal || regiones.length === 0) {
    return responderError(
      reply,
      400,
      "DATOS_INCOMPLETOS",
      "Debe completar nombre, usuario, correo, regiones y contrasena temporal."
    );
  }

  try {
    const resultado = await usuariosServicio.crearUsuarioRegional({
      nombre,
      username,
      email,
      passwordTemporal,
      regiones
    } satisfies CrearUsuarioRegionalInput);

    return reply.status(201).send({
      ok: true,
      mensaje: "Usuario regional creado correctamente.",
      usuario: resultado.usuario,
      passwordTemporal: resultado.passwordTemporal
    });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "No fue posible crear el usuario.";
    const codigo = mensaje.includes("existe") ? "DUPLICADO" : "ERROR_CREAR_USUARIO";
    const status = mensaje.includes("existe") ? 409 : 400;
    return responderError(reply, status, codigo, mensaje);
  }
};

export const actualizarUsuarioRegionalControlador = async (
  request: FastifyRequest<{ Params: { id: string }; Body: ActualizarUsuarioRegionalBody }>,
  reply: FastifyReply
) => {
  const id = Number(request.params?.id ?? 0);
  const nombre = request.body?.nombre?.trim() ?? "";
  const username = request.body?.username?.trim() ?? "";
  const email = request.body?.email?.trim() ?? "";
  const estado = request.body?.estado === "inactivo" ? "inactivo" : "activo";
  const regiones = extraerRegiones(request.body?.regiones);

  if (!Number.isInteger(id) || id <= 0 || !nombre || !username || !email || regiones.length === 0) {
    return responderError(
      reply,
      400,
      "DATOS_INCOMPLETOS",
      "Debe completar nombre, usuario, correo, estado y regiones."
    );
  }

  try {
    const usuario = await usuariosServicio.actualizarUsuarioRegional({
      id,
      nombre,
      username,
      email,
      estado,
      regiones
    } satisfies ActualizarUsuarioRegionalInput);

    return reply.send({
      ok: true,
      mensaje: "Usuario regional actualizado correctamente.",
      usuario
    });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "No fue posible actualizar el usuario.";
    const codigo =
      mensaje.includes("existe")
        ? "DUPLICADO"
        : mensaje.includes("no existe")
          ? "NO_ENCONTRADO"
          : "ERROR_ACTUALIZAR_USUARIO";
    const status =
      mensaje.includes("existe")
        ? 409
        : mensaje.includes("no existe")
          ? 404
          : 400;
    return responderError(reply, status, codigo, mensaje);
  }
};

export const cambiarEstadoUsuarioRegionalControlador = async (
  request: FastifyRequest<{ Params: { id: string }; Body: CambiarEstadoUsuarioBody }>,
  reply: FastifyReply
) => {
  const id = Number(request.params?.id ?? 0);
  const estado = request.body?.estado === "inactivo" ? "inactivo" : "activo";

  if (!Number.isInteger(id) || id <= 0) {
    return responderError(reply, 400, "DATOS_INVALIDOS", "Debe indicar un usuario valido.");
  }

  try {
    const usuario = await usuariosServicio.cambiarEstadoUsuarioRegional({
      id,
      estado
    } satisfies CambiarEstadoUsuarioInput);

    return reply.send({
      ok: true,
      mensaje: estado === "activo" ? "Usuario activado correctamente." : "Usuario inactivado correctamente.",
      usuario
    });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "No fue posible cambiar el estado del usuario.";
    const codigo = mensaje.includes("no existe") ? "NO_ENCONTRADO" : "ERROR_CAMBIAR_ESTADO";
    const status = mensaje.includes("no existe") ? 404 : 400;
    return responderError(reply, status, codigo, mensaje);
  }
};

export const eliminarUsuarioRegionalControlador = async (
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) => {
  const id = Number(request.params?.id ?? 0);

  if (!Number.isInteger(id) || id <= 0) {
    return responderError(reply, 400, "DATOS_INVALIDOS", "Debe indicar un usuario valido.");
  }

  try {
    await usuariosServicio.eliminarUsuarioRegional(id);

    return reply.send({
      ok: true,
      mensaje: "Usuario eliminado correctamente."
    });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "No fue posible eliminar el usuario.";
    const codigo = mensaje.includes("no existe") ? "NO_ENCONTRADO" : "ERROR_ELIMINAR_USUARIO";
    const status = mensaje.includes("no existe") ? 404 : 400;
    return responderError(reply, status, codigo, mensaje);
  }
};

export const resetearPasswordUsuarioRegionalControlador = async (
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) => {
  const id = Number(request.params?.id ?? 0);

  if (!Number.isInteger(id) || id <= 0) {
    return responderError(reply, 400, "DATOS_INVALIDOS", "Debe indicar un usuario valido.");
  }

  try {
    const resultado = await usuariosServicio.resetearPasswordUsuarioRegional({
      id
    } satisfies ResetearPasswordUsuarioInput);

    return reply.send({
      ok: true,
      mensaje: "Contrasena temporal regenerada correctamente.",
      usuario: resultado.usuario,
      passwordTemporal: resultado.passwordTemporal
    });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "No fue posible regenerar la contrasena del usuario.";
    const codigo = mensaje.includes("no existe") ? "NO_ENCONTRADO" : "ERROR_REGENERAR_PASSWORD";
    const status = mensaje.includes("no existe") ? 404 : 400;
    return responderError(reply, status, codigo, mensaje);
  }
};
