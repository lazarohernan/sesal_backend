import type { RowDataPacket } from "mysql2";

import { obtenerPoolActual } from "../base_datos/pool";
import { cache, CACHE_TTL } from "../utilidades/cache.utilidad";

export interface EgresosDepartamentoDato {
  departamentoId: number;
  nombre: string;
  totalHistorico: number;
  total2025: number;
  total2024: number;
  total2023: number;
  totalUnidades: number;
}

export interface EgresosIndicadoresDepartamentoParams {
  departamentoId: number;
  regionIds?: number[];
  anio?: number;
}

export interface EgresosIndicadoresDepartamento {
  totalEgresos: number;
  diasEstancia: number;
  totalDiagnosticos: number;
  totalOperaciones: number;
  totalPartos: number;
  totalUnidades: number;
}

export interface EgresosIndicadoresTableroParams {
  regionIds?: number[];
  anio?: number;
  departamentoId?: number;
}

export interface EgresosIndicadoresTablero {
  resumen: {
    totalEgresos: number;
    estanciaPromedio: number;
    totalDiagnosticos: number;
    totalOperaciones: number;
    totalPartos: number;
    referidos: number;
  };
  distribucionSexo: Array<{
    codigo: number | null;
    etiqueta: string;
    totalEgresos: number;
  }>;
  distribucionEdades: Array<{
    etiqueta: string;
    totalEgresos: number;
  }>;
  ritmoMensual: Array<{
    mes: number;
    totalEgresos: number;
    totalOperaciones: number;
    totalPartos: number;
    estanciaPromedio: number;
  }>;
  establecimientosDestacados: Array<{
    establecimientoId: number;
    etiqueta: string;
    totalEgresos: number;
    estanciaPromedio: number;
    totalOperaciones: number;
  }>;
}

const TABLA_GENERAL = "EHO_BDT_EGR_GENERAL";
const TABLA_DIAGNOSTICOS = "EHO_BDT_EGR_DIAGNOSTICOS";
const TABLA_OPERACIONES = "EHO_BDT_EGR_OPERACIONES";
const TABLA_PARTOS = "EHO_BDT_EGR_PARTOS";
const TABLA_US = "BAS_BDR_US";
const TABLA_DEPARTAMENTOS = "BAS_BDR_DEPARTAMENTOS";

const construirFiltroUbicacion = (params: EgresosIndicadoresDepartamentoParams) => {
  const whereParts = ["us.C_DEPARTAMENTO = ?"];
  const values: number[] = [params.departamentoId];

  if (params.regionIds?.length) {
    whereParts.push(`us.C_REGION IN (${params.regionIds.map(() => "?").join(", ")})`);
    values.push(...params.regionIds);
  }

  if (params.anio !== undefined) {
    whereParts.push("base.N_ANIO = ?");
    values.push(params.anio);
  }

  return {
    clause: whereParts.join(" AND "),
    values,
  };
};

const SEXO_LABELS: Record<number, string> = {
  1: "Hombre",
  2: "Mujer",
  9: "Desconocido",
};

const construirFiltroTablero = (
  params: EgresosIndicadoresTableroParams,
  alias = "g"
): { clause: string; values: number[] } => {
  const whereParts: string[] = [];
  const values: number[] = [];

  if (params.anio !== undefined) {
    whereParts.push(`${alias}.N_ANIO = ?`);
    values.push(params.anio);
  }

  const filtrosUs: string[] = [];
  if (params.departamentoId !== undefined) {
    filtrosUs.push("us_scope.C_DEPARTAMENTO = ?");
    values.push(params.departamentoId);
  }

  if (params.regionIds?.length) {
    filtrosUs.push(`us_scope.C_REGION IN (${params.regionIds.map(() => "?").join(", ")})`);
    values.push(...params.regionIds);
  }

  if (filtrosUs.length) {
    whereParts.push(`
      EXISTS (
        SELECT 1
        FROM ${TABLA_US} us_scope
        WHERE us_scope.C_US = ${alias}.C_US
          AND ${filtrosUs.join(" AND ")}
      )
    `);
  }

  return {
    clause: whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "",
    values,
  };
};

const construirCacheKeyTablero = (params: EgresosIndicadoresTableroParams) =>
  `egresos-tablero:indicadores-v2:${params.regionIds?.join(",") ?? "all"}:${params.departamentoId ?? "hn"}:${params.anio ?? "all"}`;

export const obtenerAniosEgresosTablero = async (): Promise<number[]> => {
  return cache.getOrSet(
    "egresos-tablero:anios",
    async () => {
      const pool = obtenerPoolActual();
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT DISTINCT N_ANIO AS anio
         FROM ${TABLA_GENERAL}
         ORDER BY N_ANIO DESC`
      );

      return rows
        .map((row) => Number(row.anio))
        .filter((anio) => Number.isInteger(anio));
    },
    CACHE_TTL.ANIOS_DISPONIBLES
  );
};

export const obtenerDatosMapaHondurasEgresos = async (regionIds?: number[] | null): Promise<EgresosDepartamentoDato[]> => {
  if (regionIds?.length) {
    const pool = obtenerPoolActual();
    const placeholders = regionIds.map(() => "?").join(", ");
    const [rows] = await pool.query<RowDataPacket[]>(
      `
        SELECT
          us.C_DEPARTAMENTO AS departamentoId,
          dep.D_DEPARTAMENTO AS nombre,
          COUNT(*) AS totalHistorico,
          SUM(CASE WHEN g.N_ANIO = 2025 THEN 1 ELSE 0 END) AS total2025,
          SUM(CASE WHEN g.N_ANIO = 2024 THEN 1 ELSE 0 END) AS total2024,
          SUM(CASE WHEN g.N_ANIO = 2023 THEN 1 ELSE 0 END) AS total2023,
          COUNT(DISTINCT g.C_US) AS totalUnidades
        FROM ${TABLA_GENERAL} g
        INNER JOIN ${TABLA_US} us
          ON us.C_US = g.C_US
        INNER JOIN ${TABLA_DEPARTAMENTOS} dep
          ON dep.C_DEPARTAMENTO = us.C_DEPARTAMENTO
        WHERE us.C_REGION IN (${placeholders})
        GROUP BY us.C_DEPARTAMENTO, dep.D_DEPARTAMENTO
        ORDER BY us.C_DEPARTAMENTO
      `,
      [...regionIds]
    );

    return rows.map((row) => ({
      departamentoId: Number(row.departamentoId),
      nombre: String(row.nombre),
      totalHistorico: Number(row.totalHistorico ?? 0),
      total2025: Number(row.total2025 ?? 0),
      total2024: Number(row.total2024 ?? 0),
      total2023: Number(row.total2023 ?? 0),
      totalUnidades: Number(row.totalUnidades ?? 0),
    }));
  }

  return cache.getOrSet(
    "egresos-tablero:mapa",
    async () => {
      const pool = obtenerPoolActual();
      const [rows] = await pool.query<RowDataPacket[]>(
        `
          SELECT
            dep.C_DEPARTAMENTO AS departamentoId,
            dep.D_DEPARTAMENTO AS nombre,
            COALESCE(hist.totalHistorico, 0) AS totalHistorico,
            COALESCE(y2025.total2025, 0) AS total2025,
            COALESCE(y2024.total2024, 0) AS total2024,
            COALESCE(y2023.total2023, 0) AS total2023,
            COALESCE(hist.totalUnidades, 0) AS totalUnidades
          FROM ${TABLA_DEPARTAMENTOS} dep
          LEFT JOIN (
            SELECT
              us.C_DEPARTAMENTO,
              COUNT(*) AS totalHistorico,
              COUNT(DISTINCT g.C_US) AS totalUnidades
            FROM ${TABLA_GENERAL} g
            INNER JOIN ${TABLA_US} us
              ON us.C_US = g.C_US
            GROUP BY us.C_DEPARTAMENTO
          ) hist
            ON hist.C_DEPARTAMENTO = dep.C_DEPARTAMENTO
          LEFT JOIN (
            SELECT
              us.C_DEPARTAMENTO,
              COUNT(*) AS total2025
            FROM ${TABLA_GENERAL} g
            INNER JOIN ${TABLA_US} us
              ON us.C_US = g.C_US
            WHERE g.N_ANIO = 2025
            GROUP BY us.C_DEPARTAMENTO
          ) y2025
            ON y2025.C_DEPARTAMENTO = dep.C_DEPARTAMENTO
          LEFT JOIN (
            SELECT
              us.C_DEPARTAMENTO,
              COUNT(*) AS total2024
            FROM ${TABLA_GENERAL} g
            INNER JOIN ${TABLA_US} us
              ON us.C_US = g.C_US
            WHERE g.N_ANIO = 2024
            GROUP BY us.C_DEPARTAMENTO
          ) y2024
            ON y2024.C_DEPARTAMENTO = dep.C_DEPARTAMENTO
          LEFT JOIN (
            SELECT
              us.C_DEPARTAMENTO,
              COUNT(*) AS total2023
            FROM ${TABLA_GENERAL} g
            INNER JOIN ${TABLA_US} us
              ON us.C_US = g.C_US
            WHERE g.N_ANIO = 2023
            GROUP BY us.C_DEPARTAMENTO
          ) y2023
            ON y2023.C_DEPARTAMENTO = dep.C_DEPARTAMENTO
          WHERE dep.C_DEPARTAMENTO BETWEEN 1 AND 18
          ORDER BY dep.C_DEPARTAMENTO
        `
      );

      return rows.map((row) => ({
        departamentoId: Number(row.departamentoId),
        nombre: String(row.nombre),
        totalHistorico: Number(row.totalHistorico ?? 0),
        total2025: Number(row.total2025 ?? 0),
        total2024: Number(row.total2024 ?? 0),
        total2023: Number(row.total2023 ?? 0),
        totalUnidades: Number(row.totalUnidades ?? 0),
      }));
    },
    CACHE_TTL.DATOS_MAPA
  );
};

export const obtenerIndicadoresTableroEgresos = async (
  params: EgresosIndicadoresTableroParams
): Promise<EgresosIndicadoresTablero> => {
  const cacheKey = construirCacheKeyTablero(params);

  return cache.getOrSet(
    cacheKey,
    async () => {
      const pool = obtenerPoolActual();
      const filtroGeneral = construirFiltroTablero(params, "g");
      const filtroDiagnosticos = construirFiltroTablero(params, "d");
      const filtroOperaciones = construirFiltroTablero(params, "o");
      const filtroPartos = construirFiltroTablero(params, "p");

      const resumenSql = `
        SELECT
          (
            SELECT COUNT(*)
            FROM ${TABLA_GENERAL} g
            ${filtroGeneral.clause}
          ) AS totalEgresos,
          (
            SELECT ROUND(AVG(COALESCE(g.Q_DIAS_ESTANCIA, 0)), 2)
            FROM ${TABLA_GENERAL} g
            ${filtroGeneral.clause}
          ) AS estanciaPromedio,
          (
            SELECT COUNT(*)
            FROM ${TABLA_DIAGNOSTICOS} d
            ${filtroDiagnosticos.clause}
          ) AS totalDiagnosticos,
          (
            SELECT COUNT(*)
            FROM ${TABLA_OPERACIONES} o
            ${filtroOperaciones.clause}
          ) AS totalOperaciones,
          (
            SELECT COUNT(*)
            FROM ${TABLA_PARTOS} p
            ${filtroPartos.clause}
          ) AS totalPartos,
          (
            SELECT COALESCE(SUM(CASE WHEN COALESCE(g.C_US_REFERIDO, 0) <> 0 THEN 1 ELSE 0 END), 0)
            FROM ${TABLA_GENERAL} g
            ${filtroGeneral.clause}
          ) AS referidos
      `;

      const sexoSql = `
        SELECT
          g.C_PAC_SEXO AS codigo,
          COUNT(*) AS totalEgresos
        FROM ${TABLA_GENERAL} g
        ${filtroGeneral.clause}
        GROUP BY g.C_PAC_SEXO
        ORDER BY g.C_PAC_SEXO
        LIMIT 10
      `;

      const edadesSql = `
        SELECT
          COALESCE(grupo_edad.grupo_edad_quinquenal, 'Sin grupo') AS etiqueta,
          COUNT(*) AS totalEgresos
        FROM ${TABLA_GENERAL} g
        LEFT JOIN (
          SELECT
            CAST(N_EDAD AS SIGNED) AS edad_num,
            CAST(C_EDAD AS SIGNED) AS edad_tipo,
            MAX(NULLIF(TRIM(GRUPO_EDAD_Quinquenal), '')) AS grupo_edad_quinquenal
          FROM EHO_CAT_GRUPOS_EDAD
          GROUP BY CAST(N_EDAD AS SIGNED), CAST(C_EDAD AS SIGNED)
        ) grupo_edad
          ON grupo_edad.edad_num = g.N_PAC_EDAD
         AND grupo_edad.edad_tipo = g.C_PAC_EDAD_TIPO
        ${filtroGeneral.clause}
        GROUP BY etiqueta
        ORDER BY etiqueta
        LIMIT 30
      `;

      const ritmoSql = `
        SELECT
          meses.mes,
          COALESCE(general.totalEgresos, 0) AS totalEgresos,
          COALESCE(operaciones.totalOperaciones, 0) AS totalOperaciones,
          COALESCE(partos.totalPartos, 0) AS totalPartos,
          COALESCE(general.estanciaPromedio, 0) AS estanciaPromedio
        FROM (
          SELECT 1 AS mes UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
          UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8
          UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12
        ) meses
        LEFT JOIN (
          SELECT
            g.N_MES AS mes,
            COUNT(*) AS totalEgresos,
            ROUND(AVG(COALESCE(g.Q_DIAS_ESTANCIA, 0)), 2) AS estanciaPromedio
          FROM ${TABLA_GENERAL} g
          ${filtroGeneral.clause}
          GROUP BY g.N_MES
        ) general
          ON general.mes = meses.mes
        LEFT JOIN (
          SELECT
            o.N_MES AS mes,
            COUNT(*) AS totalOperaciones
          FROM ${TABLA_OPERACIONES} o
          ${filtroOperaciones.clause}
          GROUP BY o.N_MES
        ) operaciones
          ON operaciones.mes = meses.mes
        LEFT JOIN (
          SELECT
            p.N_MES AS mes,
            COUNT(*) AS totalPartos
          FROM ${TABLA_PARTOS} p
          ${filtroPartos.clause}
          GROUP BY p.N_MES
        ) partos
          ON partos.mes = meses.mes
        ORDER BY meses.mes
      `;

      const establecimientosSql = `
        SELECT
          g.C_US AS establecimientoId,
          COALESCE(MAX(NULLIF(TRIM(us.D_US), '')), CONCAT('Establecimiento ', g.C_US)) AS etiqueta,
          COUNT(*) AS totalEgresos,
          ROUND(AVG(COALESCE(g.Q_DIAS_ESTANCIA, 0)), 2) AS estanciaPromedio,
          COALESCE(MAX(operaciones.totalOperaciones), 0) AS totalOperaciones
        FROM ${TABLA_GENERAL} g
        LEFT JOIN ${TABLA_US} us
          ON us.C_US = g.C_US
        LEFT JOIN (
          SELECT
            o.C_US,
            COUNT(*) AS totalOperaciones
          FROM ${TABLA_OPERACIONES} o
          ${filtroOperaciones.clause}
          GROUP BY o.C_US
        ) operaciones
          ON operaciones.C_US = g.C_US
        ${filtroGeneral.clause}
        GROUP BY g.C_US
        ORDER BY totalEgresos DESC
        LIMIT 6
      `;

      const [
        resumenRows,
        sexoRows,
        edadesRows,
        ritmoRows,
        establecimientosRows,
      ] = await Promise.all([
        pool.query<RowDataPacket[]>(resumenSql, [
          ...filtroGeneral.values,
          ...filtroGeneral.values,
          ...filtroDiagnosticos.values,
          ...filtroOperaciones.values,
          ...filtroPartos.values,
          ...filtroGeneral.values,
        ]),
        pool.query<RowDataPacket[]>(sexoSql, filtroGeneral.values),
        pool.query<RowDataPacket[]>(edadesSql, filtroGeneral.values),
        pool.query<RowDataPacket[]>(ritmoSql, [
          ...filtroGeneral.values,
          ...filtroOperaciones.values,
          ...filtroPartos.values,
        ]),
        pool.query<RowDataPacket[]>(establecimientosSql, [
          ...filtroOperaciones.values,
          ...filtroGeneral.values,
        ]),
      ]);

      const resumenRow = resumenRows[0][0] ?? {};

      return {
        resumen: {
          totalEgresos: Number(resumenRow.totalEgresos ?? 0),
          estanciaPromedio: Number(resumenRow.estanciaPromedio ?? 0),
          totalDiagnosticos: Number(resumenRow.totalDiagnosticos ?? 0),
          totalOperaciones: Number(resumenRow.totalOperaciones ?? 0),
          totalPartos: Number(resumenRow.totalPartos ?? 0),
          referidos: Number(resumenRow.referidos ?? 0),
        },
        distribucionSexo: sexoRows[0].map((row) => {
          const codigo = row.codigo === null || row.codigo === undefined ? null : Number(row.codigo);
          return {
            codigo,
            etiqueta: codigo === null ? "Sin dato" : SEXO_LABELS[codigo] ?? `Código ${codigo}`,
            totalEgresos: Number(row.totalEgresos ?? 0),
          };
        }),
        distribucionEdades: edadesRows[0].map((row) => ({
          etiqueta: String(row.etiqueta ?? "Sin grupo"),
          totalEgresos: Number(row.totalEgresos ?? 0),
        })),
        ritmoMensual: ritmoRows[0].map((row) => ({
          mes: Number(row.mes ?? 0),
          totalEgresos: Number(row.totalEgresos ?? 0),
          totalOperaciones: Number(row.totalOperaciones ?? 0),
          totalPartos: Number(row.totalPartos ?? 0),
          estanciaPromedio: Number(row.estanciaPromedio ?? 0),
        })),
        establecimientosDestacados: establecimientosRows[0].map((row) => ({
          establecimientoId: Number(row.establecimientoId ?? 0),
          etiqueta: String(row.etiqueta ?? "Sin dato"),
          totalEgresos: Number(row.totalEgresos ?? 0),
          estanciaPromedio: Number(row.estanciaPromedio ?? 0),
          totalOperaciones: Number(row.totalOperaciones ?? 0),
        })),
      };
    },
    CACHE_TTL.RESUMEN_TABLERO
  );
};

export const obtenerIndicadoresDepartamentoEgresos = async (
  params: EgresosIndicadoresDepartamentoParams
): Promise<EgresosIndicadoresDepartamento> => {
  const cacheKey = `egresos-tablero:indicadores:${params.departamentoId}:${params.regionIds?.join(",") ?? "all"}:${params.anio ?? "all"}`;

  return cache.getOrSet(
    cacheKey,
    async () => {
      const pool = obtenerPoolActual();
      const { clause, values } = construirFiltroUbicacion(params);

      const sql = `
        SELECT
          (
            SELECT COUNT(*)
            FROM ${TABLA_GENERAL} base
            INNER JOIN ${TABLA_US} us
              ON us.C_US = base.C_US
            WHERE ${clause}
          ) AS totalEgresos,
          (
            SELECT COALESCE(SUM(base.Q_DIAS_ESTANCIA), 0)
            FROM ${TABLA_GENERAL} base
            INNER JOIN ${TABLA_US} us
              ON us.C_US = base.C_US
            WHERE ${clause}
          ) AS diasEstancia,
          (
            SELECT COUNT(*)
            FROM ${TABLA_DIAGNOSTICOS} base
            INNER JOIN ${TABLA_US} us
              ON us.C_US = base.C_US
            WHERE ${clause}
          ) AS totalDiagnosticos,
          (
            SELECT COUNT(*)
            FROM ${TABLA_OPERACIONES} base
            INNER JOIN ${TABLA_US} us
              ON us.C_US = base.C_US
            WHERE ${clause}
          ) AS totalOperaciones,
          (
            SELECT COUNT(*)
            FROM ${TABLA_PARTOS} base
            INNER JOIN ${TABLA_US} us
              ON us.C_US = base.C_US
            WHERE ${clause}
          ) AS totalPartos,
          (
            SELECT COUNT(DISTINCT base.C_US)
            FROM ${TABLA_GENERAL} base
            INNER JOIN ${TABLA_US} us
              ON us.C_US = base.C_US
            WHERE ${clause}
          ) AS totalUnidades
      `;

      const queryParams = [
        ...values,
        ...values,
        ...values,
        ...values,
        ...values,
        ...values,
      ];

      const [rows] = await pool.query<RowDataPacket[]>(sql, queryParams);
      const row = rows[0] ?? {};

      return {
        totalEgresos: Number(row.totalEgresos ?? 0),
        diasEstancia: Number(row.diasEstancia ?? 0),
        totalDiagnosticos: Number(row.totalDiagnosticos ?? 0),
        totalOperaciones: Number(row.totalOperaciones ?? 0),
        totalPartos: Number(row.totalPartos ?? 0),
        totalUnidades: Number(row.totalUnidades ?? 0),
      };
    },
    CACHE_TTL.RESUMEN_TABLERO
  );
};
