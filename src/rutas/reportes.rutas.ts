import { Router } from "express";

import {
  obtenerIndicadoresMunicipalesControlador,
  obtenerEstadisticasCacheControlador
} from "../controladores/reportes.controlador";
import {
  establecerConfiguracionBD,
  limpiarConfiguracionBD,
  logConfiguracionBD,
  requerirConfiguracionBD
} from "../middleware/configuracion-bd.middleware";

const router = Router();

router.use(establecerConfiguracionBD);
router.use(logConfiguracionBD);
router.use(requerirConfiguracionBD);
router.use(limpiarConfiguracionBD);

router.get("/indicadores-municipales", obtenerIndicadoresMunicipalesControlador);
router.get("/cache-estadisticas", obtenerEstadisticasCacheControlador);

export default router;
