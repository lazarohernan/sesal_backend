import "./tipos/fastify";
import { buildApp } from "./aplicacion";
import { entorno } from "./configuracion";
import { logger } from "./utilidades/registro.utilidad";
import { inicializarPool, pool } from "./base_datos/pool";
import { configuracionBDServicio } from "./servicios/configuracion-bd.servicio";
import { authServicio } from "./servicios/auth.servicio";
import { obtenerIndicadoresTableroEgresos } from "./servicios/egresos-tablero.servicio";
import {
  ejecutarConsultaPivot,
  obtenerAniosDisponibles,
  obtenerCatalogoPivot
} from "./servicios/pivot.servicio";
import { obtenerResumenTablero } from "./servicios/tablero.servicio";

const puerto = entorno.puerto;
const DEFAULT_PREWARM_YEARS = Array.from({ length: 18 }, (_, index) => 2025 - index);
let prewarmTimer: NodeJS.Timeout | null = null;
let detenerPrewarm = false;

const construirAniosPrecalentamiento = () => {
  if (entorno.cache.precalentarAnios.length > 0) {
    return Array.from(new Set(entorno.cache.precalentarAnios));
  }

  return DEFAULT_PREWARM_YEARS;
};

const precalentarCache = async () => {
  logger.info("Pre-calentando caché...");

  await Promise.allSettled([
    obtenerAniosDisponibles(),
    obtenerResumenTablero(),
    obtenerCatalogoPivot()
  ]);
  logger.info("Caché fase 1 listo (catálogos)");

  const anios = construirAniosPrecalentamiento();
  const concurrencia = entorno.cache.precalentarConcurrencia;

  for (let i = 0; i < anios.length; i += concurrencia) {
    if (detenerPrewarm) {
      logger.info("Pre-calentamiento de caché detenido por apagado del servidor");
      return;
    }

    const batch = anios.slice(i, i + concurrencia);
    const consultas = batch.flatMap((anio) => [
      obtenerResumenTablero(anio),
      ejecutarConsultaPivot({
        filters: [],
        rows: ["CONCEPTO_ORDENADO"],
        values: [{ field: "TOTAL", aggregation: "SUM" }],
        years: [anio],
        limit: 100,
        includeTotals: true
      })
    ]);

    await Promise.allSettled(consultas);
    logger.info(`Caché pre-calentado: años ${batch.join(", ")}`);
  }

  if (entorno.cache.precalentarEgresos) {
    for (let i = 0; i < anios.length; i += concurrencia) {
      if (detenerPrewarm) {
        logger.info("Pre-calentamiento de egresos detenido por apagado del servidor");
        return;
      }

      const batch = anios.slice(i, i + concurrencia);
      await Promise.allSettled(
        batch.map((anio) => obtenerIndicadoresTableroEgresos({ anio }))
      );
      logger.info(`Caché de indicadores de egresos pre-calentado: años ${batch.join(", ")}`);
    }
  } else {
    logger.info("Pre-calentamiento de indicadores de egresos deshabilitado");
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
      prewarmTimer = setTimeout(() => {
        void precalentarCache().catch((e) => {
          logger.warn("Error pre-calentando caché:", e instanceof Error ? e.message : "desconocido");
        });
      }, entorno.cache.precalentarDelayMs);
      prewarmTimer.unref();
    } else {
      logger.info("Pre-calentamiento de caché deshabilitado");
    }
  } catch (error) {
    logger.error("Error al iniciar el servidor", error);
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    logger.info(`Recibida senal ${signal}. Cerrando servidor...`);
    detenerPrewarm = true;
    if (prewarmTimer) {
      clearTimeout(prewarmTimer);
      prewarmTimer = null;
    }
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
