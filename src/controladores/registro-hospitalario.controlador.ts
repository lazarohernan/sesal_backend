import type { FastifyRequest, FastifyReply } from "fastify";
import type { RowDataPacket } from "mysql2";
import { obtenerPoolActual } from "../base_datos/pool";
import { AlcanceRegionalError, obtenerRegionesPermitidasUsuario, resolverRegionParaRegistro } from "../utilidades/alcance-regional.util";
import { logger } from "../utilidades/registro.utilidad";
import { cache } from "../utilidades/cache.utilidad";
import { seguimientoServicio } from "../servicios/seguimiento.servicio";
import { obtenerTablaDetalleAt2 } from "../servicios/at2-detalle-fuente.servicio";
import {
  sincronizarTotalPacientesAtendidos,
  validarConsistenciaAt2r,
  type RegistroAt2Normalizado
} from "../utilidades/at2-reglas.util";

// -- Versión activa del formulario AT2R --

export type VersionFormularioAt2 = '1' | '2';

const CONCEPTO_MAX_V1 = 53;
const CONCEPTO_MAX_V2 = 92;
const V_FORMULARIO_V1 = '3';
const V_FORMULARIO_V2 = '4';

const vFormularioPorVersion = (v: VersionFormularioAt2) =>
  v === '2' ? V_FORMULARIO_V2 : V_FORMULARIO_V1;

const conceptoMaxPorVersion = (v: VersionFormularioAt2) =>
  v === '2' ? CONCEPTO_MAX_V2 : CONCEPTO_MAX_V1;

const conceptoMaxPorAnio = (anio: number) =>
  anio >= 2026 ? CONCEPTO_MAX_V2 : CONCEPTO_MAX_V1;

const vFormularioPorAnio = (anio: number) =>
  anio >= 2026 ? V_FORMULARIO_V2 : V_FORMULARIO_V1;

const versionFormularioPorAnio = (anio: number): VersionFormularioAt2 =>
  anio >= 2026 ? '2' : '1';

const invalidarCachesAt2 = (anio: number) => {
  cache.deleteByPrefix("pivot:query:");
  cache.deleteByPrefix(`pivot:meses:${anio}`);
  cache.deleteByPrefix("reportes:");
  cache.deleteByPrefix("tablero:");
};

// -- Validacion y sanitizacion --

const REGION_MIN = 1;
const REGION_MAX = 20;
const MES_MIN = 1;
const MES_MAX = 12;
const ANIO_MIN = 2025;
const ANIO_MAX = 2099;
const CONCEPTO_MIN = 1;
const VALOR_MAX = 999999;

const SERVICIOS_VALIDOS = new Set(['consulta_externa', 'emergencia']);

const sanitizarServicio = (valor: unknown): 'consulta_externa' | 'emergencia' | null => {
  if (valor === undefined || valor === null) return null;
  const texto = String(valor).trim().toLowerCase();
  return SERVICIOS_VALIDOS.has(texto) ? (texto as 'consulta_externa' | 'emergencia') : null;
};

// Niveles de establecimiento que corresponden a hospitales (HB=1, HG=2, HESP=3)
const NIVELES_HOSPITAL = [1, 2, 3];

const esCodigoHospital = async (rups: string): Promise<boolean> => {
  const pool = obtenerPoolActual();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM BAS_BDR_US WHERE CAST(C_US AS CHAR) = ? AND C_NIVEL_US IN (${NIVELES_HOSPITAL.join(',')}) LIMIT 1`,
    [rups]
  );
  return rows.length > 0;
};

const sanitizarEntero = (valor: unknown, min: number, max: number): number | null => {
  const num = Number(valor);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  if (num < min || num > max) return null;
  return num;
};

const sanitizarValorNumerico = (valor: unknown): number => {
  const num = Number(valor);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.min(Math.floor(num), VALOR_MAX);
};

const sanitizarCodigoRups = (valor: unknown): string | null => {
  if (valor === undefined || valor === null) return null;
  const texto = String(valor).trim();
  return /^\d+$/.test(texto) ? texto : null;
};

const validarRupsPerteneceARegion = async (
  rups: string,
  regionId: number
) => {
  const pool = obtenerPoolActual();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
      CAST(C_US AS CHAR) AS rups,
      C_REGION AS region,
      D_US AS establecimiento
     FROM BAS_BDR_US
     WHERE CAST(C_US AS CHAR) = ?
     LIMIT 1`,
    [rups]
  );

  const registro = rows[0];
  if (!registro) {
    throw new AlcanceRegionalError(
      "El codigo RUPS indicado no existe en el catalogo de establecimientos.",
      400,
      "ESTABLECIMIENTO_INVALIDO"
    );
  }

  const regionEstablecimiento = Number(registro.region);
  if (!Number.isInteger(regionEstablecimiento) || regionEstablecimiento !== regionId) {
    throw new AlcanceRegionalError(
      "El establecimiento indicado no pertenece a la region seleccionada o autorizada.",
      403,
      "ESTABLECIMIENTO_NO_AUTORIZADO"
    );
  }

  return {
    rups: String(registro.rups),
    region: regionEstablecimiento,
    establecimiento: typeof registro.establecimiento === "string" ? registro.establecimiento.trim() : null
  };
};

// -- POST /api/registro-hospitalario --

export const guardarRegistroControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const esEdicion = request.method === "PUT";
    const { region, anio, mes, registros, establecimiento, establecimientoCodigo, rups, servicio } = request.body as any;

    // Validar campos requeridos
    const regionFueEnviado = region !== undefined && region !== null && region !== "";
    const regionSolicitada = regionFueEnviado ? sanitizarEntero(region, REGION_MIN, REGION_MAX) : null;
    if (regionFueEnviado && regionSolicitada === null) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: `El campo 'region' debe ser un entero entre ${REGION_MIN} y ${REGION_MAX}`
      });
    }

    const regionVal = resolverRegionParaRegistro(request.usuarioActual, regionSolicitada);
    if (regionVal === null) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: `El campo 'region' debe ser un entero entre ${REGION_MIN} y ${REGION_MAX}`
      });
    }

    const anioVal = sanitizarEntero(anio, ANIO_MIN, ANIO_MAX);
    if (anioVal === null) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: `El campo 'anio' debe ser un entero entre ${ANIO_MIN} y ${ANIO_MAX}`
      });
    }

    const mesVal = sanitizarEntero(mes, MES_MIN, MES_MAX);
    if (mesVal === null) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: `El campo 'mes' debe ser un entero entre ${MES_MIN} y ${MES_MAX}`
      });
    }

    let versionActiva = versionFormularioPorAnio(anioVal);
    let conceptoMaxActual = conceptoMaxPorAnio(anioVal);
    let vFormularioActual = vFormularioPorAnio(anioVal);

    const codigoRups =
      sanitizarCodigoRups(establecimientoCodigo) ??
      sanitizarCodigoRups(establecimiento) ??
      sanitizarCodigoRups(rups);

    const usarRegistroPorEstablecimiento = anioVal >= 2026;
    const identificadorRegistro = usarRegistroPorEstablecimiento ? codigoRups : String(regionVal);

    if (usarRegistroPorEstablecimiento && !identificadorRegistro) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "Para 2026 en adelante debe indicar un establecimiento valido mediante su codigo RUPS."
      });
    }

    if (usarRegistroPorEstablecimiento && identificadorRegistro) {
      await validarRupsPerteneceARegion(identificadorRegistro, regionVal);
    }

    const esHospital = identificadorRegistro ? await esCodigoHospital(identificadorRegistro) : false;
    const servicioVal = sanitizarServicio(servicio);

    if (esHospital && !servicioVal) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "Este establecimiento es un hospital. Debe indicar el servicio: 'consulta_externa' o 'emergencia'."
      });
    }

    // C_SERVICIO: histórico usa '1'=Consulta Externa, '2'=Emergencia
    const cServicio = esHospital
      ? (servicioVal === 'emergencia' ? '2' : '1')
      : '1';

    const pool = obtenerPoolActual();
    const tablaDetalle = obtenerTablaDetalleAt2(anioVal);
    if (anioVal >= 2026 && identificadorRegistro) {
      await seguimientoServicio.asegurarTabla();
    }

    const [versionesExistentes] = await pool.query<RowDataPacket[]>(
      `SELECT V_FORMULARIO, COUNT(*) AS total
       FROM ${tablaDetalle}
       WHERE C_US = ? AND N_ANIO = ? AND N_MES = ? AND C_SERVICIO = ?
       GROUP BY V_FORMULARIO`,
      [identificadorRegistro, anioVal, mesVal, cServicio]
    );
    const totalExistente = versionesExistentes.reduce(
      (total, fila) => total + Number(fila.total ?? 0),
      0
    );

    // Una edición conserva el esquema real del bloque. Esto evita reinterpretar
    // registros 2026 legados (V_FORMULARIO=3) como conceptos del formulario nuevo.
    if (
      esEdicion &&
      totalExistente > 0 &&
      !versionesExistentes.some((fila) => String(fila.V_FORMULARIO) === V_FORMULARIO_V2) &&
      versionesExistentes.some((fila) => String(fila.V_FORMULARIO) === V_FORMULARIO_V1)
    ) {
      versionActiva = '1';
      conceptoMaxActual = CONCEPTO_MAX_V1;
      vFormularioActual = V_FORMULARIO_V1;
    }

    if (!Array.isArray(registros) || registros.length === 0 || registros.length > conceptoMaxActual) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: `El campo 'registros' debe ser un array de 1 a ${conceptoMaxActual} elementos (versión ${versionActiva} para ${anioVal})`
      });
    }

    // Sanitizar cada registro
    const conceptosVistos = new Set<number>();
    const registrosNormalizados: RegistroAt2Normalizado[] = [];

    for (const registro of registros) {
      const concepto = sanitizarEntero(registro.concepto, CONCEPTO_MIN, conceptoMaxActual);
      if (concepto === null) {
        return reply.status(400).send({
          codigo: "PARAMETRO_INVALIDO",
          mensaje: `Concepto inválido: debe ser entre ${CONCEPTO_MIN} y ${conceptoMaxActual} (versión ${versionActiva} para ${anioVal})`
        });
      }

      if (conceptosVistos.has(concepto)) {
        return reply.status(400).send({
          codigo: "PARAMETRO_INVALIDO",
          mensaje: `Concepto duplicado: ${concepto}`
        });
      }
      conceptosVistos.add(concepto);

      const enfermeraAux = sanitizarValorNumerico(registro.enfermeraAux);
      const enfermeraPro = sanitizarValorNumerico(registro.enfermeraPro);
      const medicoGen = sanitizarValorNumerico(registro.medicoGen);
      const medicoEsp = sanitizarValorNumerico(registro.medicoEsp);

      registrosNormalizados.push({
        concepto,
        enfermeraAux,
        enfermeraPro,
        medicoGen,
        medicoEsp
      });
    }

    sincronizarTotalPacientesAtendidos(registrosNormalizados);
    const errorConsistencia = validarConsistenciaAt2r(registrosNormalizados, conceptoMaxActual);
    if (errorConsistencia) {
      return reply.status(400).send({
        codigo: "TOTALES_AT2R_INVALIDOS",
        mensaje: errorConsistencia
      });
    }

    const filas: Array<[string, number, number, string, string, null, string, number, number, number, number]> = [];

    for (const registro of registrosNormalizados) {
      // Solo insertar si tiene al menos un valor > 0
      if (registro.enfermeraAux + registro.enfermeraPro + registro.medicoGen + registro.medicoEsp > 0 && identificadorRegistro) {
        filas.push([
          identificadorRegistro,
          anioVal,               // N_ANIO
          mesVal,                // N_MES
          cServicio,             // C_SERVICIO
          String(registro.concepto), // C_CONCEPTO
          null,                  // V_US
          vFormularioActual,     // V_FORMULARIO ('3'=v1/53, '4'=v2/92)
          registro.enfermeraAux,
          registro.enfermeraPro,
          registro.medicoGen,
          registro.medicoEsp
        ]);
      }
    }

    if (filas.length === 0) {
      return reply.status(400).send({
        codigo: "SIN_DATOS",
        mensaje: "No se encontraron valores numéricos para guardar"
      });
    }

    if (totalExistente > 0 && !esEdicion) {
      return reply.status(409).send({
        codigo: "REGISTRO_DUPLICADO",
        mensaje: "Establecimiento de salud digitado, solo se permiten modificaciones o eliminacion.",
        datos: {
          region: regionVal,
          establecimiento: identificadorRegistro,
          anio: anioVal,
          mes: mesVal,
          servicio: cServicio,
          conceptosExistentes: totalExistente
        }
      });
    }

    if (totalExistente === 0 && esEdicion) {
      return reply.status(404).send({
        codigo: "REGISTRO_NO_EXISTE",
        mensaje: "No existe un registro previo para modificar."
      });
    }

    // Transacción: POST crea registros nuevos; PUT reemplaza un registro existente confirmado.
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      if (esEdicion) {
        await conn.query(
          `DELETE FROM ${tablaDetalle} WHERE C_US = ? AND N_ANIO = ? AND N_MES = ? AND C_SERVICIO = ?`,
          [identificadorRegistro, anioVal, mesVal, cServicio]
        );
      }

      const sql = `
        INSERT INTO ${tablaDetalle} (C_US, N_ANIO, N_MES, C_SERVICIO, C_CONCEPTO, V_US, V_FORMULARIO, Q_AT_ENFERMERA_AUX, Q_AT_ENFERMERA_PRO, Q_AT_MEDICO_GEN, Q_AT_MEDICO_ESP)
        VALUES ?
      `;

      const [resultado] = await conn.query(sql, [filas]);

      if (anioVal >= 2026 && identificadorRegistro) {
        await seguimientoServicio.registrarEnvio(
          {
            anio: anioVal,
            mes: mesVal,
            regionCodigo: regionVal,
            establecimientoRups: identificadorRegistro,
            servicio: esHospital
              ? (servicioVal === "emergencia" ? "emergencia" : "consulta_externa")
              : "general"
          },
          conn
        );
      }

      await conn.commit();
      invalidarCachesAt2(anioVal);

      const info = resultado as { affectedRows: number };
      logger.info(`Registro hospitalario ${esEdicion ? "actualizado" : "guardado"}: identificador=${identificadorRegistro}, region=${regionVal}, ${mesVal}/${anioVal}, ${filas.length} conceptos, ${info.affectedRows} filas afectadas`);

      return reply.status(200).send({
        mensaje: esEdicion ? "Registro actualizado correctamente" : "Registro guardado correctamente",
        datos: {
          region: regionVal,
          establecimiento: identificadorRegistro,
          anio: anioVal,
          mes: mesVal,
          versionFormulario: versionActiva,
          vFormularioBD: vFormularioActual,
          conceptosGuardados: filas.length,
          filasAfectadas: info.affectedRows
        },
        generadoEn: new Date().toISOString()
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (error) {
    if (error instanceof AlcanceRegionalError) {
      return reply.status(error.statusCode).send({
        codigo: error.codigo,
        mensaje: error.message
      });
    }
    logger.error("Error al guardar registro hospitalario", error);
    throw error;
  }
};

// -- DELETE /api/registro-hospitalario --

export const eliminarRegistroControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const {
      region,
      anio,
      mes,
      establecimiento,
      establecimientoCodigo,
      rups,
      servicio
    } = (request.body ?? {}) as Record<string, unknown>;

    const regionFueEnviada = region !== undefined && region !== null && region !== "";
    const regionSolicitada = regionFueEnviada
      ? sanitizarEntero(region, REGION_MIN, REGION_MAX)
      : null;
    const regionVal = resolverRegionParaRegistro(request.usuarioActual, regionSolicitada);
    const anioVal = sanitizarEntero(anio, ANIO_MIN, ANIO_MAX);
    const mesVal = sanitizarEntero(mes, MES_MIN, MES_MAX);

    if (
      (regionFueEnviada && regionSolicitada === null) ||
      regionVal === null ||
      anioVal === null ||
      mesVal === null
    ) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "Se requieren región, año y mes válidos para eliminar el registro."
      });
    }

    const codigoRups =
      sanitizarCodigoRups(establecimientoCodigo) ??
      sanitizarCodigoRups(establecimiento) ??
      sanitizarCodigoRups(rups);
    const identificadorRegistro = anioVal >= 2026 ? codigoRups : String(regionVal);

    if (!identificadorRegistro) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "Para 2026 en adelante debe indicar un establecimiento válido mediante su código RUPS."
      });
    }

    if (anioVal >= 2026) {
      await validarRupsPerteneceARegion(identificadorRegistro, regionVal);
    }

    const esHospital = await esCodigoHospital(identificadorRegistro);
    const servicioVal = sanitizarServicio(servicio);
    if (esHospital && !servicioVal) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "Este establecimiento es un hospital. Debe indicar el servicio que desea eliminar."
      });
    }

    const cServicio = esHospital
      ? (servicioVal === "emergencia" ? "2" : "1")
      : "1";
    const servicioSeguimiento = esHospital
      ? (servicioVal === "emergencia" ? "emergencia" : "consulta_externa")
      : "general";
    const tablaDetalle = obtenerTablaDetalleAt2(anioVal);
    const pool = obtenerPoolActual();

    if (anioVal >= 2026) {
      await seguimientoServicio.asegurarTabla();
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [resultado] = await conn.query(
        `DELETE FROM ${tablaDetalle}
         WHERE C_US = ?
           AND N_ANIO = ?
           AND N_MES = ?
           AND C_SERVICIO = ?`,
        [identificadorRegistro, anioVal, mesVal, cServicio]
      );
      const filasEliminadas = Number(
        (resultado as { affectedRows?: number }).affectedRows ?? 0
      );

      if (filasEliminadas === 0) {
        await conn.rollback();
        return reply.status(404).send({
          codigo: "REGISTRO_NO_EXISTE",
          mensaje: "No existe un registro guardado para eliminar."
        });
      }

      if (anioVal >= 2026) {
        await seguimientoServicio.registrarEliminacion(
          {
            anio: anioVal,
            mes: mesVal,
            regionCodigo: regionVal,
            establecimientoRups: identificadorRegistro,
            servicio: servicioSeguimiento
          },
          conn
        );
      }

      await conn.commit();
      invalidarCachesAt2(anioVal);

      logger.info(
        `Registro hospitalario eliminado: identificador=${identificadorRegistro}, region=${regionVal}, ${mesVal}/${anioVal}, servicio=${cServicio}, filas=${filasEliminadas}`
      );

      return reply.status(200).send({
        mensaje: "Registro eliminado correctamente",
        datos: {
          region: regionVal,
          establecimiento: identificadorRegistro,
          anio: anioVal,
          mes: mesVal,
          servicio: cServicio,
          filasEliminadas
        },
        generadoEn: new Date().toISOString()
      });
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  } catch (error) {
    if (error instanceof AlcanceRegionalError) {
      return reply.status(error.statusCode).send({
        codigo: error.codigo,
        mensaje: error.message
      });
    }
    logger.error("Error al eliminar registro hospitalario", error);
    throw error;
  }
};

// -- GET /api/registro-hospitalario --

export const obtenerRegistroControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const { region, anio, mes, establecimiento, establecimientoCodigo, rups, servicio } = request.query as Record<string, string | undefined>;

    const regionFueEnviada = region !== undefined && region !== null && region !== "";
    const regionSolicitada = regionFueEnviada ? sanitizarEntero(region, REGION_MIN, REGION_MAX) : null;
    const anioVal = sanitizarEntero(anio, ANIO_MIN, ANIO_MAX);
    const mesVal = sanitizarEntero(mes, MES_MIN, MES_MAX);

    if ((regionFueEnviada && regionSolicitada === null) || anioVal === null || mesVal === null) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "Se requieren los parámetros 'region' (1-20), 'anio' (2025+) y 'mes' (1-12)"
      });
    }

    const regionVal = resolverRegionParaRegistro(request.usuarioActual, regionSolicitada);
    if (regionVal === null) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "Se requieren los parámetros 'region' (1-20), 'anio' (2025+) y 'mes' (1-12)"
      });
    }

    const codigoRups =
      sanitizarCodigoRups(establecimientoCodigo) ??
      sanitizarCodigoRups(establecimiento) ??
      sanitizarCodigoRups(rups);
    const identificadorRegistro = anioVal >= 2026 ? codigoRups : String(regionVal);

    if (!identificadorRegistro) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "Para 2026 en adelante debe indicar un establecimiento valido mediante su codigo RUPS."
      });
    }

    if (anioVal >= 2026) {
      await validarRupsPerteneceARegion(identificadorRegistro, regionVal);
    }

    const esHospitalGet = identificadorRegistro ? await esCodigoHospital(identificadorRegistro) : false;
    const servicioValGet = sanitizarServicio(servicio);
    const cServicioGet = esHospitalGet
      ? (servicioValGet === 'emergencia' ? '2' : '1')
      : '1';

    const pool = obtenerPoolActual();
    const tablaDetalle = obtenerTablaDetalleAt2(anioVal);
    const [versiones] = await pool.query<RowDataPacket[]>(
      `SELECT V_FORMULARIO, COUNT(*) AS total
       FROM ${tablaDetalle}
       WHERE C_US = ? AND N_ANIO = ? AND N_MES = ? AND C_SERVICIO = ?
       GROUP BY V_FORMULARIO`,
      [identificadorRegistro, anioVal, mesVal, cServicioGet]
    );
    const tieneVersionNueva = versiones.some(
      (fila) => String(fila.V_FORMULARIO) === V_FORMULARIO_V2
    );
    const tieneVersionHistorica = versiones.some(
      (fila) => String(fila.V_FORMULARIO) === V_FORMULARIO_V1
    );
    const versionActivaGet: VersionFormularioAt2 =
      tieneVersionNueva ? '2' : tieneVersionHistorica ? '1' : versionFormularioPorAnio(anioVal);
    const vFormularioGet = vFormularioPorVersion(versionActivaGet);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
        CAST(C_CONCEPTO AS UNSIGNED) AS concepto,
        Q_AT_ENFERMERA_AUX AS enfermera_aux,
        Q_AT_ENFERMERA_PRO AS enfermera_pro,
        Q_AT_MEDICO_GEN AS medico_gen,
        Q_AT_MEDICO_ESP AS medico_esp
       FROM ${tablaDetalle}
       WHERE C_US = ? AND N_ANIO = ? AND N_MES = ? AND C_SERVICIO = ? AND V_FORMULARIO = ?
       ORDER BY CAST(C_CONCEPTO AS UNSIGNED)`,
      [identificadorRegistro, anioVal, mesVal, cServicioGet, vFormularioGet]
    );

    return reply.status(200).send({
      datos: rows,
      region: regionVal,
      establecimiento: identificadorRegistro,
      anio: anioVal,
      mes: mesVal,
      versionFormulario: versionActivaGet,
      vFormularioBD: vFormularioGet,
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    if (error instanceof AlcanceRegionalError) {
      return reply.status(error.statusCode).send({
        codigo: error.codigo,
        mensaje: error.message
      });
    }
    logger.error("Error al obtener registro hospitalario", error);
    throw error;
  }
};

// -- GET /api/registro-hospitalario/version-formulario --

export const obtenerVersionFormularioControlador = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const anio = new Date().getFullYear();
    const version = versionFormularioPorAnio(anio);
    return reply.status(200).send({
      versionFormulario: version,
      maxConcepto: conceptoMaxPorVersion(version),
      vFormularioBD: vFormularioPorVersion(version),
      descripcion: version === '2' ? 'AT2-R-2026 (92 casillas)' : 'AT2-R-2012 (53 casillas)',
      modoSeleccion: 'por_anio',
      anio,
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    logger.error("Error al obtener versión formulario AT2R", error);
    throw error;
  }
};

// -- PUT /api/registro-hospitalario/version-formulario --

export const actualizarVersionFormularioControlador = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  return reply.status(409).send({
    codigo: "VERSION_DEFINIDA_POR_ANIO",
    mensaje: "La versión del formulario AT2-R se determina por el año del registro y no puede cambiarse manualmente."
  });
};

// -- GET /api/registro-hospitalario/estado --

export const obtenerEstadoRegistrosControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const { anio } = request.query as Record<string, string | undefined>;
    const anioVal = sanitizarEntero(anio, ANIO_MIN, ANIO_MAX) ?? 2026;
    const regionesPermitidas = obtenerRegionesPermitidasUsuario(request.usuarioActual);

    const pool = obtenerPoolActual();
    const tablaDetalle = obtenerTablaDetalleAt2(anioVal);
    const usaFlujoPorEstablecimiento = anioVal >= 2026;
    const vFormularioEstado = vFormularioPorAnio(anioVal);
    const condicionRegion = regionesPermitidas?.length
      ? ` AND us.C_REGION IN (${regionesPermitidas.map(() => "?").join(", ")})`
      : "";
    const condicionRegionHistorica = regionesPermitidas?.length
      ? ` AND CAST(C_US AS UNSIGNED) IN (${regionesPermitidas.map(() => "?").join(", ")})`
      : "";

    const [rows] = usaFlujoPorEstablecimiento
      ? await pool.query<RowDataPacket[]>(
          `SELECT
            us.C_REGION AS region,
            det.N_MES AS mes,
            COUNT(DISTINCT det.C_CONCEPTO) AS conceptos,
            SUM(det.Q_AT_ENFERMERA_AUX + det.Q_AT_ENFERMERA_PRO + det.Q_AT_MEDICO_GEN + det.Q_AT_MEDICO_ESP) AS total
	           FROM ${tablaDetalle} det
	           INNER JOIN BAS_BDR_US us
             ON CAST(us.C_US AS CHAR) COLLATE utf8mb4_unicode_ci = det.C_US COLLATE utf8mb4_unicode_ci
           WHERE det.N_ANIO = ?${condicionRegion}
           GROUP BY us.C_REGION, det.N_MES
           ORDER BY us.C_REGION, det.N_MES`,
          [anioVal, ...(regionesPermitidas ?? [])]
        )
      : await pool.query<RowDataPacket[]>(
          `SELECT
            CAST(C_US AS UNSIGNED) AS region,
            N_MES AS mes,
            COUNT(DISTINCT C_CONCEPTO) AS conceptos,
            SUM(Q_AT_ENFERMERA_AUX + Q_AT_ENFERMERA_PRO + Q_AT_MEDICO_GEN + Q_AT_MEDICO_ESP) AS total
	           FROM ${tablaDetalle}
	           WHERE N_ANIO = ? AND V_FORMULARIO = ?${condicionRegionHistorica}
           GROUP BY C_US, N_MES
           ORDER BY CAST(C_US AS UNSIGNED), N_MES`,
          [anioVal, vFormularioEstado, ...(regionesPermitidas ?? [])]
        );

    return reply.status(200).send({
      datos: rows,
      anio: anioVal,
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    if (error instanceof AlcanceRegionalError) {
      return reply.status(error.statusCode).send({
        codigo: error.codigo,
        mensaje: error.message
      });
    }
    logger.error("Error al obtener estado de registros", error);
    throw error;
  }
};
