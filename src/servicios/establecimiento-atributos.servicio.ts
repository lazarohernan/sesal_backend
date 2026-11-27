import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { obtenerPoolActual } from "../base_datos/pool";

/**
 * Datos propios del sistema por establecimiento que no existen en el catálogo
 * BAS_BDR_US: población asignada, si está exento de reportar AT2R y si llena
 * el formulario de emergencia aunque no sea hospital.
 * Se guardan aparte para no tocar las tablas del catálogo histórico.
 */
export const TABLA_ATRIBUTOS_ESTABLECIMIENTO = "app_establecimiento_atributos";

/**
 * Condición SQL para excluir del total esperado a los establecimientos exentos.
 * `alias` es el alias de BAS_BDR_US en la consulta.
 */
export const condicionNoExento = (alias = "us") => `
  NOT EXISTS (
    SELECT 1 FROM ${TABLA_ATRIBUTOS_ESTABLECIMIENTO} attr_exento
    WHERE attr_exento.rups = CAST(${alias}.C_US AS CHAR) COLLATE utf8mb4_unicode_ci
      AND attr_exento.exento_reporte = 1
  )`;

/** Niveles de BAS_BDR_US que son hospitales (HB=1, HG=2, HESP=3). */
export const NIVELES_HOSPITAL = [1, 2, 3];

/**
 * Condición SQL: el establecimiento llena dos formularios AT2R (consulta externa
 * y emergencia). Aplica a los hospitales y a los establecimientos habilitados
 * desde el catálogo (por ejemplo, centros de las islas con turnos de emergencia).
 * `alias` es el alias de BAS_BDR_US en la consulta; si se omite se usan las
 * columnas sin prefijo (para CTEs que ya exponen C_US y C_NIVEL_US).
 */
export const condicionDosServicios = (alias: string | null = "us") => {
  const pref = alias ? `${alias}.` : "";
  return `(
    COALESCE(${pref}C_NIVEL_US, 0) IN (${NIVELES_HOSPITAL.join(",")})
    OR EXISTS (
      SELECT 1 FROM ${TABLA_ATRIBUTOS_ESTABLECIMIENTO} attr_emerg
      WHERE attr_emerg.rups = CAST(${pref}C_US AS CHAR) COLLATE utf8mb4_unicode_ci
        AND attr_emerg.habilita_emergencia = 1
    )
  )`;
};

/** Negación de `condicionDosServicios`: establecimientos con formulario general. */
export const condicionServicioGeneral = (alias: string | null = "us") =>
  `NOT ${condicionDosServicios(alias)}`;

export interface AtributosEstablecimiento {
  rups: string;
  poblacion: number | null;
  exentoReporte: boolean;
  motivoExencion: string | null;
  /** Llena también el formulario de emergencia aunque no sea hospital. */
  habilitaEmergencia: boolean;
  actualizadoPor: string | null;
  actualizadoEn: string | null;
}

interface AtributosRow extends RowDataPacket {
  rups: string;
  poblacion: number | null;
  exento_reporte: number;
  motivo_exencion: string | null;
  habilita_emergencia: number | null;
  actualizado_por: string | null;
  actualizado_en: Date | string | null;
}

let tablaAsegurada = false;

export const asegurarTablaAtributosEstablecimiento = async (executor?: Pool | PoolConnection) => {
  if (tablaAsegurada) return;
  const db = executor ?? obtenerPoolActual();
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${TABLA_ATRIBUTOS_ESTABLECIMIENTO} (
      rups VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
      poblacion INT UNSIGNED NULL,
      exento_reporte TINYINT(1) NOT NULL DEFAULT 0,
      motivo_exencion VARCHAR(255) NULL,
      habilita_emergencia TINYINT(1) NOT NULL DEFAULT 0,
      actualizado_por VARCHAR(160) NULL,
      actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (rups),
      KEY idx_exento (exento_reporte)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // Tablas creadas antes de este campo: agregarlo (cambio aditivo, default 0).
  const [columnas] = await db.query<RowDataPacket[]>(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'habilita_emergencia'
     LIMIT 1`,
    [TABLA_ATRIBUTOS_ESTABLECIMIENTO]
  );
  if (!columnas.length) {
    await db.query(
      `ALTER TABLE ${TABLA_ATRIBUTOS_ESTABLECIMIENTO}
       ADD COLUMN habilita_emergencia TINYINT(1) NOT NULL DEFAULT 0 AFTER motivo_exencion`
    );
  }
  tablaAsegurada = true;
};

const mapear = (row: AtributosRow): AtributosEstablecimiento => ({
  rups: String(row.rups),
  poblacion: row.poblacion === null || row.poblacion === undefined ? null : Number(row.poblacion),
  exentoReporte: Number(row.exento_reporte) === 1,
  motivoExencion: row.motivo_exencion ?? null,
  habilitaEmergencia: Number(row.habilita_emergencia ?? 0) === 1,
  actualizadoPor: row.actualizado_por ?? null,
  actualizadoEn: row.actualizado_en ? new Date(row.actualizado_en).toISOString() : null
});

export const establecimientoAtributosServicio = {
  async listar(): Promise<Map<string, AtributosEstablecimiento>> {
    await asegurarTablaAtributosEstablecimiento();
    const [rows] = await obtenerPoolActual().query<AtributosRow[]>(
      `SELECT * FROM ${TABLA_ATRIBUTOS_ESTABLECIMIENTO}`
    );
    return new Map(rows.map((row) => [String(row.rups), mapear(row)]));
  },

  async guardar(input: {
    rups: string;
    poblacion?: number | null;
    exentoReporte?: boolean;
    motivoExencion?: string | null;
    habilitaEmergencia?: boolean;
    actualizadoPor: string;
  }): Promise<void> {
    await asegurarTablaAtributosEstablecimiento();
    const campos: string[] = [];
    const valores: Array<string | number | null> = [];
    if (input.poblacion !== undefined) {
      campos.push("poblacion");
      valores.push(input.poblacion);
    }
    if (input.exentoReporte !== undefined) {
      campos.push("exento_reporte");
      valores.push(input.exentoReporte ? 1 : 0);
    }
    if (input.motivoExencion !== undefined) {
      campos.push("motivo_exencion");
      valores.push(input.motivoExencion?.trim() ? input.motivoExencion.trim().slice(0, 255) : null);
    }
    if (input.habilitaEmergencia !== undefined) {
      campos.push("habilita_emergencia");
      valores.push(input.habilitaEmergencia ? 1 : 0);
    }
    if (!campos.length) return;
    campos.push("actualizado_por");
    valores.push(input.actualizadoPor.slice(0, 160));

    await obtenerPoolActual().query<ResultSetHeader>(
      `INSERT INTO ${TABLA_ATRIBUTOS_ESTABLECIMIENTO} (rups, ${campos.join(", ")})
       VALUES (?, ${campos.map(() => "?").join(", ")})
       ON DUPLICATE KEY UPDATE ${campos.map((campo) => `${campo} = VALUES(${campo})`).join(", ")}`,
      [input.rups, ...valores]
    );
  },

  /**
   * Carga masiva de población identificando cada establecimiento por RUPS.
   * Devuelve cuántos se actualizaron y qué RUPS no existen en el catálogo.
   */
  async cargarPoblacion(
    filas: Array<{ rups: string; poblacion: number }>,
    actualizadoPor: string
  ): Promise<{ actualizados: number; noEncontrados: string[] }> {
    await asegurarTablaAtributosEstablecimiento();
    if (!filas.length) return { actualizados: 0, noEncontrados: [] };

    const pool = obtenerPoolActual();
    const rupsUnicos = [...new Set(filas.map((fila) => fila.rups))];
    const [existentes] = await pool.query<RowDataPacket[]>(
      `SELECT DISTINCT CAST(C_US AS CHAR) AS rups FROM BAS_BDR_US
       WHERE CAST(C_US AS CHAR) IN (${rupsUnicos.map(() => "?").join(", ")})`,
      rupsUnicos
    );
    const validos = new Set(existentes.map((row) => String(row.rups)));
    const noEncontrados = rupsUnicos.filter((rups) => !validos.has(rups));
    const aGuardar = filas.filter((fila) => validos.has(fila.rups));
    if (!aGuardar.length) return { actualizados: 0, noEncontrados };

    const conexion = await pool.getConnection();
    try {
      await conexion.beginTransaction();
      for (let i = 0; i < aGuardar.length; i += 500) {
        const lote = aGuardar.slice(i, i + 500);
        await conexion.query(
          `INSERT INTO ${TABLA_ATRIBUTOS_ESTABLECIMIENTO} (rups, poblacion, actualizado_por)
           VALUES ${lote.map(() => "(?, ?, ?)").join(", ")}
           ON DUPLICATE KEY UPDATE poblacion = VALUES(poblacion), actualizado_por = VALUES(actualizado_por)`,
          lote.flatMap((fila) => [fila.rups, fila.poblacion, actualizadoPor.slice(0, 160)])
        );
      }
      await conexion.commit();
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }

    return { actualizados: new Set(aGuardar.map((fila) => fila.rups)).size, noEncontrados };
  }
};
