import { Router } from "express";

import {
  aniosDisponiblesPivotControlador,
  catalogoPivotControlador,
  ejecutarPivotControlador,
  valoresDimensionPivotControlador
} from "../controladores/pivot.controlador";
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

router.get("/catalogo", catalogoPivotControlador);
router.get("/anios", aniosDisponiblesPivotControlador);
router.get("/dimensiones/:dimensionId/valores", valoresDimensionPivotControlador);
router.post("/consulta", ejecutarPivotControlador);

export default router;






