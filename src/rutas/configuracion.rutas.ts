import { Router } from 'express'
import { testDatabaseConnection, getDatabaseInfo, saveDatabaseConfig, getSavedDatabaseConfig, deleteDatabaseConfig } from '../controladores/configuracion.controlador'

const router = Router()

// Ruta para probar conexión a base de datos
router.post('/test-db-connection', testDatabaseConnection)

// Ruta para obtener información de la base de datos
router.post('/db-info', getDatabaseInfo)

// Ruta para guardar configuración de base de datos
router.post('/save-db-config', saveDatabaseConfig)

// Ruta para obtener configuracción guardada de base de datos
router.get('/get-saved-db-config', getSavedDatabaseConfig)
router.post('/get-saved-db-config', getSavedDatabaseConfig) // Mantener POST por compatibilidad

// Ruta para eliminar configuracción de base de datos
router.post('/delete-db-config', deleteDatabaseConfig)

export default router
