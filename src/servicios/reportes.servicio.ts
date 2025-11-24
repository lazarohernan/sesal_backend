import type { Pool, RowDataPacket } from "mysql2/promise";
import { obtenerPoolActual } from "../base_datos/pool";

// Cache simple para resultados de consultas
interface CacheEntry {
  data: IndicadoresMunicipalesTotales;
  timestamp: number;
}

const cacheResultados = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos en milisegundos
const MAX_CACHE_SIZE = 100; // Máximo 100 entradas en cache

const construirNombreTablaDetalle = (anio: number) => {
  return `AT2_BDT_MENSUAL_DETALLE_${anio}`;
};

// Función para generar clave de cache
const generarClaveCache = (anio: number, departamentoId: number, regionId?: number): string => {
  if (regionId !== undefined && regionId !== null) {
    return `${anio}-${departamentoId}-${regionId}`;
  }
  return `${anio}-${departamentoId}`;
};

// Función para limpiar cache antiguo
const limpiarCacheAntiguo = () => {
  const ahora = Date.now();
  const clavesParaEliminar: string[] = [];

  for (const [clave, entry] of cacheResultados.entries()) {
    if (ahora - entry.timestamp > CACHE_TTL) {
      clavesParaEliminar.push(clave);
    }
  }

  clavesParaEliminar.forEach(clave => cacheResultados.delete(clave));
};

// Función para verificar si una tabla existe (cacheada)
const tablasVerificadas = new Set<string>();
const validarTablaExisteCacheada = async (pool: Pool, tabla: string) => {
  if (tablasVerificadas.has(tabla)) {
    return; // Ya verificada anteriormente
  }

  const [filas] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     LIMIT 1`,
    [tabla]
  );

  const existe = Number(filas?.[0]?.total ?? 0) > 0;
  if (!existe) {
    throw new Error(`La tabla ${tabla} no existe en la base de datos actual.`);
  }

  tablasVerificadas.add(tabla); // Cachear que la tabla existe
};


export interface IndicadoresMunicipalesParams {
  anio: number;
  departamentoId: number;
  limite: number;
  regionId?: number; // Opcional: para filtrar por región específica
}

export interface IndicadoresMunicipalesTotales {
  totalConsultas: number;
  enfermeraAuxiliar: number;
  enfermeraProfesional: number;
  medicinaGeneral: number;
  medicosEspecialistas: number;
  totalUnidades: number;
}

export const obtenerIndicadoresMunicipales = async (
  params: IndicadoresMunicipalesParams
): Promise<IndicadoresMunicipalesTotales> => {
  const { anio, departamentoId, regionId } = params;
  const claveCache = generarClaveCache(anio, departamentoId, regionId);

  // Verificar cache primero
  const entradaCache = cacheResultados.get(claveCache);
  if (entradaCache && Date.now() - entradaCache.timestamp < CACHE_TTL) {
    return entradaCache.data; // Retornar resultado cacheado
  }

  // Limpiar cache antiguo si es necesario
  limpiarCacheAntiguo();

  const pool = obtenerPoolActual();
  const tablaDetalle = construirNombreTablaDetalle(anio);
  await validarTablaExisteCacheada(pool, tablaDetalle);

  // Si se especifica una región, usar solo esa región
  // Si no, para Cortés (5) incluir regiones 5 y 20, para otros departamentos usar comportamiento normal
  let condicionRegion = "";
  const parametros: any[] = [departamentoId];
  
  if (regionId !== undefined && regionId !== null) {
    // Filtrar por región específica
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
        COALESCE(CAST(det.Q_AT_ENFERMERA_AUX AS UNSIGNED), 0) + COALESCE(CAST(det.Q_AT_ENFERMERA_PRO AS UNSIGNED), 0) + COALESCE(CAST(det.Q_AT_MEDICO_GEN AS UNSIGNED), 0) + COALESCE(CAST(det.Q_AT_MEDICO_ESP AS UNSIGNED), 0) AS totalConsultas,
        COALESCE(CAST(det.Q_AT_ENFERMERA_AUX AS UNSIGNED), 0) AS enfermeraAuxiliar,
        COALESCE(CAST(det.Q_AT_ENFERMERA_PRO AS UNSIGNED), 0) AS enfermeraProfesional,
        COALESCE(CAST(det.Q_AT_MEDICO_GEN AS UNSIGNED), 0) AS medicinaGeneral,
        COALESCE(CAST(det.Q_AT_MEDICO_ESP AS UNSIGNED), 0) AS medicosEspecialistas
      FROM ${tablaDetalle} det
      FORCE INDEX (idx_detalle_c_us)
      INNER JOIN BAS_BDR_US us FORCE INDEX (idx_us_departamento)
      ON us.C_US = det.C_US
        AND us.C_DEPARTAMENTO = ?
        ${condicionRegion}
      WHERE det.N_ANIO = ?
    ) AS subquery`;

  parametros.push(anio);
  const [filas] = await pool.query<RowDataPacket[]>(query, parametros);
  const fila = filas?.[0] ?? {};

  const resultado = {
    totalConsultas: Number(fila.totalConsultas ?? 0),
    enfermeraAuxiliar: Number(fila.enfermeraAuxiliar ?? 0),
    enfermeraProfesional: Number(fila.enfermeraProfesional ?? 0),
    medicinaGeneral: Number(fila.medicinaGeneral ?? 0),
    medicosEspecialistas: Number(fila.medicosEspecialistas ?? 0),
    totalUnidades: Number(fila.totalUnidades ?? 0)
  };

  // Guardar en cache
  if (cacheResultados.size >= MAX_CACHE_SIZE) {
    // Eliminar entrada más antigua si el cache está lleno
    const primeraClave = cacheResultados.keys().next().value;
    if (primeraClave) {
      cacheResultados.delete(primeraClave);
    }
  }
  cacheResultados.set(claveCache, {
    data: resultado,
    timestamp: Date.now()
  });

  return resultado;
};

// Función para obtener estadísticas del cache (útil para debugging)
export const obtenerEstadisticasCache = () => {
  const ahora = Date.now();
  let entradasValidas = 0;
  let entradasExpiradas = 0;

  for (const entry of cacheResultados.values()) {
    if (ahora - entry.timestamp < CACHE_TTL) {
      entradasValidas++;
    } else {
      entradasExpiradas++;
    }
  }

  return {
    totalEntradas: cacheResultados.size,
    entradasValidas,
    entradasExpiradas,
    tablasVerificadas: tablasVerificadas.size,
    cacheTTL: CACHE_TTL,
    maxCacheSize: MAX_CACHE_SIZE
  };
};
