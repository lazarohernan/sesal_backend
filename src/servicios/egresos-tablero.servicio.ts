import type { RowDataPacket } from "mysql2";

import { obtenerPoolActual } from "../base_datos/pool";
import { cache, CACHE_TTL } from "../utilidades/cache.utilidad";
import { CIE_PARTO_CATEGORIAS } from "./egresos-cie.util";

export interface EgresosDepartamentoDato {
  departamentoId: number;
  nombre: string;
  totalHistorico: number;
  totalesPorAnio: Record<number, number>;
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
  totalPartosAdolescentes: number;
  totalUnidades: number;
  desgloseNiveles: Array<{
    codigo: number;
    etiqueta: string;
    grupo: "Segundo nivel" | "Primer nivel";
    totalEgresos: number;
    totalUnidades: number;
  }>;
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
    totalPartosAdolescentes: number;
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
const TABLA_NIVELES_US = "BAS_BDR_NIVELES_US";

const NIVELES_EGRESOS_SOLICITADOS: Array<{
  codigo: number;
  etiqueta: string;
  grupo: "Segundo nivel" | "Primer nivel";
}> = [
  { codigo: 1, etiqueta: "Básico", grupo: "Segundo nivel" },
  { codigo: 2, etiqueta: "General", grupo: "Segundo nivel" },
  { codigo: 3, etiqueta: "Especialidades", grupo: "Segundo nivel" },
  { codigo: 4, etiqueta: "Instituto", grupo: "Segundo nivel" },
  { codigo: 6, etiqueta: "Centro Integral de Salud", grupo: "Primer nivel" },
  { codigo: 7, etiqueta: "Servicio Materno Infantil", grupo: "Primer nivel" },
];

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
  `egresos-tablero:indicadores-v3:${params.regionIds?.length ? [...params.regionIds].sort((a, b) => a - b).join(",") : "all"}:${params.departamentoId ?? "hn"}:${params.anio ?? "all"}`;

const construirCondicionCategoriasParto = (alias: string) => {
  return `(${CIE_PARTO_CATEGORIAS.map((categoria) => `${alias}.C_CIE LIKE '${categoria}%'`).join(" OR ")})`;
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

const mapearDatosMapaEgresos = (
  departamentos: RowDataPacket[],
  totalesAnuales: RowDataPacket[]
): EgresosDepartamentoDato[] => {
  const porDepartamento = new Map<number, Record<number, number>>();

  totalesAnuales.forEach((row) => {
    const departamentoId = Number(row.departamentoId);
    const anio = Number(row.anio);
    const total = Number(row.total ?? 0);
    if (!Number.isInteger(departamentoId) || !Number.isInteger(anio)) return;

    const totales = porDepartamento.get(departamentoId) ?? {};
    totales[anio] = total;
    porDepartamento.set(departamentoId, totales);
  });

  return departamentos.map((row) => {
    const departamentoId = Number(row.departamentoId);
    const totalesPorAnio = porDepartamento.get(departamentoId) ?? {};

    return {
      departamentoId,
      nombre: String(row.nombre),
      totalHistorico: Number(row.totalHistorico ?? 0),
      totalesPorAnio,
      total2025: Number(totalesPorAnio[2025] ?? 0),
      total2024: Number(totalesPorAnio[2024] ?? 0),
      total2023: Number(totalesPorAnio[2023] ?? 0),
      totalUnidades: Number(row.totalUnidades ?? 0),
    };
  });
};

const cargarDatosMapaEgresos = async (regionIds?: number[] | null): Promise<EgresosDepartamentoDato[]> => {
  const pool = obtenerPoolActual();

  if (regionIds?.length) {
    const placeholders = regionIds.map(() => "?").join(", ");
    const filtroRegion = `WHERE us.C_REGION IN (${placeholders})`;
    const paramsRegion = [...regionIds];

    const [departamentos, totalesAnuales] = await Promise.all([
      pool.query<RowDataPacket[]>(
        `
          SELECT
            us.C_DEPARTAMENTO AS departamentoId,
            dep.D_DEPARTAMENTO AS nombre,
            COUNT(*) AS totalHistorico,
            COUNT(DISTINCT g.C_US) AS totalUnidades
          FROM ${TABLA_GENERAL} g
          INNER JOIN ${TABLA_US} us
            ON us.C_US = g.C_US
          INNER JOIN ${TABLA_DEPARTAMENTOS} dep
            ON dep.C_DEPARTAMENTO = us.C_DEPARTAMENTO
          ${filtroRegion}
          GROUP BY us.C_DEPARTAMENTO, dep.D_DEPARTAMENTO
          ORDER BY us.C_DEPARTAMENTO
        `,
        paramsRegion
      ),
      pool.query<RowDataPacket[]>(
        `
          SELECT
            us.C_DEPARTAMENTO AS departamentoId,
            g.N_ANIO AS anio,
            COUNT(*) AS total
          FROM ${TABLA_GENERAL} g
          INNER JOIN ${TABLA_US} us
            ON us.C_US = g.C_US
          ${filtroRegion}
          GROUP BY us.C_DEPARTAMENTO, g.N_ANIO
        `,
        paramsRegion
      ),
    ]);

    return mapearDatosMapaEgresos(departamentos[0], totalesAnuales[0]);
  }

  const [departamentos, totalesAnuales] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `
        SELECT
          dep.C_DEPARTAMENTO AS departamentoId,
          dep.D_DEPARTAMENTO AS nombre,
          COALESCE(hist.totalHistorico, 0) AS totalHistorico,
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
        WHERE dep.C_DEPARTAMENTO BETWEEN 1 AND 18
        ORDER BY dep.C_DEPARTAMENTO
      `
    ),
    pool.query<RowDataPacket[]>(
      `
        SELECT
          us.C_DEPARTAMENTO AS departamentoId,
          g.N_ANIO AS anio,
          COUNT(*) AS total
        FROM ${TABLA_GENERAL} g
        INNER JOIN ${TABLA_US} us
          ON us.C_US = g.C_US
        GROUP BY us.C_DEPARTAMENTO, g.N_ANIO
      `
    ),
  ]);

  return mapearDatosMapaEgresos(departamentos[0], totalesAnuales[0]);
};

export const obtenerDatosMapaHondurasEgresos = async (regionIds?: number[] | null): Promise<EgresosDepartamentoDato[]> => {
  if (regionIds?.length) {
    const regionKey = [...regionIds].sort((a, b) => a - b).join(",");
    return cache.getOrSet(
      `egresos-tablero:mapa:regional:${regionKey}`,
      () => cargarDatosMapaEgresos(regionIds),
      CACHE_TTL.DATOS_MAPA
    );
  }

  return cache.getOrSet(
    "egresos-tablero:mapa",
    () => cargarDatosMapaEgresos(),
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
      const filtroPartos = construirFiltroTablero(params, "d");

      const resumenSql = `
        SELECT
          general.totalEgresos,
          general.estanciaPromedio,
          diagnosticos.totalDiagnosticos,
          operaciones.totalOperaciones,
          partos.totalPartos,
          adolescentes.totalPartosAdolescentes,
          general.referidos
        FROM (
          SELECT
            COUNT(*) AS totalEgresos,
            ROUND(AVG(COALESCE(g.Q_DIAS_ESTANCIA, 0)), 2) AS estanciaPromedio,
            COALESCE(SUM(CASE WHEN COALESCE(g.C_US_REFERIDO, 0) <> 0 THEN 1 ELSE 0 END), 0) AS referidos
            FROM ${TABLA_GENERAL} g
            ${filtroGeneral.clause}
        ) general
        CROSS JOIN (
          SELECT COUNT(*) AS totalDiagnosticos
            FROM ${TABLA_DIAGNOSTICOS} d
            ${filtroDiagnosticos.clause}
        ) diagnosticos
        CROSS JOIN (
          SELECT COUNT(*) AS totalOperaciones
            FROM ${TABLA_OPERACIONES} o
            ${filtroOperaciones.clause}
        ) operaciones
        CROSS JOIN (
          SELECT COUNT(DISTINCT CONCAT_WS(':', d.C_US, d.N_ANIO, d.N_MES, d.N_PAGINA)) AS totalPartos
            FROM ${TABLA_DIAGNOSTICOS} d
            ${filtroPartos.clause}
            ${filtroPartos.clause ? "AND" : "WHERE"} ${construirCondicionCategoriasParto("d")}
        ) partos
        CROSS JOIN (
          SELECT COUNT(*) AS totalPartosAdolescentes
            FROM ${TABLA_GENERAL} g
            ${filtroGeneral.clause}
            ${filtroGeneral.clause ? "AND" : "WHERE"} g.C_PAC_EDAD_TIPO = 4
              AND g.N_PAC_EDAD BETWEEN 10 AND 19
              AND EXISTS (
                SELECT 1
                FROM ${TABLA_DIAGNOSTICOS} d_parto
                WHERE d_parto.C_US = g.C_US
                  AND d_parto.N_ANIO = g.N_ANIO
                  AND d_parto.N_MES = g.N_MES
                  AND d_parto.N_PAGINA = g.N_PAGINA
                  AND ${construirCondicionCategoriasParto("d_parto")}
              )
        ) adolescentes
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
            d.N_MES AS mes,
            COUNT(DISTINCT CONCAT_WS(':', d.C_US, d.N_ANIO, d.N_MES, d.N_PAGINA)) AS totalPartos
          FROM ${TABLA_DIAGNOSTICOS} d
          ${filtroPartos.clause}
          ${filtroPartos.clause ? "AND" : "WHERE"} ${construirCondicionCategoriasParto("d")}
          GROUP BY d.N_MES
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
          totalPartosAdolescentes: Number(resumenRow.totalPartosAdolescentes ?? 0),
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
  const regionKey = params.regionIds?.length ? [...params.regionIds].sort((a, b) => a - b).join(",") : "all";
  const cacheKey = `egresos-tablero:indicadores-v4:${params.departamentoId}:${regionKey}:${params.anio ?? "all"}`;

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
            SELECT COUNT(DISTINCT CONCAT_WS(':', base.C_US, base.N_ANIO, base.N_MES, base.N_PAGINA))
            FROM ${TABLA_DIAGNOSTICOS} base
            INNER JOIN ${TABLA_US} us
              ON us.C_US = base.C_US
            WHERE ${clause}
              AND ${construirCondicionCategoriasParto("base")}
          ) AS totalPartos,
          (
            SELECT COUNT(*)
            FROM ${TABLA_GENERAL} base
            INNER JOIN ${TABLA_US} us
              ON us.C_US = base.C_US
            WHERE ${clause}
              AND base.C_PAC_EDAD_TIPO = 4
              AND base.N_PAC_EDAD BETWEEN 10 AND 19
              AND EXISTS (
                SELECT 1
                FROM ${TABLA_DIAGNOSTICOS} d_parto
                WHERE d_parto.C_US = base.C_US
                  AND d_parto.N_ANIO = base.N_ANIO
                  AND d_parto.N_MES = base.N_MES
                  AND d_parto.N_PAGINA = base.N_PAGINA
                  AND ${construirCondicionCategoriasParto("d_parto")}
              )
          ) AS totalPartosAdolescentes,
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
        ...values,
      ];

      const [rows] = await pool.query<RowDataPacket[]>(sql, queryParams);
      const row = rows[0] ?? {};
      const [desgloseRows] = await pool.query<RowDataPacket[]>(
        `
          SELECT
            us.C_NIVEL_US AS codigo,
            COALESCE(NULLIF(TRIM(nivel.D_NIVEL_US), ''), CONCAT('Código ', us.C_NIVEL_US)) AS etiqueta,
            COUNT(*) AS totalEgresos,
            COUNT(DISTINCT base.C_US) AS totalUnidades
          FROM ${TABLA_GENERAL} base
          INNER JOIN ${TABLA_US} us
            ON us.C_US = base.C_US
          LEFT JOIN ${TABLA_NIVELES_US} nivel
            ON nivel.C_NIVEL_US = us.C_NIVEL_US
          WHERE ${clause}
            AND us.C_NIVEL_US IN (${NIVELES_EGRESOS_SOLICITADOS.map(() => "?").join(", ")})
          GROUP BY us.C_NIVEL_US, nivel.D_NIVEL_US
        `,
        [...values, ...NIVELES_EGRESOS_SOLICITADOS.map((item) => item.codigo)]
      );
      const desglosePorCodigo = new Map<number, RowDataPacket>(
        desgloseRows.map((item) => [Number(item.codigo), item])
      );

      return {
        totalEgresos: Number(row.totalEgresos ?? 0),
        diasEstancia: Number(row.diasEstancia ?? 0),
        totalDiagnosticos: Number(row.totalDiagnosticos ?? 0),
        totalOperaciones: Number(row.totalOperaciones ?? 0),
        totalPartos: Number(row.totalPartos ?? 0),
        totalPartosAdolescentes: Number(row.totalPartosAdolescentes ?? 0),
        totalUnidades: Number(row.totalUnidades ?? 0),
        desgloseNiveles: NIVELES_EGRESOS_SOLICITADOS.map((nivel) => {
          const datosNivel = desglosePorCodigo.get(nivel.codigo);
          const etiquetaCatalogo = datosNivel?.etiqueta ? String(datosNivel.etiqueta) : "";
          const etiqueta = nivel.codigo >= 6 && etiquetaCatalogo ? etiquetaCatalogo : nivel.etiqueta;
          return {
            ...nivel,
            etiqueta,
            totalEgresos: Number(datosNivel?.totalEgresos ?? 0),
            totalUnidades: Number(datosNivel?.totalUnidades ?? 0),
          };
        }),
      };
    },
    CACHE_TTL.RESUMEN_TABLERO
  );
};
