import type { NextFunction, Request, Response } from "express";

import { configuracionBDServicio, type DatabaseConfig } from "../servicios/configuracion-bd.servicio";

const parseConfig = (valor: unknown): DatabaseConfig | null => {
  if (!valor || typeof valor !== "object") return null;
  const config = valor as Partial<DatabaseConfig>;
  if (!config.host || !config.username || !config.database) return null;
  return {
    host: String(config.host),
    username: String(config.username),
    database: String(config.database),
    password: typeof config.password === "string" ? config.password : "",
    port: Number.isFinite(config.port) ? Number(config.port) : 3306,
    ssl: Boolean(config.ssl)
  };
};

export const establecerConfiguracionBD = (req: Request, _res: Response, next: NextFunction) => {
  const configHeader = typeof req.headers["x-db-config"] === "string" ? req.headers["x-db-config"] : undefined;
  const bodyConfig = parseConfig(req.body?.dbConfig);

  if (configHeader) {
    try {
      const parsed = JSON.parse(configHeader);
      const config = parseConfig(parsed);
      if (config) {
        configuracionBDServicio.setConfiguracionPersonalizada(config);
      }
    } catch (error) {
      console.warn("⚠️ Error al parsear configuración de BD desde header:", error);
    }
  } else if (bodyConfig) {
    configuracionBDServicio.setConfiguracionPersonalizada(bodyConfig);
  }

  next();
};

export const requerirConfiguracionBD = async (req: Request, res: Response, next: NextFunction) => {
  const rutasExcluidas = ["/api/test-db-connection", "/api/db-info", "/api/get-saved-db-config"];
  if (rutasExcluidas.some((ruta) => req.path.includes(ruta))) {
    return next();
  }

  try {
    await configuracionBDServicio.cargarConfiguracionPersistida();
    const config = configuracionBDServicio.obtenerConfiguracion();
    if (!config?.host) {
      return res.status(400).json({
        success: false,
        error: "Configuración de base de datos requerida",
        message: "Configura la conexión a la base de datos antes de continuar",
        requiresConfig: true
      });
    }
    return next();
  } catch (error) {
    console.error("Error validando configuración de BD:", error);
    return res.status(500).json({
      success: false,
      error: "No se pudo validar la configuración de base de datos",
      requiresConfig: true
    });
  }
};

export const limpiarConfiguracionBD = async (_req: Request, _res: Response, next: NextFunction) => {
  await configuracionBDServicio.cargarConfiguracionPersistida();
  next();
};

export const logConfiguracionBD = (_req: Request, _res: Response, next: NextFunction) => {
  try {
    const info = configuracionBDServicio.obtenerInfoConfiguracion();
    if (process.env.NODE_ENV === "desarrollo" || process.env.NODE_ENV === "development") {
      console.log(
        `🗄️ BD Config: ${info.database}@${info.host}:${info.port} ${info.esPersonalizada ? "(Personalizada)" : "(Entorno)"}`
      );
    }
  } catch (error) {
    console.warn("⚠️ No se pudo obtener información de configuración de BD:", error);
  }
  next();
};
