import { Router, Request, Response } from 'express';
import { pool } from '../base_datos/pool';
import { obtenerEstadisticasQueries } from '../utilidades/query-logging.utilidad';
import { entorno } from '../configuracion/entorno';

const router = Router();

// Endpoint para verificar el estado de la conexión a la base de datos
router.get('/db', async (_req: Request, res: Response) => {
  try {
    if (!pool) {
      return res.status(503).json({
        connected: false,
        error: 'Pool de conexiones no inicializado'
      });
    }

    // Hacer una consulta simple para verificar la conexión
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();

    return res.json({
      connected: true,
      message: 'Conexión a base de datos exitosa'
    });
  } catch (error) {
    console.error('Error al verificar conexión a BD:', error);
    return res.status(503).json({
      connected: false,
      error: error instanceof Error ? error.message : 'Error desconocido'
    });
  }
});

// Endpoint de monitoreo con métricas del sistema
router.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const stats = obtenerEstadisticasQueries();
    const memUsage = process.memoryUsage();
    
    // Obtener estadísticas del pool si está disponible
    let poolStats = null;
    if (pool) {
      try {
        const [rows] = await pool.query('SHOW STATUS WHERE Variable_name IN ("Threads_connected", "Threads_running", "Max_used_connections")');
        poolStats = rows;
      } catch (error) {
        // Ignorar errores al obtener stats del pool
      }
    }

    return res.json({
      timestamp: new Date().toISOString(),
      environment: entorno.ambiente,
      uptime: process.uptime(),
      memory: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        rss: Math.round(memUsage.rss / 1024 / 1024), // MB
        external: Math.round(memUsage.external / 1024 / 1024) // MB
      },
      database: {
        poolLimit: entorno.baseDatos.maximoConexiones,
        poolStats: poolStats
      },
      queries: {
        slowQueries: stats.totalSlowQueries,
        avgDuration: stats.promedioDuracion,
        maxDuration: stats.maxDuracion,
        recentSlowQueries: stats.queriesRecientes.map(q => ({
          duration: q.duration,
          sql: q.sql.substring(0, 150),
          timestamp: q.timestamp.toISOString()
        }))
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Error desconocido'
    });
  }
});

export default router;

