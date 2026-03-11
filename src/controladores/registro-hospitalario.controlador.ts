import type { FastifyRequest, FastifyReply } from "fastify";
import type { RowDataPacket } from "mysql2";
import { obtenerPoolActual } from "../base_datos/pool";
import { logger } from "../utilidades/registro.utilidad";

// -- Validacion y sanitizacion --

const REGION_MIN = 1;
const REGION_MAX = 20;
const MES_MIN = 1;
const MES_MAX = 12;
const ANIO_MIN = 2025;
const ANIO_MAX = 2099;
const CONCEPTO_MIN = 1;
const CONCEPTO_MAX = 92;
const VALOR_MAX = 999999;

const TABLA_DETALLE = "AT2_DETALLE";

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

// -- POST /api/registro-hospitalario --

export const guardarRegistroControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const { region, anio, mes, registros } = request.body as any;

    // Validar campos requeridos
    const regionVal = sanitizarEntero(region, REGION_MIN, REGION_MAX);
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

    if (!Array.isArray(registros) || registros.length === 0 || registros.length > CONCEPTO_MAX) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: `El campo 'registros' debe ser un array de 1 a ${CONCEPTO_MAX} elementos`
      });
    }

    // Sanitizar cada registro
    const filas: Array<[string, number, number, string, string, null, string, number, number, number, number]> = [];
    const conceptosVistos = new Set<number>();

    for (const registro of registros) {
      const concepto = sanitizarEntero(registro.concepto, CONCEPTO_MIN, CONCEPTO_MAX);
      if (concepto === null) {
        return reply.status(400).send({
          codigo: "PARAMETRO_INVALIDO",
          mensaje: `Concepto inválido: debe ser entre ${CONCEPTO_MIN} y ${CONCEPTO_MAX}`
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

      // Solo insertar si tiene al menos un valor > 0
      if (enfermeraAux + enfermeraPro + medicoGen + medicoEsp > 0) {
        filas.push([
          String(regionVal),   // C_US (región como código de US)
          anioVal,             // N_ANIO
          mesVal,              // N_MES
          "1",                 // C_SERVICIO
          String(concepto),    // C_CONCEPTO
          null,                // V_US
          "3",                 // V_FORMULARIO (3 = AT2-R registro)
          enfermeraAux,
          enfermeraPro,
          medicoGen,
          medicoEsp
        ]);
      }
    }

    if (filas.length === 0) {
      return reply.status(400).send({
        codigo: "SIN_DATOS",
        mensaje: "No se encontraron valores numéricos para guardar"
      });
    }

    const pool = obtenerPoolActual();

    // Transacción: borrar datos previos de esta región/año/mes (formulario 3) e insertar nuevos
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        `DELETE FROM ${TABLA_DETALLE} WHERE C_US = ? AND N_ANIO = ? AND N_MES = ? AND V_FORMULARIO = '3'`,
        [String(regionVal), anioVal, mesVal]
      );

      const sql = `
        INSERT INTO ${TABLA_DETALLE} (C_US, N_ANIO, N_MES, C_SERVICIO, C_CONCEPTO, V_US, V_FORMULARIO, Q_AT_ENFERMERA_AUX, Q_AT_ENFERMERA_PRO, Q_AT_MEDICO_GEN, Q_AT_MEDICO_ESP)
        VALUES ?
      `;

      const [resultado] = await conn.query(sql, [filas]);
      await conn.commit();

      const info = resultado as { affectedRows: number };
      logger.info(`Registro hospitalario guardado: región=${regionVal}, ${mesVal}/${anioVal}, ${filas.length} conceptos, ${info.affectedRows} filas afectadas`);

      return reply.status(200).send({
        mensaje: "Registro guardado correctamente",
        datos: {
          region: regionVal,
          anio: anioVal,
          mes: mesVal,
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
    logger.error("Error al guardar registro hospitalario", error);
    throw error;
  }
};

// -- GET /api/registro-hospitalario --

export const obtenerRegistroControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const { region, anio, mes } = request.query as Record<string, string | undefined>;

    const regionVal = sanitizarEntero(region, REGION_MIN, REGION_MAX);
    const anioVal = sanitizarEntero(anio, ANIO_MIN, ANIO_MAX);
    const mesVal = sanitizarEntero(mes, MES_MIN, MES_MAX);

    if (regionVal === null || anioVal === null || mesVal === null) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "Se requieren los parámetros 'region' (1-20), 'anio' (2025+) y 'mes' (1-12)"
      });
    }

    const pool = obtenerPoolActual();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
        CAST(C_CONCEPTO AS UNSIGNED) AS concepto,
        Q_AT_ENFERMERA_AUX AS enfermera_aux,
        Q_AT_ENFERMERA_PRO AS enfermera_pro,
        Q_AT_MEDICO_GEN AS medico_gen,
        Q_AT_MEDICO_ESP AS medico_esp
       FROM ${TABLA_DETALLE}
       WHERE C_US = ? AND N_ANIO = ? AND N_MES = ? AND V_FORMULARIO = '3'
       ORDER BY CAST(C_CONCEPTO AS UNSIGNED)`,
      [String(regionVal), anioVal, mesVal]
    );

    return reply.status(200).send({
      datos: rows,
      region: regionVal,
      anio: anioVal,
      mes: mesVal,
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    logger.error("Error al obtener registro hospitalario", error);
    throw error;
  }
};

// -- GET /api/registro-hospitalario/estado --

export const obtenerEstadoRegistrosControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const { anio } = request.query as Record<string, string | undefined>;
    const anioVal = sanitizarEntero(anio, ANIO_MIN, ANIO_MAX) ?? 2026;

    const pool = obtenerPoolActual();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
        CAST(C_US AS UNSIGNED) AS region,
        N_MES AS mes,
        COUNT(DISTINCT C_CONCEPTO) AS conceptos,
        SUM(Q_AT_ENFERMERA_AUX + Q_AT_ENFERMERA_PRO + Q_AT_MEDICO_GEN + Q_AT_MEDICO_ESP) AS total
       FROM ${TABLA_DETALLE}
       WHERE N_ANIO = ? AND V_FORMULARIO = '3'
       GROUP BY C_US, N_MES
       ORDER BY CAST(C_US AS UNSIGNED), N_MES`,
      [anioVal]
    );

    return reply.status(200).send({
      datos: rows,
      anio: anioVal,
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    logger.error("Error al obtener estado de registros", error);
    throw error;
  }
};
