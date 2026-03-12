import { randomUUID } from "node:crypto";

import { obtenerPoolActual } from "../base_datos/pool";
import { logger } from "../utilidades/registro.utilidad";
import type { PivotQueryPayload, PivotQueryResult } from "./pivot.servicio";

type PivotExecutionMode = "sync" | "async";
type PivotLogStatus = "queued" | "processing" | "completed" | "failed";

interface PivotLogContext {
  payload: PivotQueryPayload;
  executionMode: PivotExecutionMode;
  requestId?: string;
  clientIp?: string;
  jobId?: string;
}

interface PivotLogCompletion {
  status: Exclude<PivotLogStatus, "queued" | "processing">;
  durationMs: number;
  result?: PivotQueryResult;
  errorMessage?: string;
}

let ensureTablePromise: Promise<void> | null = null;

const ensurePivotQueryLogTable = async () => {
  if (!ensureTablePromise) {
    ensureTablePromise = (async () => {
      const pool = obtenerPoolActual();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS pivot_query_logs (
          id CHAR(36) PRIMARY KEY,
          job_id CHAR(36) NULL,
          execution_mode VARCHAR(16) NOT NULL,
          status VARCHAR(16) NOT NULL,
          query_signature VARCHAR(512) NOT NULL,
          years_count SMALLINT NOT NULL DEFAULT 0,
          years_list VARCHAR(255) NOT NULL DEFAULT '',
          rows_key VARCHAR(255) NOT NULL DEFAULT '',
          columns_key VARCHAR(255) NOT NULL DEFAULT '',
          values_key VARCHAR(255) NOT NULL DEFAULT '',
          filters_count SMALLINT NOT NULL DEFAULT 0,
          payload_json JSON NOT NULL,
          result_rows INT NULL,
          duration_ms INT NULL,
          error_message TEXT NULL,
          request_id VARCHAR(64) NULL,
          client_ip VARCHAR(64) NULL,
          created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          started_at DATETIME(3) NULL,
          completed_at DATETIME(3) NULL,
          updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
          KEY idx_pivot_query_logs_created_at (created_at),
          KEY idx_pivot_query_logs_signature (query_signature),
          KEY idx_pivot_query_logs_status (status),
          KEY idx_pivot_query_logs_job_id (job_id),
          KEY idx_pivot_query_logs_duration (duration_ms)
        )
      `);
    })().catch((error) => {
      ensureTablePromise = null;
      throw error;
    });
  }

  return ensureTablePromise;
};

const normalizePayload = (payload: PivotQueryPayload) => ({
  year: payload.year ?? null,
  years: [...(payload.years ?? [])].sort((a, b) => a - b),
  rows: [...(payload.rows ?? [])],
  columns: [...(payload.columns ?? [])],
  values: [...(payload.values ?? [])]
    .map((value) => ({
      field: value.field,
      aggregation: value.aggregation ?? "SUM"
    }))
    .sort((a, b) => `${a.field}:${a.aggregation}`.localeCompare(`${b.field}:${b.aggregation}`)),
  filters: [...(payload.filters ?? [])]
    .map((filter) => ({
      field: filter.field,
      values: [...(filter.values ?? [])].map((value) => String(value)).sort()
    }))
    .sort((a, b) => a.field.localeCompare(b.field)),
  limit: payload.limit ?? null,
  includeTotals: payload.includeTotals ?? false
});

const summarizePayload = (payload: PivotQueryPayload) => {
  const normalized = normalizePayload(payload);
  const years = normalized.years.length
    ? normalized.years
    : normalized.year != null
      ? [normalized.year]
      : [];

  return {
    normalized,
    signature: JSON.stringify(normalized),
    yearsCount: years.length,
    yearsList: years.join(","),
    rowsKey: normalized.rows.join("|"),
    columnsKey: normalized.columns.join("|"),
    valuesKey: normalized.values.map((value) => `${value.field}:${value.aggregation}`).join("|"),
    filtersCount: normalized.filters.length
  };
};

export const registrarInicioConsultaPivot = async ({
  payload,
  executionMode,
  requestId,
  clientIp,
  jobId
}: PivotLogContext): Promise<string | null> => {
  try {
    await ensurePivotQueryLogTable();
    const pool = obtenerPoolActual();
    const logId = randomUUID();
    const summary = summarizePayload(payload);
    const startedAt = executionMode === "sync" ? new Date() : null;

    await pool.query(
      `
        INSERT INTO pivot_query_logs (
          id, job_id, execution_mode, status, query_signature,
          years_count, years_list, rows_key, columns_key, values_key, filters_count,
          payload_json, request_id, client_ip, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?)
      `,
      [
        logId,
        jobId ?? null,
        executionMode,
        executionMode === "sync" ? "processing" : "queued",
        summary.signature,
        summary.yearsCount,
        summary.yearsList,
        summary.rowsKey,
        summary.columnsKey,
        summary.valuesKey,
        summary.filtersCount,
        JSON.stringify(summary.normalized),
        requestId ?? null,
        clientIp ?? null,
        startedAt
      ]
    );

    return logId;
  } catch (error) {
    logger.warn("No se pudo registrar inicio de consulta pivot", error);
    return null;
  }
};

export const marcarConsultaPivotProcesando = async (logId: string | null) => {
  if (!logId) return;

  try {
    await ensurePivotQueryLogTable();
    const pool = obtenerPoolActual();
    await pool.query(
      `
        UPDATE pivot_query_logs
        SET status = 'processing',
            started_at = COALESCE(started_at, CURRENT_TIMESTAMP(3))
        WHERE id = ?
      `,
      [logId]
    );
  } catch (error) {
    logger.warn("No se pudo marcar consulta pivot como processing", error);
  }
};

export const registrarFinConsultaPivot = async (
  logId: string | null,
  completion: PivotLogCompletion
) => {
  if (!logId) return;

  try {
    await ensurePivotQueryLogTable();
    const pool = obtenerPoolActual();
    await pool.query(
      `
        UPDATE pivot_query_logs
        SET status = ?,
            duration_ms = ?,
            result_rows = ?,
            error_message = ?,
            completed_at = CURRENT_TIMESTAMP(3),
            started_at = COALESCE(started_at, CURRENT_TIMESTAMP(3))
        WHERE id = ?
      `,
      [
        completion.status,
        completion.durationMs,
        completion.result?.datos.length ?? null,
        completion.errorMessage ?? null,
        logId
      ]
    );
  } catch (error) {
    logger.warn("No se pudo registrar fin de consulta pivot", error);
  }
};
