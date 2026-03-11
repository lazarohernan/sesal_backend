import type { FastifyPluginAsync } from "fastify";
import { testDatabaseConnection, getDatabaseInfo, saveDatabaseConfig, getSavedDatabaseConfig, deleteDatabaseConfig } from "../controladores/configuracion.controlador";

const configuracionRutas: FastifyPluginAsync = async (fastify) => {
  // Ruta para probar conexion a base de datos
  fastify.post("/test-db-connection", testDatabaseConnection);

  // Ruta para obtener informacion de la base de datos
  fastify.post("/db-info", getDatabaseInfo);

  // Ruta para guardar configuracion de base de datos
  fastify.post("/save-db-config", saveDatabaseConfig);

  // Ruta para obtener configuracion guardada de base de datos
  fastify.get("/get-saved-db-config", getSavedDatabaseConfig);
  fastify.post("/get-saved-db-config", getSavedDatabaseConfig); // Mantener POST por compatibilidad

  // Ruta para eliminar configuracion de base de datos
  fastify.post("/delete-db-config", deleteDatabaseConfig);
};

export default configuracionRutas;
