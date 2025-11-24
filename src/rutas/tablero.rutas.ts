import { Router } from "express";

import {
  obtenerAniosDisponiblesControlador,
  obtenerMapaHondurasControlador,
  obtenerResumenControlador
} from "../controladores/tablero.controlador";
import { establecerConfiguracionBD, requerirConfiguracionBD, limpiarConfiguracionBD, logConfiguracionBD } from "../middleware/configuracion-bd.middleware";

const router = Router();

// Aplicar middleware de configuración a todas las rutas
router.use(establecerConfiguracionBD);
router.use(logConfiguracionBD);
router.use(requerirConfiguracionBD);
router.use(limpiarConfiguracionBD);

router.get("/resumen", obtenerResumenControlador);
router.get("/mapahonduras", obtenerMapaHondurasControlador);
router.get("/anios", obtenerAniosDisponiblesControlador);

export default router;
