import { randomUUID } from "node:crypto";

import { entorno } from "../configuracion";
import type { PivotQueryPayload, PivotQueryResult } from "./pivot.servicio";
import { ejecutarConsultaPivot } from "./pivot.servicio";
import { logger } from "../utilidades/registro.utilidad";

export type PivotJobStatus = "queued" | "processing" | "completed" | "failed";

interface PivotJobRecord {
  id: string;
  signature: string;
  payload: PivotQueryPayload;
  status: PivotJobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: PivotQueryResult;
  error?: string;
}

export interface PivotJobResponse {
  jobId: string;
  status: PivotJobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  pollAfterMs: number;
  queuePosition?: number;
  resultado?: PivotQueryResult;
  error?: string;
}

const jobs = new Map<string, PivotJobRecord>();
const signatureToJob = new Map<string, string>();
const queue: string[] = [];

let activeWorkers = 0;

const cleanupExpiredJobs = () => {
  const ttlMs = entorno.trabajos.pivotResultadoTtlMs;
  const now = Date.now();

  for (const [jobId, job] of jobs.entries()) {
    const reference = job.completedAt ?? job.createdAt;
    if (now - new Date(reference).getTime() > ttlMs) {
      jobs.delete(jobId);
      if (signatureToJob.get(job.signature) === jobId) {
        signatureToJob.delete(job.signature);
      }
    }
  }
};

const cleanupInterval = setInterval(cleanupExpiredJobs, 15 * 60 * 1000);
cleanupInterval.unref();

const normalizePayload = (payload: PivotQueryPayload) => ({
  year: payload.year ?? null,
  years: [...(payload.years ?? [])].sort((a, b) => a - b),
  rows: [...(payload.rows ?? [])].sort(),
  columns: [...(payload.columns ?? [])].sort(),
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

const payloadSignature = (payload: PivotQueryPayload) => JSON.stringify(normalizePayload(payload));

const queuePosition = (jobId: string) => {
  const index = queue.indexOf(jobId);
  return index >= 0 ? index + 1 : undefined;
};

const toResponse = (job: PivotJobRecord): PivotJobResponse => ({
  jobId: job.id,
  status: job.status,
  createdAt: job.createdAt,
  startedAt: job.startedAt,
  completedAt: job.completedAt,
  pollAfterMs: entorno.trabajos.pivotPollMs,
  queuePosition: job.status === "queued" ? queuePosition(job.id) : undefined,
  resultado: job.status === "completed" ? job.result : undefined,
  error: job.status === "failed" ? job.error : undefined
});

const processQueue = () => {
  while (activeWorkers < entorno.trabajos.pivotConcurrencia && queue.length > 0) {
    const jobId = queue.shift();
    if (!jobId) return;

    const job = jobs.get(jobId);
    if (!job || job.status !== "queued") {
      continue;
    }

    activeWorkers += 1;
    job.status = "processing";
    job.startedAt = new Date().toISOString();

    void ejecutarConsultaPivot(job.payload)
      .then((result) => {
        job.status = "completed";
        job.result = result;
        job.completedAt = new Date().toISOString();
      })
      .catch((error) => {
        job.status = "failed";
        job.error = error instanceof Error ? error.message : "Error procesando reporte";
        job.completedAt = new Date().toISOString();
        logger.error("Error procesando job pivot", { jobId: job.id, error: job.error });
      })
      .finally(() => {
        activeWorkers = Math.max(0, activeWorkers - 1);
        processQueue();
      });
  }
};

export const crearPivotJob = (payload: PivotQueryPayload): PivotJobResponse => {
  cleanupExpiredJobs();

  const signature = payloadSignature(payload);
  const existingJobId = signatureToJob.get(signature);
  if (existingJobId) {
    const existingJob = jobs.get(existingJobId);
    if (existingJob && existingJob.status !== "failed") {
      return toResponse(existingJob);
    }
  }

  const pendingJobs = queue.length + activeWorkers;
  if (pendingJobs >= entorno.trabajos.pivotMaxEnCola) {
    const error = new Error("La cola de reportes pesados está llena. Intenta nuevamente en unos minutos.");
    (error as Error & { statusCode: number; code: string }).statusCode = 503;
    (error as Error & { statusCode: number; code: string }).code = "COLA_PIVOT_LLENA";
    throw error;
  }

  const job: PivotJobRecord = {
    id: randomUUID(),
    signature,
    payload,
    status: "queued",
    createdAt: new Date().toISOString()
  };

  jobs.set(job.id, job);
  signatureToJob.set(signature, job.id);
  queue.push(job.id);
  processQueue();

  return toResponse(job);
};

export const obtenerPivotJob = (jobId: string): PivotJobResponse | null => {
  cleanupExpiredJobs();
  const job = jobs.get(jobId);
  return job ? toResponse(job) : null;
};
