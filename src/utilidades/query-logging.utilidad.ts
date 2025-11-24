import type { Pool } from "mysql2/promise";
import { logger } from "./registro.utilidad";

const SLOW_QUERY_THRESHOLD_MS = 1000; // 1 segundo
const ENABLE_QUERY_LOGGING = process.env.LOG_SLOW_QUERIES !== "false";

interface QueryMetrics {
  sql: string;
  duration: number;
  params?: unknown[];
  timestamp: Date;
}

const slowQueries: QueryMetrics[] = [];
const MAX_SLOW_QUERIES_LOG = 100; // Mantener solo las últimas 100 queries lentas

/**
 * Ejecuta una query con logging de tiempo de ejecución
 */
export async function ejecutarQueryConLogging<T = unknown>(
  pool: Pool,
  sql: string,
  params?: unknown[]
): Promise<T> {
  const inicio = Date.now();
  const timestamp = new Date();

  try {
    const [result] = await pool.query(sql, params);
    const duracion = Date.now() - inicio;

    // Log queries lentas
    if (ENABLE_QUERY_LOGGING && duracion >= SLOW_QUERY_THRESHOLD_MS) {
      const queryInfo: QueryMetrics = {
        sql: sql.substring(0, 500), // Limitar longitud para logs
        duration: duracion,
        params: params ? (Array.isArray(params) ? params.slice(0, 10) : [params]) : undefined,
        timestamp
      };

      slowQueries.push(queryInfo);
      
      // Mantener solo las últimas N queries
      if (slowQueries.length > MAX_SLOW_QUERIES_LOG) {
        slowQueries.shift();
      }

      logger.warn(
        `[SLOW QUERY] ${duracion}ms - SQL: ${sql.substring(0, 200)}...`,
        params ? `Params: ${JSON.stringify(params).substring(0, 100)}` : ""
      );
    }

    // Log en modo debug para todas las queries
    if (process.env.NODE_ENV !== "production" && process.env.DEBUG_QUERIES === "true") {
      logger.debug(`[QUERY] ${duracion}ms - ${sql.substring(0, 100)}`);
    }

    return result as T;
  } catch (error) {
    const duracion = Date.now() - inicio;
    logger.error(
      `[QUERY ERROR] ${duracion}ms - SQL: ${sql.substring(0, 200)}`,
      error instanceof Error ? error.message : error
    );
    throw error;
  }
}

/**
 * Obtiene estadísticas de queries lentas
 */
export function obtenerEstadisticasQueries(): {
  totalSlowQueries: number;
  promedioDuracion: number;
  maxDuracion: number;
  queriesRecientes: QueryMetrics[];
} {
  if (slowQueries.length === 0) {
    return {
      totalSlowQueries: 0,
      promedioDuracion: 0,
      maxDuracion: 0,
      queriesRecientes: []
    };
  }

  const duraciones = slowQueries.map(q => q.duration);
  const promedio = duraciones.reduce((a, b) => a + b, 0) / duraciones.length;
  const max = Math.max(...duraciones);

  return {
    totalSlowQueries: slowQueries.length,
    promedioDuracion: Math.round(promedio),
    maxDuracion: max,
    queriesRecientes: slowQueries.slice(-10) // Últimas 10 queries lentas
  };
}

/**
 * Limpia el historial de queries lentas
 */
export function limpiarHistorialQueries(): void {
  slowQueries.length = 0;
  logger.info("Historial de queries lentas limpiado");
}

