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

export const obtenerResumenTablero = async (anio?: number): Promise<ResumenTablero> => {
  const cacheKey = CACHE_KEYS.RESUMEN_TABLERO(anio);
  
  return cache.getOrSet(
    cacheKey,
    async () => {
      const pool = obtenerPoolActual();
      
      let totalUnidadesServicio = 0;
      let totalRegistrosDetalle = 0;

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

      // Obtener regiones y municipios (estos no cambian por año)
      const [catalogos] = await pool.query<RowDataPacket[]>(
        `SELECT
            (SELECT COUNT(*) FROM BAS_BDR_REGIONES) AS totalRegiones,
            (SELECT COUNT(*) FROM BAS_BDR_MUNICIPIOS) AS totalMunicipios`
      );

      return {
        totalRegiones: Number(catalogos?.[0]?.totalRegiones ?? 0),
        totalMunicipios: Number(catalogos?.[0]?.totalMunicipios ?? 0),
        totalUnidadesServicio,
        totalRegistrosDetalle
      };
    },
    CACHE_TTL.RESUMEN_TABLERO
  );
};

export const obtenerDatosMapaHonduras = async (): Promise<DepartamentoDato[]> => {
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
