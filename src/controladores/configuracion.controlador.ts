import { Request, Response } from "express";
import mysql from "mysql2/promise";

import { configuracionBDServicio, type DatabaseConfig } from "../servicios/configuracion-bd.servicio";
import { inicializarPool, pool as poolActual } from "../base_datos/pool";

const sanitizarConfig = (entrada: Partial<DatabaseConfig>): DatabaseConfig => ({
  host: entrada.host?.trim() ?? "",
  port: Number.isFinite(entrada.port) ? Number(entrada.port) : 3306,
  username: entrada.username?.trim() ?? "",
  password: entrada.password ?? "",
  database: entrada.database?.trim() ?? "",
  ssl: Boolean(entrada.ssl)
});

const validarConfig = (config: DatabaseConfig) =>
  Boolean(config.host && config.username && config.password !== undefined && config.database);

const construirConnectionConfig = (config: DatabaseConfig): mysql.ConnectionOptions => ({
  host: config.host,
  port: config.port || 3306,
  user: config.username,
  password: config.password,
  database: config.database,
  ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
  connectTimeout: 10000
});

const traducirErrorConexion = (error: unknown, database?: string) => {
  if (!(error instanceof Error)) return "Error desconocido al conectar con la base de datos";
  if (error.message.includes("ECONNREFUSED")) {
    return "No se pudo establecer conexión con el servidor MySQL. Verifica host/puerto.";
  }
  if (error.message.includes("ER_ACCESS_DENIED_ERROR")) {
    return "Credenciales incorrectas. Revisa usuario y contraseña.";
  }
  if (error.message.includes("ER_BAD_DB_ERROR")) {
    return `La base de datos "${database ?? ""}" no existe o no es accesible.`;
  }
  if (error.message.includes("ETIMEDOUT")) {
    return "Timeout de conexión. El servidor no respondió a tiempo.";
  }
  return error.message;
};

export const testDatabaseConnection = async (req: Request, res: Response) => {
  const config = sanitizarConfig(req.body ?? {});

  if (!validarConfig(config)) {
    return res.status(400).json({
      success: false,
      error: "Faltan campos requeridos: host, username, password, database"
    });
  }

  try {
    const connection = await mysql.createConnection(construirConnectionConfig(config));
    const [rows] = await connection.execute("SELECT 1 as test");
    await connection.end();

    return res.json({
      success: true,
      message: `Conexión exitosa a "${config.database}" en ${config.host}:${config.port}`,
      details: rows
    });
  } catch (error) {
    console.error("Error testing database connection:", error);
    return res.status(400).json({
      success: false,
      error: traducirErrorConexion(error, config.database)
    });
  }
};

export const getDatabaseInfo = async (req: Request, res: Response) => {
  const config = sanitizarConfig(req.body ?? {});
  if (!validarConfig(config)) {
    return res.status(400).json({
      success: false,
      error: "Faltan campos requeridos"
    });
  }

  try {
    const connection = await mysql.createConnection(construirConnectionConfig(config));
    const [tablas] = await connection.execute(
      `
      SELECT 
        table_name,
        table_rows,
        ROUND(((data_length + index_length) / 1024 / 1024), 2) AS size_mb
      FROM information_schema.tables 
      WHERE table_schema = ?
      ORDER BY table_name
    `,
      [config.database]
    );
    const [version] = await connection.execute("SELECT VERSION() as version");
    await connection.end();

    return res.json({
      success: true,
      database: {
        name: config.database,
        version: (version as any)[0]?.version,
        tables: tablas,
        tableCount: (tablas as any[]).length
      }
    });
  } catch (error) {
    console.error("Error getting database info:", error);
    return res.status(400).json({
      success: false,
      error: traducirErrorConexion(error, config.database)
    });
  }
};

export const saveDatabaseConfig = async (req: Request, res: Response) => {
  const config = sanitizarConfig(req.body ?? {});

  if (!validarConfig(config)) {
    return res.status(400).json({
      success: false,
      error: "Faltan campos requeridos: host, username, password, database"
    });
  }

  try {
    const connection = await mysql.createConnection(construirConnectionConfig(config));
    await connection.execute("SELECT 1");
    await connection.end();

    await configuracionBDServicio.actualizarConfiguracion(config);
    await inicializarPool();

    return res.json({
      success: true,
      message: "Configuración guardada exitosamente",
      config: {
        host: config.host,
        port: config.port,
        database: config.database,
        username: config.username
      }
    });
  } catch (error) {
    console.error("Error saving database config:", error);
    return res.status(400).json({
      success: false,
      error: traducirErrorConexion(error, config.database)
    });
  }
};

export const getSavedDatabaseConfig = async (_req: Request, res: Response) => {
  try {
    await configuracionBDServicio.cargarConfiguracionPersistida();
    const config = configuracionBDServicio.obtenerConfiguracionPersistidaSanitizada();

    return res.json({
      success: true,
      config
    });
  } catch (error) {
    console.error("Error getting saved database config:", error);
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Error al obtener la configuración guardada"
    });
  }
};

export const deleteDatabaseConfig = async (_req: Request, res: Response) => {
  try {
    await configuracionBDServicio.limpiarConfiguracionPersistida();
    if (poolActual) {
      await poolActual.end().catch(() => undefined);
    }
    await inicializarPool();
    return res.json({
      success: true,
      message: "Configuración eliminada exitosamente"
    });
  } catch (error) {
    console.error("Error deleting database config:", error);
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Error al eliminar la configuración"
    });
  }
};
