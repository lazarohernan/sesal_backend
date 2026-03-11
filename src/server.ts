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

    // Pre-calentar caché con todas las consultas por año (en background, no bloquea)
    setTimeout(async () => {
      try {
        logger.info("Pre-calentando caché...");
        const base = `http://127.0.0.1:${puerto}`;

        // Fase 1: endpoints ligeros
        await Promise.allSettled([
          fetch(`${base}/api/tablero/anios`),
          fetch(`${base}/api/tablero/resumen`),
          fetch(`${base}/api/pivot/catalogo`)
        ]);
        logger.info("Caché fase 1 listo (catálogos)");

        // Fase 2: consulta CONCEPTO_ORDENADO para cada año (de 2 en 2 para no saturar RDS)
        const anios = [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011, 2010, 2009, 2008];
        for (let i = 0; i < anios.length; i += 2) {
          const batch = anios.slice(i, i + 2);
          const consultas = batch.map(anio =>
            fetch(`${base}/api/pivot/consulta`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ filters: [], rows: ["CONCEPTO_ORDENADO"], values: [{ field: "TOTAL", aggregation: "SUM" }], years: [anio], limit: 100, includeTotals: true })
            })
          );
          await Promise.allSettled(consultas);
          logger.info(`Caché pre-calentado: años ${batch.join(", ")}`);
        }

        logger.info("Caché pre-calentado exitosamente (18 años)");
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
