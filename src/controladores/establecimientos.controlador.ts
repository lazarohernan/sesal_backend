import type { FastifyReply, FastifyRequest } from "fastify";
import { establecimientosServicio } from "../servicios/establecimientos.servicio";
import { establecimientoAtributosServicio } from "../servicios/establecimiento-atributos.servicio";
import { cache } from "../utilidades/cache.utilidad";
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

const nombreUsuario = (request: FastifyRequest) =>
  request.usuarioActual?.nombreMostrar || request.usuarioActual?.username || "desconocido";

/** El seguimiento y el control de envíos dependen de quién está exento. */
const invalidarCacheSeguimiento = () => {
  cache.deleteByPrefix("reportes:control-envios-at2");
};

const leerPoblacion = (valor: unknown): number | null | undefined => {
  if (valor === undefined) return undefined;
  if (valor === null || valor === "") return null;
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= 0 && numero <= 50_000_000 ? numero : undefined;
};

// PATCH /api/establecimientos/:id/atributos
export const actualizarAtributosControlador = async (
  request: FastifyRequest<{
    Params: { id?: string };
    Body: { poblacion?: unknown; exentoReporte?: unknown; motivoExencion?: unknown };
  }>,
  reply: FastifyReply
) => {
  const id = Number(request.params.id);
  if (!id) return responderError(reply, 400, "ID_INVALIDO", "ID de establecimiento inválido.");

  const { poblacion, exentoReporte, motivoExencion } = request.body ?? {};
  const poblacionValida = leerPoblacion(poblacion);
  if (poblacion !== undefined && poblacionValida === undefined) {
    return responderError(reply, 400, "POBLACION_INVALIDA", "La población debe ser un número entero positivo.");
  }
  if (exentoReporte !== undefined && typeof exentoReporte !== "boolean") {
    return responderError(reply, 400, "EXENTO_INVALIDO", "exentoReporte debe ser verdadero o falso.");
  }

  try {
    const existente = await establecimientosServicio.obtenerPorId(id);
    if (!existente) return responderError(reply, 404, "NO_ENCONTRADO", "Establecimiento no encontrado.");

    await establecimientoAtributosServicio.guardar({
      rups: existente.codigoRup,
      poblacion: poblacionValida,
      exentoReporte: exentoReporte as boolean | undefined,
      motivoExencion: motivoExencion === undefined ? undefined : String(motivoExencion ?? ""),
      actualizadoPor: nombreUsuario(request)
    });
    if (exentoReporte !== undefined) invalidarCacheSeguimiento();

    const establecimiento = await establecimientosServicio.obtenerPorId(id);
    return reply.send({ ok: true, mensaje: "Datos del establecimiento actualizados.", establecimiento });
  } catch (error) {
    logger.error("Error al actualizar atributos del establecimiento", error);
    throw error;
  }
};

// POST /api/establecimientos/poblacion  { filas: [{ rups, poblacion }] }
export const cargarPoblacionControlador = async (
  request: FastifyRequest<{ Body: { filas?: unknown } }>,
  reply: FastifyReply
) => {
  const filas = request.body?.filas;
  if (!Array.isArray(filas) || filas.length === 0 || filas.length > 10_000) {
    return responderError(reply, 400, "FILAS_INVALIDAS", "Envíe entre 1 y 10,000 filas con RUPS y población.");
  }

  const validas: Array<{ rups: string; poblacion: number }> = [];
  const invalidas: number[] = [];
  filas.forEach((fila, indice) => {
    const rups = String((fila as { rups?: unknown })?.rups ?? "").trim().replace(/^0+(?=\d)/, "");
    const poblacion = leerPoblacion((fila as { poblacion?: unknown })?.poblacion);
    if (/^\d+$/.test(rups) && typeof poblacion === "number") {
      validas.push({ rups, poblacion });
    } else {
      invalidas.push(indice + 1);
    }
  });

  try {
    const resultado = await establecimientoAtributosServicio.cargarPoblacion(validas, nombreUsuario(request));
    return reply.send({ ok: true, ...resultado, filasInvalidas: invalidas });
  } catch (error) {
    logger.error("Error al cargar población por RUPS", error);
    throw error;
  }
};
