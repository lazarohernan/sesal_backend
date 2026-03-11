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

    // Pre-calentar caché con las consultas más pesadas (en background, no bloquea)
    setTimeout(async () => {
      try {
        logger.info("Pre-calentando caché con consultas frecuentes...");
        const base = `http://127.0.0.1:${puerto}`;
        const consultas = [
          fetch(`${base}/api/tablero/anios`),
          fetch(`${base}/api/tablero/resumen`),
          fetch(`${base}/api/pivot/catalogo`),
          fetch(`${base}/api/pivot/consulta`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filters: [], rows: ["CONCEPTO_ORDENADO"], values: [{ field: "TOTAL", aggregation: "SUM" }], limit: 100, includeTotals: true })
          })
        ];
        await Promise.allSettled(consultas);
        logger.info("Caché pre-calentado exitosamente");
      } catch (e) {
        logger.warn("Error pre-calentando caché:", e instanceof Error ? e.message : "desconocido");
      }
    }, 3000);
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
