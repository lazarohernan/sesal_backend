import type { FastifyRequest, FastifyReply } from "fastify";
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

export const establecerConfiguracionBD = async (request: FastifyRequest, _reply: FastifyReply) => {
  const configHeader = typeof request.headers["x-db-config"] === "string" ? request.headers["x-db-config"] : undefined;
  const bodyConfig = parseConfig((request.body as any)?.dbConfig);

  if (configHeader) {
    try {
      const parsed = JSON.parse(configHeader);
      const config = parseConfig(parsed);
      if (config) {
        configuracionBDServicio.setConfiguracionPersonalizada(config);
      }
    } catch (error) {
      console.warn("Error al parsear configuracion de BD desde header:", error);
    }
  } else if (bodyConfig) {
    configuracionBDServicio.setConfiguracionPersonalizada(bodyConfig);
  }
};

export const requerirConfiguracionBD = async (request: FastifyRequest, reply: FastifyReply) => {
  const rutasExcluidas = ["/api/test-db-connection", "/api/db-info", "/api/get-saved-db-config"];
  if (rutasExcluidas.some((ruta) => request.url.includes(ruta))) {
    return;
  }

  try {
    await configuracionBDServicio.cargarConfiguracionPersistida();
    const config = configuracionBDServicio.obtenerConfiguracion();
    if (!config?.host) {
      return reply.status(400).send({
        success: false,
        error: "Configuracion de base de datos requerida",
        message: "Configura la conexion a la base de datos antes de continuar",
        requiresConfig: true
      });
    }
  } catch (error) {
    console.error("Error validando configuracion de BD:", error);
    return reply.status(500).send({
      success: false,
      error: "No se pudo validar la configuracion de base de datos",
      requiresConfig: true
    });
  }
};

export const logConfiguracionBD = async (_request: FastifyRequest, _reply: FastifyReply) => {
  try {
    const info = configuracionBDServicio.obtenerInfoConfiguracion();
    if (process.env.NODE_ENV === "desarrollo" || process.env.NODE_ENV === "development") {
      console.log(
        `BD Config: ${info.database}@${info.host}:${info.port} ${info.esPersonalizada ? "(Personalizada)" : "(Entorno)"}`
      );
    }
  } catch (error) {
    console.warn("No se pudo obtener informacion de configuracion de BD:", error);
  }
};
