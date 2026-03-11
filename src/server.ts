import { buildApp } from "./aplicacion";
import { entorno } from "./configuracion";
import { logger } from "./utilidades/registro.utilidad";
import { inicializarPool, pool } from "./base_datos/pool";
import { configuracionBDServicio } from "./servicios/configuracion-bd.servicio";

const puerto = entorno.puerto;

const iniciar = async () => {
  try {
    await configuracionBDServicio.cargarConfiguracionPersistida();
    await inicializarPool();
    logger.info("Configuracion de BD lista");
  } catch (error) {
    logger.warn(
      "No se pudo inicializar el pool automaticamente:",
      error instanceof Error ? error.message : "Error desconocido"
    );
  }

  const app = await buildApp();

  try {
    await app.listen({ port: puerto, host: "0.0.0.0" });
    logger.info(`Servidor BI SESAL escuchando en puerto ${puerto}`);
  } catch (error) {
    logger.error("Error al iniciar el servidor", error);
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    logger.info(`Recibida senal ${signal}. Cerrando servidor...`);
    await app.close();
    if (pool) {
      await pool.end();
      logger.info("Pool de base de datos cerrado.");
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

iniciar();

process.on("unhandledRejection", (razon) => {
  console.error("Promesa no manejada", razon);
});
process.on("uncaughtException", (error) => {
  console.error("Excepcion no manejada", error);
  process.exit(1);
});
