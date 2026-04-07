import type { RowDataPacket } from "mysql2";

import { obtenerPoolActual } from "../base_datos/pool";
import { cache, CACHE_TTL, CACHE_KEYS } from "../utilidades/cache.utilidad";

export interface ResumenTablero {
  totalRegiones: number;
  totalMunicipios: number;
  totalUnidadesServicio: number;
  totalRegistrosDetalle: number;
}

export interface DepartamentoDato {
  departamentoId: number;
  nombre: string;
  totalHistorico: number;
  total2025: number;
  total2024: number;
  total2023: number;
  totalUnidades: number;
}

const construirFiltroRegionesSql = (regionIds?: number[] | null, alias = "us") => {
  if (!regionIds?.length) {
    return {
      clause: "",
      values: [] as number[]
    };
  }

  return {
    clause: ` AND ${alias}.C_REGION IN (${regionIds.map(() => "?").join(", ")})`,
    values: [...regionIds]
  };
};

export const obtenerResumenTablero = async (anio?: number, regionIds?: number[] | null): Promise<ResumenTablero> => {
  const regionKey = regionIds?.length ? `r:${regionIds.join(",")}` : "r:all";
  const cacheKey = `${CACHE_KEYS.RESUMEN_TABLERO(anio)}:${regionKey}`;
  
  return cache.getOrSet(
    cacheKey,
    async () => {
      const pool = obtenerPoolActual();
      const filtroRegiones = construirFiltroRegionesSql(regionIds);
      
      let totalUnidadesServicio = 0;
      let totalRegistrosDetalle = 0;
      let totalRegiones = 0;
      let totalMunicipios = 0;

      if (regionIds?.length) {
        if (anio) {
          const [resultado] = await pool.query<RowDataPacket[]>(
            `SELECT
              COUNT(*) AS total,
              COUNT(DISTINCT det.C_US) AS totalUnidades
             FROM AT2_DETALLE det
             INNER JOIN BAS_BDR_US us
               ON us.C_US COLLATE utf8mb4_unicode_ci = det.C_US COLLATE utf8mb4_unicode_ci
             WHERE det.N_ANIO = ?${filtroRegiones.clause}`,
            [anio, ...filtroRegiones.values]
          );
          totalRegistrosDetalle = Number(resultado?.[0]?.total ?? 0);
          totalUnidadesServicio = Number(resultado?.[0]?.totalUnidades ?? 0);
        } else {
          const [tablas] = await pool.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS total
             FROM AT2_DETALLE det
             INNER JOIN BAS_BDR_US us
               ON us.C_US COLLATE utf8mb4_unicode_ci = det.C_US COLLATE utf8mb4_unicode_ci
             WHERE 1=1${filtroRegiones.clause}`,
            [...filtroRegiones.values]
          );
          totalRegistrosDetalle = Number(tablas?.[0]?.total ?? 0);

          const [catalogoUS] = await pool.query<RowDataPacket[]>(
            `SELECT COUNT(DISTINCT us.C_US) AS total
             FROM BAS_BDR_US us
             WHERE 1=1${filtroRegiones.clause}`,
            [...filtroRegiones.values]
          );
          totalUnidadesServicio = Number(catalogoUS?.[0]?.total ?? 0);
        }

        const [catalogos] = await pool.query<RowDataPacket[]>(
          `SELECT
              COUNT(DISTINCT us.C_REGION) AS totalRegiones,
              COUNT(DISTINCT CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO)) AS totalMunicipios
           FROM BAS_BDR_US us
           WHERE 1=1${filtroRegiones.clause}`,
          [...filtroRegiones.values]
        );

        totalRegiones = Number(catalogos?.[0]?.totalRegiones ?? 0);
        totalMunicipios = Number(catalogos?.[0]?.totalMunicipios ?? 0);
      } else {
        if (anio) {
          const [resultado] = await pool.query<RowDataPacket[]>(
            `SELECT
              COUNT(*) AS total,
              COUNT(DISTINCT C_US) AS totalUnidades
             FROM AT2_DETALLE
             WHERE N_ANIO = ?`,
            [anio]
          );
          totalRegistrosDetalle = Number(resultado?.[0]?.total ?? 0);
          totalUnidadesServicio = Number(resultado?.[0]?.totalUnidades ?? 0);
        } else {
          const [tablas] = await pool.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS total FROM AT2_DETALLE`
          );
          totalRegistrosDetalle = Number(tablas?.[0]?.total ?? 0);

          const [catalogoUS] = await pool.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS total FROM BAS_BDR_US`
          );
          totalUnidadesServicio = Number(catalogoUS?.[0]?.total ?? 0);
        }

        const [catalogos] = await pool.query<RowDataPacket[]>(
          `SELECT
              (SELECT COUNT(*) FROM BAS_BDR_REGIONES) AS totalRegiones,
              (SELECT COUNT(*) FROM BAS_BDR_MUNICIPIOS) AS totalMunicipios`
        );

        totalRegiones = Number(catalogos?.[0]?.totalRegiones ?? 0);
        totalMunicipios = Number(catalogos?.[0]?.totalMunicipios ?? 0);
      }

      return {
        totalRegiones,
        totalMunicipios,
        totalUnidadesServicio,
        totalRegistrosDetalle
      };
    },
    CACHE_TTL.RESUMEN_TABLERO
  );
};

export const obtenerDatosMapaHonduras = async (regionIds?: number[] | null): Promise<DepartamentoDato[]> => {
  if (regionIds?.length) {
    const pool = obtenerPoolActual();
    const filtroRegiones = construirFiltroRegionesSql(regionIds);
    const [filas] = await pool.query<RowDataPacket[]>(
      `
        SELECT
          us.C_DEPARTAMENTO AS departamentoId,
          dep.D_DEPARTAMENTO AS nombre,
          COUNT(*) AS totalHistorico,
          SUM(CASE WHEN det.N_ANIO = 2025 THEN 1 ELSE 0 END) AS total2025,
          SUM(CASE WHEN det.N_ANIO = 2024 THEN 1 ELSE 0 END) AS total2024,
          SUM(CASE WHEN det.N_ANIO = 2023 THEN 1 ELSE 0 END) AS total2023,
          COUNT(DISTINCT det.C_US) AS totalUnidades
        FROM AT2_DETALLE det
        INNER JOIN BAS_BDR_US us
          ON us.C_US COLLATE utf8mb4_unicode_ci = det.C_US COLLATE utf8mb4_unicode_ci
        INNER JOIN BAS_BDR_DEPARTAMENTOS dep
          ON dep.C_DEPARTAMENTO = us.C_DEPARTAMENTO
        WHERE 1=1${filtroRegiones.clause}
        GROUP BY us.C_DEPARTAMENTO, dep.D_DEPARTAMENTO
        ORDER BY us.C_DEPARTAMENTO
      `,
      [...filtroRegiones.values]
    );

    return filas.map((fila) => ({
      departamentoId: Number(fila.departamentoId),
      nombre: String(fila.nombre),
      totalHistorico: Number(fila.totalHistorico ?? 0),
      total2025: Number(fila.total2025 ?? 0),
      total2024: Number(fila.total2024 ?? 0),
      total2023: Number(fila.total2023 ?? 0),
      totalUnidades: Number(fila.totalUnidades ?? 0)
    }));
  }

  return cache.getOrSet(
    CACHE_KEYS.DATOS_MAPA,
    async () => {
      const pool = obtenerPoolActual();
      const [filas] = await pool.query<RowDataPacket[]>(
        `SELECT
            departamento_id AS departamentoId,
            nombre_departamento AS nombre,
            total_registros_historico AS totalHistorico,
            total_registros_2025 AS total2025,
            total_registros_2024 AS total2024,
            total_registros_2023 AS total2023,
            total_unidades AS totalUnidades
          FROM tablero_departamento_resumen
          ORDER BY departamento_id`
      );

      return filas.map((fila) => ({
        departamentoId: Number(fila.departamentoId),
        nombre: String(fila.nombre),
        totalHistorico: Number(fila.totalHistorico ?? 0),
        total2025: Number(fila.total2025 ?? 0),
        total2024: Number(fila.total2024 ?? 0),
        total2023: Number(fila.total2023 ?? 0),
        totalUnidades: Number(fila.totalUnidades ?? 0)
      }));
    },
    CACHE_TTL.DATOS_MAPA
  );
};
