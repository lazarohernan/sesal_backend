import type { RowDataPacket } from "mysql2/promise";
import { obtenerPoolActual } from "../base_datos/pool";
import { cache, CACHE_TTL } from "../utilidades/cache.utilidad";

const TABLA_DETALLE = "AT2_DETALLE";



export interface IndicadoresMunicipalesParams {
  anio: number;
  departamentoId: number;
  limite: number;
  regionId?: number;
}

export interface IndicadoresMunicipalesTotales {
  totalConsultas: number;
  enfermeraAuxiliar: number;
  enfermeraProfesional: number;
  medicinaGeneral: number;
  medicosEspecialistas: number;
  totalUnidades: number;
}

const REPORTES_CACHE_TTL = CACHE_TTL.RESUMEN_TABLERO; // 5 minutos

export const obtenerIndicadoresMunicipales = async (
  params: IndicadoresMunicipalesParams
): Promise<IndicadoresMunicipalesTotales> => {
  const { anio, departamentoId, regionId } = params;
  const cacheKey = `reportes:indicadores:${anio}-${departamentoId}-${regionId ?? "all"}`;

  return cache.getOrSet(
    cacheKey,
    async () => {
      const pool = obtenerPoolActual();
      let condicionRegion = "";
      const parametros: any[] = [departamentoId];

      if (regionId !== undefined && regionId !== null) {
        condicionRegion = "AND C_REGION = ?";
        parametros.push(regionId);
      } else {
        const esCortes = departamentoId === 5;
        if (esCortes) {
          condicionRegion = "AND C_REGION IN (5, 20)";
        }
      }

      const query = `
        SELECT
          COALESCE(SUM(det.Q_AT_ENFERMERA_AUX + det.Q_AT_ENFERMERA_PRO + det.Q_AT_MEDICO_GEN + det.Q_AT_MEDICO_ESP), 0) AS totalConsultas,
          COALESCE(SUM(det.Q_AT_ENFERMERA_AUX), 0) AS enfermeraAuxiliar,
          COALESCE(SUM(det.Q_AT_ENFERMERA_PRO), 0) AS enfermeraProfesional,
          COALESCE(SUM(det.Q_AT_MEDICO_GEN), 0) AS medicinaGeneral,
          COALESCE(SUM(det.Q_AT_MEDICO_ESP), 0) AS medicosEspecialistas,
          COUNT(DISTINCT det.C_US) AS totalUnidades
        FROM (
          SELECT DISTINCT CAST(C_US AS CHAR) AS C_US
          FROM BAS_BDR_US
          WHERE C_DEPARTAMENTO = ?
          ${condicionRegion}
        ) us
        STRAIGHT_JOIN ${TABLA_DETALLE} det
          ON det.C_US = us.C_US
        WHERE det.N_ANIO = ?`;

      parametros.push(anio);
      const [filas] = await pool.query<RowDataPacket[]>(query, parametros);
      const fila = filas?.[0] ?? {};

      return {
        totalConsultas: Number(fila.totalConsultas ?? 0),
        enfermeraAuxiliar: Number(fila.enfermeraAuxiliar ?? 0),
        enfermeraProfesional: Number(fila.enfermeraProfesional ?? 0),
        medicinaGeneral: Number(fila.medicinaGeneral ?? 0),
        medicosEspecialistas: Number(fila.medicosEspecialistas ?? 0),
        totalUnidades: Number(fila.totalUnidades ?? 0)
      };
    },
    REPORTES_CACHE_TTL
  );
};

export const obtenerEstadisticasCache = () => {
  const stats = cache.getStats({ includeKeys: false });
  return {
    totalEntradas: cache.countKeysByPrefix("reportes:"),
    cacheGlobal: {
      hits: stats.hits,
      misses: stats.misses,
      totalSize: stats.size,
      pending: stats.pending
    }
  };
};
