import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { obtenerPoolActual } from "../base_datos/pool";
import { cache } from "../utilidades/cache.utilidad";
import { obtenerTablaDetalleAt2 } from "./at2-detalle-fuente.servicio";
import { REGION_CODE_TO_NAME } from "../utilidades/alcance-regional.util";

const TABLA_SEGUIMIENTO = "AT2_SEGUIMIENTO_ENVIO";
const NIVELES_HOSPITAL = [1, 2, 3];
const ESTADOS_VALIDOS = new Set(["no_enviado", "enviado", "revisado"]);
const SINCRONIZACION_TTL_MS = 5 * 60 * 1000;

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
  municipioCodigo: string;
  municipioNombre: string;
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

export type MatrizSeguimientoAnualRegion = Record<number, DetalleSeguimientoRegion>;

interface UpsertSeguimientoInput {
  anio: number;
  mes: number;
  regionCodigo: number;
  establecimientoRups: string;
  servicio: "general" | "consulta_externa" | "emergencia";
}

type EliminarSeguimientoInput = UpsertSeguimientoInput;

interface MarcarRevisionInput {
  id: number;
  reviewedByUserId: number;
  reviewedByNombre: string;
  observaciones?: string | null;
}

interface SeguimientoRow extends RowDataPacket {
  id: number | null;
  mes?: number;
  region_codigo: number;
  establecimiento_rups: string;
  establecimiento_nombre: string;
  municipio_codigo: string;
  municipio_nombre: string;
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
const sincronizacionesRecientes = new Map<string, number>();
const sincronizacionesPendientes = new Map<string, Promise<void>>();

const obtenerExecutor = (executor?: QueryExecutor) => executor ?? obtenerPoolActual();

const ejecutarSincronizacionConCache = async (clave: string, ejecutar: () => Promise<void>) => {
  const ahora = Date.now();
  const sincronizadaEn = sincronizacionesRecientes.get(clave);
  if (sincronizadaEn && ahora - sincronizadaEn < SINCRONIZACION_TTL_MS) {
    return;
  }

  const pendiente = sincronizacionesPendientes.get(clave);
  if (pendiente) {
    await pendiente;
    return;
  }

  const promesa = ejecutar()
    .then(() => {
      sincronizacionesRecientes.set(clave, Date.now());
    })
    .finally(() => {
      sincronizacionesPendientes.delete(clave);
    });

  sincronizacionesPendientes.set(clave, promesa);
  await promesa;
};

const asegurarIndice = async (
  db: QueryExecutor,
  tabla: string,
  indice: string,
  definicion: string
) => {
  const [rows] = await db.query<RowDataPacket[]>(
    `
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?
      LIMIT 1
    `,
    [tabla, indice]
  );

  if (rows.length > 0) {
    return;
  }

  await db.query(`ALTER TABLE ${tabla} ADD INDEX ${indice} ${definicion}`);
};

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
      CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO) AS municipio_codigo,
      COALESCE(muni.D_MUNICIPIO, CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO)) AS municipio_nombre,
      'general' AS servicio
    FROM BAS_BDR_US us
    LEFT JOIN BAS_BDR_MUNICIPIOS muni
      ON muni.C_DEPARTAMENTO = us.C_DEPARTAMENTO
      AND muni.C_MUNICIPIO = us.C_MUNICIPIO
    WHERE us.C_REGION BETWEEN 1 AND 20
      AND (us.C_NIVEL_US NOT IN (${NIVELES_HOSPITAL.join(",")}) OR us.C_NIVEL_US IS NULL)

    UNION ALL

    SELECT
      us.C_REGION AS region_codigo,
      CAST(us.C_US AS CHAR) AS establecimiento_rups,
      TRIM(us.D_US) AS establecimiento_nombre,
      CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO) AS municipio_codigo,
      COALESCE(muni.D_MUNICIPIO, CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO)) AS municipio_nombre,
      'consulta_externa' AS servicio
    FROM BAS_BDR_US us
    LEFT JOIN BAS_BDR_MUNICIPIOS muni
      ON muni.C_DEPARTAMENTO = us.C_DEPARTAMENTO
      AND muni.C_MUNICIPIO = us.C_MUNICIPIO
    WHERE us.C_REGION BETWEEN 1 AND 20
      AND us.C_NIVEL_US IN (${NIVELES_HOSPITAL.join(",")})

    UNION ALL

    SELECT
      us.C_REGION AS region_codigo,
      CAST(us.C_US AS CHAR) AS establecimiento_rups,
      TRIM(us.D_US) AS establecimiento_nombre,
      CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO) AS municipio_codigo,
      COALESCE(muni.D_MUNICIPIO, CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO)) AS municipio_nombre,
      'emergencia' AS servicio
    FROM BAS_BDR_US us
    LEFT JOIN BAS_BDR_MUNICIPIOS muni
      ON muni.C_DEPARTAMENTO = us.C_DEPARTAMENTO
      AND muni.C_MUNICIPIO = us.C_MUNICIPIO
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
        KEY idx_seguimiento_lookup_anual (anio, establecimiento_rups, servicio, mes),
        KEY idx_seguimiento_region_periodo (region_codigo, anio, mes),
        KEY idx_seguimiento_estado_periodo (estado, anio, mes)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await asegurarIndice(
      db,
      TABLA_SEGUIMIENTO,
      "idx_seguimiento_lookup_anual",
      "(anio, establecimiento_rups, servicio, mes)"
    );

    tablaAsegurada = true;
  }

  async registrarEnvio(input: UpsertSeguimientoInput, executor?: QueryExecutor) {
    await this.asegurarTabla(executor);
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
    cache.deleteByPrefix("reportes:");
  }

  async registrarEliminacion(input: EliminarSeguimientoInput, executor?: QueryExecutor) {
    await this.asegurarTabla(executor);
    const db = obtenerExecutor(executor);

    await db.query(
      `
        UPDATE ${TABLA_SEGUIMIENTO}
        SET
          region_codigo = ?,
          estado = 'no_enviado',
          fecha_envio = NULL,
          fecha_revision = NULL,
          revisado_por_user_id = NULL,
          revisado_por_nombre = NULL,
          observaciones = NULL
        WHERE anio = ?
          AND mes = ?
          AND establecimiento_rups = ?
          AND servicio = ?
      `,
      [
        input.regionCodigo,
        input.anio,
        input.mes,
        input.establecimientoRups,
        input.servicio
      ]
    );
    cache.deleteByPrefix("reportes:");
  }

  async sincronizarEnviosDesdeDetalle(anio: number, mes: number, executor?: QueryExecutor) {
    if (anio < 2026) return;

    await this.asegurarTabla(executor);
    const db = obtenerExecutor(executor);
    const tablaDetalle = obtenerTablaDetalleAt2(anio);

    await ejecutarSincronizacionConCache(
      `seguimiento:${anio}:${mes}`,
      async () => {
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
            SELECT
              ? AS anio,
              ? AS mes,
              us.C_REGION AS region_codigo,
              CAST(det.C_US AS CHAR) AS establecimiento_rups,
              CASE
                WHEN us.C_NIVEL_US IN (${NIVELES_HOSPITAL.join(",")})
                  THEN CASE WHEN det.C_SERVICIO = '2' THEN 'emergencia' ELSE 'consulta_externa' END
                ELSE 'general'
              END AS servicio,
              'enviado' AS estado,
              NOW() AS fecha_envio,
              NULL AS fecha_revision,
              NULL AS revisado_por_user_id,
              NULL AS revisado_por_nombre,
              NULL AS observaciones
            FROM ${tablaDetalle} det FORCE INDEX (idx_anio_mes)
            INNER JOIN BAS_BDR_US us
              ON CAST(us.C_US AS CHAR) COLLATE utf8mb4_unicode_ci = CAST(det.C_US AS CHAR) COLLATE utf8mb4_unicode_ci
            WHERE det.N_ANIO = ?
              AND det.N_MES = ?
              AND us.C_REGION BETWEEN 1 AND 20
            GROUP BY
              us.C_REGION,
              CAST(det.C_US AS CHAR),
              CASE
                WHEN us.C_NIVEL_US IN (${NIVELES_HOSPITAL.join(",")})
                  THEN CASE WHEN det.C_SERVICIO = '2' THEN 'emergencia' ELSE 'consulta_externa' END
                ELSE 'general'
              END
            HAVING SUM(
              COALESCE(det.Q_AT_ENFERMERA_AUX, 0) +
              COALESCE(det.Q_AT_ENFERMERA_PRO, 0) +
              COALESCE(det.Q_AT_MEDICO_GEN, 0) +
              COALESCE(det.Q_AT_MEDICO_ESP, 0)
            ) > 0
            ON DUPLICATE KEY UPDATE
              region_codigo = VALUES(region_codigo),
              estado = IF(estado = 'revisado', 'revisado', 'enviado'),
              fecha_envio = COALESCE(fecha_envio, VALUES(fecha_envio))
          `,
          [anio, mes, anio, mes]
        );
      }
    );
  }

  async sincronizarEnviosDesdeDetalleAnual(anio: number, executor?: QueryExecutor) {
    if (anio < 2026) return;

    await this.asegurarTabla(executor);
    const db = obtenerExecutor(executor);
    const tablaDetalle = obtenerTablaDetalleAt2(anio);

    await ejecutarSincronizacionConCache(
      `seguimiento:${anio}:anual`,
      async () => {
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
        SELECT
          ? AS anio,
          det.N_MES AS mes,
          us.C_REGION AS region_codigo,
          CAST(det.C_US AS CHAR) AS establecimiento_rups,
          CASE
            WHEN us.C_NIVEL_US IN (${NIVELES_HOSPITAL.join(",")})
              THEN CASE WHEN det.C_SERVICIO = '2' THEN 'emergencia' ELSE 'consulta_externa' END
            ELSE 'general'
          END AS servicio,
          'enviado' AS estado,
          NOW() AS fecha_envio,
          NULL AS fecha_revision,
          NULL AS revisado_por_user_id,
          NULL AS revisado_por_nombre,
          NULL AS observaciones
        FROM ${tablaDetalle} det FORCE INDEX (idx_anio_mes)
        INNER JOIN BAS_BDR_US us
          ON CAST(us.C_US AS CHAR) COLLATE utf8mb4_unicode_ci = CAST(det.C_US AS CHAR) COLLATE utf8mb4_unicode_ci
        WHERE det.N_ANIO = ?
          AND det.N_MES BETWEEN 1 AND 12
          AND us.C_REGION BETWEEN 1 AND 20
        GROUP BY
          det.N_MES,
          us.C_REGION,
          CAST(det.C_US AS CHAR),
          CASE
            WHEN us.C_NIVEL_US IN (${NIVELES_HOSPITAL.join(",")})
              THEN CASE WHEN det.C_SERVICIO = '2' THEN 'emergencia' ELSE 'consulta_externa' END
            ELSE 'general'
          END
        HAVING SUM(
          COALESCE(det.Q_AT_ENFERMERA_AUX, 0) +
          COALESCE(det.Q_AT_ENFERMERA_PRO, 0) +
          COALESCE(det.Q_AT_MEDICO_GEN, 0) +
          COALESCE(det.Q_AT_MEDICO_ESP, 0)
        ) > 0
        ON DUPLICATE KEY UPDATE
          region_codigo = VALUES(region_codigo),
          estado = IF(estado = 'revisado', 'revisado', 'enviado'),
          fecha_envio = COALESCE(fecha_envio, VALUES(fecha_envio))
          `,
          [anio, anio]
        );
      }
    );
  }

  async obtenerResumen(anio: number, mes: number): Promise<ResumenSeguimientoRegion[]> {
    await this.asegurarTabla();
    await this.sincronizarEnviosDesdeDetalle(anio, mes);
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
    await this.sincronizarEnviosDesdeDetalle(anio, mes);
    const pool = obtenerPoolActual();

    const [rows] = await pool.query<SeguimientoRow[]>(
      `
        ${CTE_BASE_ESTABLECIMIENTOS}
        SELECT
          seg.id,
          base.region_codigo,
          base.establecimiento_rups,
          base.establecimiento_nombre,
          base.municipio_codigo,
          base.municipio_nombre,
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
        municipioCodigo: String(row.municipio_codigo ?? ""),
        municipioNombre: String(row.municipio_nombre ?? "Sin municipio"),
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

  async obtenerMatrizAnualRegion(anio: number, regionCodigo: number): Promise<MatrizSeguimientoAnualRegion> {
    await this.asegurarTabla();
    await this.sincronizarEnviosDesdeDetalleAnual(anio);
    const pool = obtenerPoolActual();

    const [rows] = await pool.query<SeguimientoRow[]>(
      `
        WITH meses AS (
          SELECT 1 AS mes UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
          UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8
          UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12
        ),
        base_establecimientos AS (
          SELECT
            us.C_REGION AS region_codigo,
            CAST(us.C_US AS CHAR) AS establecimiento_rups,
            TRIM(us.D_US) AS establecimiento_nombre,
            CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO) AS municipio_codigo,
            COALESCE(muni.D_MUNICIPIO, CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO)) AS municipio_nombre,
            'general' AS servicio
          FROM BAS_BDR_US us
          LEFT JOIN BAS_BDR_MUNICIPIOS muni
            ON muni.C_DEPARTAMENTO = us.C_DEPARTAMENTO
            AND muni.C_MUNICIPIO = us.C_MUNICIPIO
          WHERE us.C_REGION = ?
            AND (us.C_NIVEL_US NOT IN (${NIVELES_HOSPITAL.join(",")}) OR us.C_NIVEL_US IS NULL)

          UNION ALL

          SELECT
            us.C_REGION AS region_codigo,
            CAST(us.C_US AS CHAR) AS establecimiento_rups,
            TRIM(us.D_US) AS establecimiento_nombre,
            CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO) AS municipio_codigo,
            COALESCE(muni.D_MUNICIPIO, CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO)) AS municipio_nombre,
            'consulta_externa' AS servicio
          FROM BAS_BDR_US us
          LEFT JOIN BAS_BDR_MUNICIPIOS muni
            ON muni.C_DEPARTAMENTO = us.C_DEPARTAMENTO
            AND muni.C_MUNICIPIO = us.C_MUNICIPIO
          WHERE us.C_REGION = ?
            AND us.C_NIVEL_US IN (${NIVELES_HOSPITAL.join(",")})

          UNION ALL

          SELECT
            us.C_REGION AS region_codigo,
            CAST(us.C_US AS CHAR) AS establecimiento_rups,
            TRIM(us.D_US) AS establecimiento_nombre,
            CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO) AS municipio_codigo,
            COALESCE(muni.D_MUNICIPIO, CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO)) AS municipio_nombre,
            'emergencia' AS servicio
          FROM BAS_BDR_US us
          LEFT JOIN BAS_BDR_MUNICIPIOS muni
            ON muni.C_DEPARTAMENTO = us.C_DEPARTAMENTO
            AND muni.C_MUNICIPIO = us.C_MUNICIPIO
          WHERE us.C_REGION = ?
            AND us.C_NIVEL_US IN (${NIVELES_HOSPITAL.join(",")})
        )
        SELECT
          meses.mes,
          seg.id,
          base.region_codigo,
          base.establecimiento_rups,
          base.establecimiento_nombre,
          base.municipio_codigo,
          base.municipio_nombre,
          base.servicio,
          seg.estado,
          seg.fecha_envio,
          seg.fecha_revision,
          seg.revisado_por_nombre,
          seg.observaciones
        FROM meses
        CROSS JOIN base_establecimientos base
        LEFT JOIN ${TABLA_SEGUIMIENTO} seg
          ON seg.anio = ?
          AND seg.mes = meses.mes
          AND seg.establecimiento_rups COLLATE utf8mb4_unicode_ci = base.establecimiento_rups COLLATE utf8mb4_unicode_ci
          AND seg.servicio COLLATE utf8mb4_unicode_ci = base.servicio COLLATE utf8mb4_unicode_ci
        ORDER BY meses.mes, base.establecimiento_nombre, FIELD(base.servicio, 'general', 'consulta_externa', 'emergencia')
      `,
      [regionCodigo, regionCodigo, regionCodigo, anio]
    );

    const matriz: MatrizSeguimientoAnualRegion = {};
    for (let mes = 1; mes <= 12; mes += 1) {
      matriz[mes] = {
        region: {
          id: regionCodigo,
          nombre: REGION_CODE_TO_NAME[regionCodigo] ?? `Region ${regionCodigo}`,
          enviados: 0,
          pendientes: 0,
          revisados: 0,
          total: 0,
          estado: "no_enviado"
        },
        items: []
      };
    }

    rows.forEach((row) => {
      const mes = Number(row.mes ?? 0);
      const bucket = matriz[mes];
      if (!bucket) return;

      const servicio = row.servicio;
      const item: DetalleSeguimientoItem = {
        id: row.id ? Number(row.id) : null,
        establecimientoRups: String(row.establecimiento_rups),
        establecimientoNombre: String(row.establecimiento_nombre),
        municipioCodigo: String(row.municipio_codigo ?? ""),
        municipioNombre: String(row.municipio_nombre ?? "Sin municipio"),
        servicio,
        servicioEtiqueta: mapearServicioEtiqueta(servicio),
        estado: normalizarEstado(row.estado),
        fechaEnvio: normalizarFecha(row.fecha_envio),
        fechaRevision: normalizarFecha(row.fecha_revision),
        revisadoPor: row.revisado_por_nombre ?? null,
        observaciones: row.observaciones ?? null
      };

      bucket.items.push(item);
    });

    Object.values(matriz).forEach((detalle) => {
      const enviados = detalle.items.filter((item) => item.estado === "enviado" || item.estado === "revisado").length;
      const revisados = detalle.items.filter((item) => item.estado === "revisado").length;
      detalle.region = {
        ...detalle.region,
        enviados,
        pendientes: detalle.items.filter((item) => item.estado === "no_enviado").length,
        revisados,
        total: detalle.items.length,
        estado: construirEstadoResumen({
          total: detalle.items.length,
          enviados,
          revisados
        } as SeguimientoRow)
      };
    });

    return matriz;
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

    if (result.affectedRows > 0) {
      cache.deleteByPrefix("reportes:");
    }

    return result.affectedRows > 0;
  }
}

export const seguimientoServicio = new SeguimientoServicio();
