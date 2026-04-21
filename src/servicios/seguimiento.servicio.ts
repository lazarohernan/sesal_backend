import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { obtenerPoolActual } from "../base_datos/pool";
import { REGION_CODE_TO_NAME } from "../utilidades/alcance-regional.util";

const TABLA_SEGUIMIENTO = "AT2_SEGUIMIENTO_ENVIO";
const NIVELES_HOSPITAL = [1, 2, 3];
const ESTADOS_VALIDOS = new Set(["no_enviado", "enviado", "revisado"]);

type QueryExecutor = Pool | PoolConnection;

export type EstadoSeguimiento = "no_enviado" | "enviado" | "revisado";

export interface ResumenSeguimientoRegion {
  id: number;
  nombre: string;
  enviados: number;
  pendientes: number;
  revisados: number;
  total: number;
  estado: EstadoSeguimiento;
}

export interface DetalleSeguimientoItem {
  id: number | null;
  establecimientoRups: string;
  establecimientoNombre: string;
  servicio: "general" | "consulta_externa" | "emergencia";
  servicioEtiqueta: string;
  estado: EstadoSeguimiento;
  fechaEnvio: string | null;
  fechaRevision: string | null;
  revisadoPor: string | null;
  observaciones: string | null;
}

export interface DetalleSeguimientoRegion {
  region: ResumenSeguimientoRegion;
  items: DetalleSeguimientoItem[];
}

interface UpsertSeguimientoInput {
  anio: number;
  mes: number;
  regionCodigo: number;
  establecimientoRups: string;
  servicio: "general" | "consulta_externa" | "emergencia";
}

interface MarcarRevisionInput {
  id: number;
  reviewedByUserId: number;
  reviewedByNombre: string;
  observaciones?: string | null;
}

interface SeguimientoRow extends RowDataPacket {
  id: number | null;
  region_codigo: number;
  establecimiento_rups: string;
  establecimiento_nombre: string;
  servicio: "general" | "consulta_externa" | "emergencia";
  estado: EstadoSeguimiento | null;
  fecha_envio: Date | string | null;
  fecha_revision: Date | string | null;
  revisado_por_nombre: string | null;
  observaciones: string | null;
  enviados: number;
  pendientes: number;
  revisados: number;
  total: number;
}

let tablaAsegurada = false;

const obtenerExecutor = (executor?: QueryExecutor) => executor ?? obtenerPoolActual();

const normalizarEstado = (valor: unknown): EstadoSeguimiento => {
  const estado = typeof valor === "string" ? valor : "";
  return ESTADOS_VALIDOS.has(estado) ? (estado as EstadoSeguimiento) : "no_enviado";
};

const normalizarFecha = (valor: Date | string | null) => {
  if (!valor) {
    return null;
  }

  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
};

const construirEstadoResumen = (row: Pick<SeguimientoRow, "total" | "enviados" | "revisados">): EstadoSeguimiento => {
  if (row.total > 0 && row.revisados >= row.total) {
    return "revisado";
  }
  if (row.enviados > 0) {
    return "enviado";
  }
  return "no_enviado";
};

const mapearServicioEtiqueta = (servicio: "general" | "consulta_externa" | "emergencia") => {
  if (servicio === "consulta_externa") return "Consulta externa";
  if (servicio === "emergencia") return "Emergencia";
  return "Registro unico";
};

const CTE_BASE_ESTABLECIMIENTOS = `
  WITH base_establecimientos AS (
    SELECT
      us.C_REGION AS region_codigo,
      CAST(us.C_US AS CHAR) AS establecimiento_rups,
      TRIM(us.D_US) AS establecimiento_nombre,
      'general' AS servicio
    FROM BAS_BDR_US us
    WHERE us.C_REGION BETWEEN 1 AND 20
      AND (us.C_NIVEL_US NOT IN (${NIVELES_HOSPITAL.join(",")}) OR us.C_NIVEL_US IS NULL)

    UNION ALL

    SELECT
      us.C_REGION AS region_codigo,
      CAST(us.C_US AS CHAR) AS establecimiento_rups,
      TRIM(us.D_US) AS establecimiento_nombre,
      'consulta_externa' AS servicio
    FROM BAS_BDR_US us
    WHERE us.C_REGION BETWEEN 1 AND 20
      AND us.C_NIVEL_US IN (${NIVELES_HOSPITAL.join(",")})

    UNION ALL

    SELECT
      us.C_REGION AS region_codigo,
      CAST(us.C_US AS CHAR) AS establecimiento_rups,
      TRIM(us.D_US) AS establecimiento_nombre,
      'emergencia' AS servicio
    FROM BAS_BDR_US us
    WHERE us.C_REGION BETWEEN 1 AND 20
      AND us.C_NIVEL_US IN (${NIVELES_HOSPITAL.join(",")})
  )
`;

export class SeguimientoServicio {
  async asegurarTabla(executor?: QueryExecutor) {
    if (tablaAsegurada) {
      return;
    }

    const db = obtenerExecutor(executor);
    await db.query(`
      CREATE TABLE IF NOT EXISTS ${TABLA_SEGUIMIENTO} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        anio SMALLINT NOT NULL,
        mes TINYINT UNSIGNED NOT NULL,
        region_codigo TINYINT UNSIGNED NOT NULL,
        establecimiento_rups VARCHAR(32) NOT NULL,
        servicio VARCHAR(24) NOT NULL,
        estado VARCHAR(24) NOT NULL DEFAULT 'enviado',
        fecha_envio DATETIME NULL,
        fecha_revision DATETIME NULL,
        revisado_por_user_id BIGINT UNSIGNED NULL,
        revisado_por_nombre VARCHAR(180) NULL,
        observaciones VARCHAR(500) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_seguimiento_periodo_establecimiento (anio, mes, establecimiento_rups, servicio),
        KEY idx_seguimiento_region_periodo (region_codigo, anio, mes),
        KEY idx_seguimiento_estado_periodo (estado, anio, mes)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    tablaAsegurada = true;
  }

  async registrarEnvio(input: UpsertSeguimientoInput, executor?: QueryExecutor) {
    await this.asegurarTabla();
    const db = obtenerExecutor(executor);

    await db.query(
      `
        INSERT INTO ${TABLA_SEGUIMIENTO} (
          anio,
          mes,
          region_codigo,
          establecimiento_rups,
          servicio,
          estado,
          fecha_envio,
          fecha_revision,
          revisado_por_user_id,
          revisado_por_nombre,
          observaciones
        )
        VALUES (?, ?, ?, ?, ?, 'enviado', NOW(), NULL, NULL, NULL, NULL)
        ON DUPLICATE KEY UPDATE
          region_codigo = VALUES(region_codigo),
          estado = 'enviado',
          fecha_envio = NOW(),
          fecha_revision = NULL,
          revisado_por_user_id = NULL,
          revisado_por_nombre = NULL,
          observaciones = NULL
      `,
      [
        input.anio,
        input.mes,
        input.regionCodigo,
        input.establecimientoRups,
        input.servicio
      ]
    );
  }

  async obtenerResumen(anio: number, mes: number): Promise<ResumenSeguimientoRegion[]> {
    await this.asegurarTabla();
    const pool = obtenerPoolActual();

    const [rows] = await pool.query<SeguimientoRow[]>(
      `
        ${CTE_BASE_ESTABLECIMIENTOS}
        SELECT
          base.region_codigo,
          SUM(CASE WHEN seg.id IS NOT NULL AND seg.estado IN ('enviado', 'revisado') THEN 1 ELSE 0 END) AS enviados,
          SUM(CASE WHEN seg.id IS NULL OR seg.estado = 'no_enviado' THEN 1 ELSE 0 END) AS pendientes,
          SUM(CASE WHEN seg.estado = 'revisado' THEN 1 ELSE 0 END) AS revisados,
          COUNT(*) AS total
        FROM base_establecimientos base
        LEFT JOIN ${TABLA_SEGUIMIENTO} seg
          ON seg.anio = ?
          AND seg.mes = ?
          AND seg.establecimiento_rups COLLATE utf8mb4_unicode_ci = base.establecimiento_rups COLLATE utf8mb4_unicode_ci
          AND seg.servicio COLLATE utf8mb4_unicode_ci = base.servicio COLLATE utf8mb4_unicode_ci
        GROUP BY base.region_codigo
        ORDER BY base.region_codigo
      `,
      [anio, mes]
    );

    return rows.map((row) => ({
      id: Number(row.region_codigo),
      nombre: REGION_CODE_TO_NAME[Number(row.region_codigo)] ?? `Region ${row.region_codigo}`,
      enviados: Number(row.enviados ?? 0),
      pendientes: Number(row.pendientes ?? 0),
      revisados: Number(row.revisados ?? 0),
      total: Number(row.total ?? 0),
      estado: construirEstadoResumen(row)
    }));
  }

  async obtenerDetalleRegion(anio: number, mes: number, regionCodigo: number): Promise<DetalleSeguimientoRegion> {
    await this.asegurarTabla();
    const pool = obtenerPoolActual();

    const [rows] = await pool.query<SeguimientoRow[]>(
      `
        ${CTE_BASE_ESTABLECIMIENTOS}
        SELECT
          seg.id,
          base.region_codigo,
          base.establecimiento_rups,
          base.establecimiento_nombre,
          base.servicio,
          seg.estado,
          seg.fecha_envio,
          seg.fecha_revision,
          seg.revisado_por_nombre,
          seg.observaciones
        FROM base_establecimientos base
        LEFT JOIN ${TABLA_SEGUIMIENTO} seg
          ON seg.anio = ?
          AND seg.mes = ?
          AND seg.establecimiento_rups COLLATE utf8mb4_unicode_ci = base.establecimiento_rups COLLATE utf8mb4_unicode_ci
          AND seg.servicio COLLATE utf8mb4_unicode_ci = base.servicio COLLATE utf8mb4_unicode_ci
        WHERE base.region_codigo = ?
        ORDER BY base.establecimiento_nombre, FIELD(base.servicio, 'general', 'consulta_externa', 'emergencia')
      `,
      [anio, mes, regionCodigo]
    );

    const items: DetalleSeguimientoItem[] = rows.map((row) => {
      const servicio = row.servicio;
      return {
        id: row.id ? Number(row.id) : null,
        establecimientoRups: String(row.establecimiento_rups),
        establecimientoNombre: String(row.establecimiento_nombre),
        servicio,
        servicioEtiqueta: mapearServicioEtiqueta(servicio),
        estado: normalizarEstado(row.estado),
        fechaEnvio: normalizarFecha(row.fecha_envio),
        fechaRevision: normalizarFecha(row.fecha_revision),
        revisadoPor: row.revisado_por_nombre ?? null,
        observaciones: row.observaciones ?? null
      };
    });

    const region: ResumenSeguimientoRegion = {
      id: regionCodigo,
      nombre: REGION_CODE_TO_NAME[regionCodigo] ?? `Region ${regionCodigo}`,
      enviados: items.filter((item) => item.estado === "enviado" || item.estado === "revisado").length,
      pendientes: items.filter((item) => item.estado === "no_enviado").length,
      revisados: items.filter((item) => item.estado === "revisado").length,
      total: items.length,
      estado: construirEstadoResumen({
        total: items.length,
        enviados: items.filter((item) => item.estado === "enviado" || item.estado === "revisado").length,
        revisados: items.filter((item) => item.estado === "revisado").length
      } as SeguimientoRow)
    };

    return { region, items };
  }

  async marcarRevisado(input: MarcarRevisionInput) {
    await this.asegurarTabla();
    const pool = obtenerPoolActual();

    const [result] = await pool.query<ResultSetHeader>(
      `
        UPDATE ${TABLA_SEGUIMIENTO}
        SET
          estado = 'revisado',
          fecha_revision = NOW(),
          revisado_por_user_id = ?,
          revisado_por_nombre = ?,
          observaciones = ?
        WHERE id = ?
      `,
      [
        input.reviewedByUserId,
        input.reviewedByNombre,
        input.observaciones?.trim() || null,
        input.id
      ]
    );

    return result.affectedRows > 0;
  }
}

export const seguimientoServicio = new SeguimientoServicio();
