import { Router } from "express";

import tableroRutas from "./tablero.rutas";
import configuracionRutas from "./configuracion.rutas";
import pivotRutas from "./pivot.rutas";
import reportesRutas from "./reportes.rutas";
import healthRutas from "./health.rutas";

const enrutador = Router();

enrutador.use("/tablero", tableroRutas);
enrutador.use("/pivot", pivotRutas);
enrutador.use("/reportes", reportesRutas);
enrutador.use("/health", healthRutas);
enrutador.use("", configuracionRutas);

export default enrutador;
