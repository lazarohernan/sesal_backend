import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { logger } from "./registro.utilidad";

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const existing = req.headers["x-request-id"];
  const id = (Array.isArray(existing) ? existing[0] : existing) || randomUUID();
  (req as any).requestId = id;
  res.setHeader("x-request-id", id);
  next();
};

export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({
    status: 404,
    codigo: "RUTA_NO_ENCONTRADA",
    mensaje: "Ruta no encontrada",
    path: req.originalUrl,
    requestId: (req as any).requestId
  });
};

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const requestId = (req as any).requestId;

  // Errores de JSON inválido
  if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
    logger.warn("JSON inválido recibido", { requestId, detalle: String(err?.message || err) });
    return res.status(400).json({
      status: 400,
      codigo: "JSON_INVALIDO",
      mensaje: "El cuerpo de la solicitud no es un JSON válido.",
      requestId
    });
  }

  const status = Number(err?.status || err?.statusCode || 500);
  const codigo = String(err?.code || err?.codigo || (status === 500 ? "ERROR_INTERNO" : "ERROR"));
  const mensaje = String(err?.message || "Error procesando la solicitud");

  if (status >= 500) {
    logger.error(`Error ${status}`, { requestId, codigo, mensaje, stack: err?.stack });
  } else {
    logger.warn(`Error ${status}`, { requestId, codigo, mensaje });
  }

  const cuerpo: any = { status, codigo, mensaje, requestId };
  // En desarrollo, incluye detalles
  if (process.env.NODE_ENV !== "production" && err?.stack) {
    cuerpo.detalle = err.stack;
  }

  return res.status(status).json(cuerpo);
};

