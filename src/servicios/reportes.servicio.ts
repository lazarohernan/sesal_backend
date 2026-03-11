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
        condicionRegion = "AND us.C_REGION = ?";
        parametros.push(regionId);
      } else {
        const esCortes = departamentoId === 5;
        if (esCortes) {
          condicionRegion = "AND us.C_REGION IN (5, 20)";
        }
      }

      const query = `
        SELECT
          SUM(totalConsultas) AS totalConsultas,
          SUM(enfermeraAuxiliar) AS enfermeraAuxiliar,
          SUM(enfermeraProfesional) AS enfermeraProfesional,
          SUM(medicinaGeneral) AS medicinaGeneral,
          SUM(medicosEspecialistas) AS medicosEspecialistas,
          COUNT(DISTINCT C_US) AS totalUnidades
        FROM (
          SELECT
            det.C_US,
            det.Q_AT_ENFERMERA_AUX + det.Q_AT_ENFERMERA_PRO + det.Q_AT_MEDICO_GEN + det.Q_AT_MEDICO_ESP AS totalConsultas,
            det.Q_AT_ENFERMERA_AUX AS enfermeraAuxiliar,
            det.Q_AT_ENFERMERA_PRO AS enfermeraProfesional,
            det.Q_AT_MEDICO_GEN AS medicinaGeneral,
            det.Q_AT_MEDICO_ESP AS medicosEspecialistas
          FROM ${TABLA_DETALLE} det
          INNER JOIN BAS_BDR_US us
          ON us.C_US = det.C_US
            AND us.C_DEPARTAMENTO = ?
            ${condicionRegion}
          WHERE det.N_ANIO = ?
        ) AS subquery`;

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
  const stats = cache.getStats();
  const reportesKeys = stats.keys.filter(k => k.startsWith("reportes:"));
  return {
    totalEntradas: reportesKeys.length,
    cacheGlobal: {
      hits: stats.hits,
      misses: stats.misses,
      totalSize: stats.size
    }
  };
};
