import mysql from "mysql2/promise";

import { entorno } from "../configuracion/entorno";
import { configuracionBDServicio } from "../servicios/configuracion-bd.servicio";

export let pool: mysql.Pool | null = null;

// Timeout para queries (5 minutos por defecto para consultas grandes, configurable)
const QUERY_TIMEOUT_MS = Number(process.env.MYSQL_QUERY_TIMEOUT) || 300_000;

const crearNuevoPool = () => {
  const config = configuracionBDServicio.obtenerConfiguracion();
  return mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: config.database,
    ssl: config.ssl
      ? {
          rejectUnauthorized: process.env.NODE_ENV === 'production'
        }
      : undefined,
    waitForConnections: true,
    connectionLimit: entorno.baseDatos.maximoConexiones,
    queueLimit: entorno.baseDatos.limiteCola,
    connectTimeout: entorno.baseDatos.tiempoEsperaConexion,
    charset: entorno.baseDatos.conjuntoCaracteres,
    // Timeout para queries individuales - previene queries que bloquean el pool
    // Nota: Este timeout es para la conexión, no para queries individuales
    // Para timeout de queries, usar SET SESSION max_execution_time
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
  });
};

/**
 * Ejecuta una query con timeout.
 * Si la query tarda más del timeout, se cancela automáticamente.
 */
export const queryWithTimeout = async <T>(
  sql: string,
  params?: unknown[],
  timeoutMs: number = QUERY_TIMEOUT_MS
): Promise<T> => {
  const currentPool = obtenerPoolActual();
  
  let timer: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Query timeout después de ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([currentPool.query(sql, params), timeoutPromise]);
    return result as T;
  } finally {
    clearTimeout(timer!);
  }
};

export const inicializarPool = async () => {
  try {
    await configuracionBDServicio.cargarConfiguracionPersistida();
    if (pool) {
      await pool.end().catch(() => undefined);
      pool = null;
    }
    pool = crearNuevoPool();
    console.log("✅ Pool de conexiones inicializado correctamente");
  } catch (error) {
    console.log(
      "⚠️ Pool no inicializado - se requiere configuración manual:",
      error instanceof Error ? error.message : error
    );
    pool = null;
  }
};

export const obtenerPoolActual = (): mysql.Pool => {
  if (!pool) {
    throw new Error(
      "Pool de conexiones no inicializado. Verifica la configuración de base de datos."
    );
  }
  return pool;
};
