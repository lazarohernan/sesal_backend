import type { FastifyReply, FastifyRequest } from "fastify";
import { establecimientosServicio } from "../servicios/establecimientos.servicio";
import { logger } from "../utilidades/registro.utilidad";

const responderError = (reply: FastifyReply, status: number, codigo: string, mensaje: string) =>
  reply.status(status).send({ status, codigo, mensaje });

// GET /api/establecimientos
export const listarEstablecimientosControlador = async (_req: FastifyRequest, reply: FastifyReply) => {
  try {
    const datos = await establecimientosServicio.listar();
    return reply.send({ datos, generadoEn: new Date().toISOString() });
  } catch (error) {
    logger.error("Error al listar establecimientos", error);
    throw error;
  }
};

// GET /api/establecimientos/niveles
export const listarNivelesControlador = async (_req: FastifyRequest, reply: FastifyReply) => {
  try {
    const datos = await establecimientosServicio.listarNiveles();
    return reply.send({ datos });
  } catch (error) {
    logger.error("Error al listar niveles", error);
    throw error;
  }
};

// GET /api/establecimientos/municipios?region=X
export const listarMunicipiosControlador = async (
  request: FastifyRequest<{ Querystring: { region?: string } }>,
  reply: FastifyReply
) => {
  const regionCodigo = Number(request.query.region);
  if (!regionCodigo || regionCodigo < 1 || regionCodigo > 20) {
    return responderError(reply, 400, "REGION_INVALIDA", "El parámetro region debe ser un número entre 1 y 20.");
  }
  try {
    const datos = await establecimientosServicio.listarMunicipiosPorRegion(regionCodigo);
    return reply.send({ datos });
  } catch (error) {
    logger.error("Error al listar municipios", error);
    throw error;
  }
};

// POST /api/establecimientos
export const crearEstablecimientoControlador = async (
  request: FastifyRequest<{ Body: { codigoRup?: unknown; nombre?: unknown; nivelCodigo?: unknown; regionCodigo?: unknown; municipioCodigo?: unknown } }>,
  reply: FastifyReply
) => {
  const { codigoRup, nombre, nivelCodigo, regionCodigo, municipioCodigo } = request.body ?? {};

  if (!codigoRup || !nombre || !nivelCodigo || !regionCodigo || !municipioCodigo) {
    return responderError(reply, 400, "CAMPOS_REQUERIDOS", "Todos los campos son obligatorios: codigoRup, nombre, nivelCodigo, regionCodigo, municipioCodigo.");
  }

  try {
    const establecimiento = await establecimientosServicio.crear({
      codigoRup: String(codigoRup).trim(),
      nombre: String(nombre).trim(),
      nivelCodigo: Number(nivelCodigo),
      regionCodigo: Number(regionCodigo),
      municipioCodigo: Number(municipioCodigo),
    });
    return reply.status(201).send({ ok: true, mensaje: "Establecimiento creado correctamente.", establecimiento });
  } catch (error) {
    logger.error("Error al crear establecimiento", error);
    const mensaje = error instanceof Error ? error.message : "No se pudo crear el establecimiento.";
    return responderError(reply, 400, "ERROR_CREACION", mensaje);
  }
};

// PATCH /api/establecimientos/:id/estado
export const cambiarEstadoControlador = async (
  request: FastifyRequest<{ Params: { id?: string }; Body: { estado?: unknown } }>,
  reply: FastifyReply
) => {
  const id = Number(request.params.id);
  const estado = request.body?.estado;

  if (!id) return responderError(reply, 400, "ID_INVALIDO", "ID de establecimiento inválido.");
  if (estado !== "activo" && estado !== "inactivo") {
    return responderError(reply, 400, "ESTADO_INVALIDO", "El estado debe ser 'activo' o 'inactivo'.");
  }

  try {
    const establecimiento = await establecimientosServicio.cambiarEstado({ id, estado });
    return reply.send({ ok: true, mensaje: `Establecimiento ${estado} correctamente.`, establecimiento });
  } catch (error) {
    logger.error("Error al cambiar estado de establecimiento", error);
    throw error;
  }
};

// PATCH /api/establecimientos/:id
export const actualizarEstablecimientoControlador = async (
  request: FastifyRequest<{ Params: { id?: string }; Body: { nombre?: unknown; nivelCodigo?: unknown; regionCodigo?: unknown; municipioCodigo?: unknown } }>,
  reply: FastifyReply
) => {
  const id = Number(request.params.id);
  if (!id) return responderError(reply, 400, "ID_INVALIDO", "ID de establecimiento inválido.");

  const { nombre, nivelCodigo, regionCodigo, municipioCodigo } = request.body ?? {};

  if (!nombre || !nivelCodigo || !regionCodigo || !municipioCodigo) {
    return responderError(reply, 400, "CAMPOS_REQUERIDOS", "Faltan campos obligatorios.");
  }

  try {
    const establecimiento = await establecimientosServicio.actualizar({
      id,
      nombre: String(nombre).trim(),
      nivelCodigo: Number(nivelCodigo),
      regionCodigo: Number(regionCodigo),
      municipioCodigo: Number(municipioCodigo),
    });
    return reply.send({ ok: true, mensaje: "Establecimiento actualizado correctamente.", establecimiento });
  } catch (error) {
    logger.error("Error al actualizar establecimiento", error);
    throw error;
  }
};
