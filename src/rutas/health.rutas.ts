import type { FastifyPluginAsync } from "fastify";
import { pool } from "../base_datos/pool";
import { obtenerEstadisticasQueries } from "../utilidades/query-logging.utilidad";
import { entorno } from "../configuracion/entorno";
import { cache } from "../utilidades/cache.utilidad";

const healthRutas: FastifyPluginAsync = async (fastify) => {
  // Endpoint para verificar el estado de la conexion a la base de datos
  fastify.get("/db", async (_request, reply) => {
    try {
      if (!pool) {
        return reply.status(503).send({
          connected: false,
          error: "Pool de conexiones no inicializado"
        });
      }

      // Hacer una consulta simple para verificar la conexion
      const connection = await pool.getConnection();
      await connection.ping();
      connection.release();

      return reply.send({
        connected: true,
        message: "Conexion a base de datos exitosa"
      });
    } catch (error) {
      console.error("Error al verificar conexion a BD:", error);
      return reply.status(503).send({
        connected: false,
        error: error instanceof Error ? error.message : "Error desconocido"
      });
    }
  });

  // Endpoint de monitoreo con metricas del sistema
  fastify.get("/metrics", async (_request, reply) => {
    try {
      const stats = obtenerEstadisticasQueries();
      const memUsage = process.memoryUsage();

      // Obtener estadisticas del pool si esta disponible
      let poolStats = null;
      if (pool) {
        try {
          const [rows] = await pool.query('SHOW STATUS WHERE Variable_name IN ("Threads_connected", "Threads_running", "Max_used_connections")');
          poolStats = rows;
        } catch (_error) {
          // Ignorar errores al obtener stats del pool
        }
      }

      return reply.send({
        timestamp: new Date().toISOString(),
        environment: entorno.ambiente,
        uptime: process.uptime(),
        memory: {
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
          rss: Math.round(memUsage.rss / 1024 / 1024),
          external: Math.round(memUsage.external / 1024 / 1024)
        },
        database: {
          poolLimit: entorno.baseDatos.maximoConexiones,
          poolStats: poolStats
        },
        queries: {
          slowQueries: stats.totalSlowQueries,
          avgDuration: stats.promedioDuracion,
          maxDuration: stats.maxDuracion,
          recentSlowQueries: stats.queriesRecientes.map((q: { duration: number; sql: string; timestamp: Date }) => ({
            duration: q.duration,
            sql: q.sql.substring(0, 150),
            timestamp: q.timestamp.toISOString()
          }))
        },
        cache: {
          ...cache.getStats(),
          hitRatio: (cache.getHitRatio() * 100).toFixed(2) + "%"
        }
      });
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : "Error desconocido"
      });
    }
  });

  // Endpoint para limpiar el cache (util despues de actualizaciones de datos)
  fastify.post("/cache/clear", async (_request, reply) => {
    try {
      const statsBefore = cache.getStats();
      cache.clear();

      return reply.send({
        success: true,
        message: "Cache limpiado correctamente",
        entriesCleared: statsBefore.size
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : "Error desconocido"
      });
    }
  });

  // Endpoint para ver el estado del cache
  fastify.get("/cache", async (_request, reply) => {
    try {
      const stats = cache.getStats();

      return reply.send({
        ...stats,
        hitRatio: (cache.getHitRatio() * 100).toFixed(2) + "%"
      });
    } catch (error) {
      return reply.status(500).send({
        error: error instanceof Error ? error.message : "Error desconocido"
      });
    }
  });
};

export default healthRutas;
