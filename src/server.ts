import "./tipos/fastify";
import { buildApp } from "./aplicacion";
import { entorno } from "./configuracion";
import { logger } from "./utilidades/registro.utilidad";
import { inicializarPool, pool } from "./base_datos/pool";
import { configuracionBDServicio } from "./servicios/configuracion-bd.servicio";
import { authServicio } from "./servicios/auth.servicio";
import { obtenerIndicadoresTableroEgresos } from "./servicios/egresos-tablero.servicio";

const puerto = entorno.puerto;
const DEFAULT_PREWARM_YEARS = [2025, 2024, 2023, 2022];

const construirAniosPrecalentamiento = () => {
  if (entorno.cache.precalentarAnios.length > 0) {
    return Array.from(new Set(entorno.cache.precalentarAnios));
  }

  return DEFAULT_PREWARM_YEARS;
};

const precalentarCache = async () => {
  const base = `http://127.0.0.1:${puerto}`;
  const signal = AbortSignal.timeout(15_000);

  logger.info("Pre-calentando caché...");

  await Promise.allSettled([
    fetch(`${base}/api/tablero/anios`, { signal }),
    fetch(`${base}/api/tablero/resumen`, { signal }),
    fetch(`${base}/api/pivot/catalogo`, { signal })
  ]);
  logger.info("Caché fase 1 listo (catálogos)");

  const anios = construirAniosPrecalentamiento();
  const concurrencia = entorno.cache.precalentarConcurrencia;

  for (let i = 0; i < anios.length; i += concurrencia) {
    const batch = anios.slice(i, i + concurrencia);
    const consultas = batch.map((anio) =>
      fetch(`${base}/api/pivot/consulta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          filters: [],
          rows: ["CONCEPTO_ORDENADO"],
          values: [{ field: "TOTAL", aggregation: "SUM" }],
          years: [anio],
          limit: 100,
          includeTotals: true
        })
      })
    );

    await Promise.allSettled(consultas);
    logger.info(`Caché pre-calentado: años ${batch.join(", ")}`);
  }

  for (let i = 0; i < anios.length; i += concurrencia) {
    const batch = anios.slice(i, i + concurrencia);
    await Promise.allSettled(
      batch.map((anio) => obtenerIndicadoresTableroEgresos({ anio }))
    );
    logger.info(`Caché de indicadores de egresos pre-calentado: años ${batch.join(", ")}`);
  }

  logger.info(`Caché pre-calentado exitosamente (${anios.length} años)`);
};

const iniciar = async () => {
  try {
    await configuracionBDServicio.cargarConfiguracionPersistida();
    await inicializarPool();
    if (pool) {
      await authServicio.inicializar();
    }
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

    if (entorno.cache.precalentar) {
      setTimeout(() => {
        void precalentarCache().catch((e) => {
          logger.warn("Error pre-calentando caché:", e instanceof Error ? e.message : "desconocido");
        });
      }, entorno.cache.precalentarDelayMs);
    } else {
      logger.info("Pre-calentamiento de caché deshabilitado");
    }
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
