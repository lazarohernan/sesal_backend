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
  regionId?: number;
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

const TABLA_GENERAL = "EHO_BDT_EGR_GENERAL";
const TABLA_DIAGNOSTICOS = "EHO_BDT_EGR_DIAGNOSTICOS";
const TABLA_OPERACIONES = "EHO_BDT_EGR_OPERACIONES";
const TABLA_PARTOS = "EHO_BDT_EGR_PARTOS";
const TABLA_US = "BAS_BDR_US";
const TABLA_DEPARTAMENTOS = "BAS_BDR_DEPARTAMENTOS";

const construirFiltroUbicacion = (params: EgresosIndicadoresDepartamentoParams) => {
  const whereParts = ["us.C_DEPARTAMENTO = ?"];
  const values: number[] = [params.departamentoId];

  if (params.regionId !== undefined) {
    whereParts.push("us.C_REGION = ?");
    values.push(params.regionId);
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

export const obtenerDatosMapaHondurasEgresos = async (): Promise<EgresosDepartamentoDato[]> => {
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

export const obtenerIndicadoresDepartamentoEgresos = async (
  params: EgresosIndicadoresDepartamentoParams
): Promise<EgresosIndicadoresDepartamento> => {
  const cacheKey = `egresos-tablero:indicadores:${params.departamentoId}:${params.regionId ?? "all"}:${params.anio ?? "all"}`;

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
