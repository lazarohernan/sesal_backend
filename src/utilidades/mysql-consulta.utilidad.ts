import type { RowDataPacket } from "mysql2";

import { obtenerPoolActual } from "../base_datos/pool";

export class ConsultaAbortadaError extends Error {
  readonly code = "CONSULTA_ABORTADA";
  readonly statusCode = 499;

  constructor(mensaje = "La consulta fue cancelada") {
    super(mensaje);
    this.name = "ConsultaAbortadaError";
  }
}

const obtenerThreadId = (connection: { threadId?: number; connection?: { threadId?: number } }): number | undefined =>
  connection.threadId ?? connection.connection?.threadId;

const esErrorPorTimeoutOAbort = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const codigo = "code" in error ? String(error.code) : "";
  const errno = "errno" in error ? Number(error.errno) : 0;
  const mensaje = "message" in error ? String(error.message).toLowerCase() : "";
  return (
    errno === 3024 ||
    errno === 1317 ||
    codigo === "ER_QUERY_TIMEOUT" ||
    codigo === "ER_QUERY_INTERRUPTED" ||
    mensaje.includes("max_execution_time") ||
    mensaje.includes("query execution was interrupted")
  );
};

export const consultarSql = async <T extends RowDataPacket[] = RowDataPacket[]>(
  sql: string,
  parametros: Array<string | number> = [],
  opciones: { signal?: AbortSignal; maxExecutionTimeMs?: number } = {}
): Promise<T> => {
  const { signal, maxExecutionTimeMs } = opciones;
  if (signal?.aborted) {
    throw new ConsultaAbortadaError();
  }

  const pool = obtenerPoolActual();
  const connection = await pool.getConnection();
  const threadId = obtenerThreadId(connection);
  let abortada = false;
  let conexionViva = true;

  const cancelarEnMysql = async () => {
    abortada = true;
    if (threadId) {
      try {
        await pool.query(`KILL QUERY ${Number(threadId)}`);
        return;
      } catch {
        // Si no hay privilegio KILL, se destruye la conexión del pool.
      }
    }
    conexionViva = false;
    connection.destroy();
  };

  const alAbortar = () => {
    void cancelarEnMysql();
  };

  signal?.addEventListener("abort", alAbortar, { once: true });

  try {
    if (maxExecutionTimeMs && maxExecutionTimeMs > 0) {
      const tiempoMs = Math.max(1, Math.floor(maxExecutionTimeMs));
      await connection.query(`SET SESSION max_execution_time = ${tiempoMs}`);
    }

    const [rows] = await connection.query<T>(sql, parametros);
    if (abortada || signal?.aborted) {
      throw new ConsultaAbortadaError();
    }
    return rows;
  } catch (error) {
    if (abortada || signal?.aborted || esErrorPorTimeoutOAbort(error)) {
      if (signal?.aborted || abortada) {
        throw new ConsultaAbortadaError();
      }
      const timeoutError = new Error(
        "La consulta superó el tiempo máximo de ejecución. Reduce años, filtros o usa el reporte asíncrono."
      );
      (timeoutError as Error & { statusCode: number; code: string }).statusCode = 504;
      (timeoutError as Error & { statusCode: number; code: string }).code = "CONSULTA_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", alAbortar);
    if (conexionViva) {
      try {
        if (maxExecutionTimeMs && maxExecutionTimeMs > 0) {
          await connection.query("SET SESSION max_execution_time = 0");
        }
      } catch {
        conexionViva = false;
        connection.destroy();
      }
    }
    if (conexionViva) {
      connection.release();
    }
  }
};
