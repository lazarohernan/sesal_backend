import type { FastifyPluginAsync } from "fastify";

import tableroRutas from "./tablero.rutas";
import configuracionRutas from "./configuracion.rutas";
import pivotRutas from "./pivot.rutas";
import reportesRutas from "./reportes.rutas";
import healthRutas from "./health.rutas";
import registroHospitalarioRutas from "./registro-hospitalario.rutas";
import egresosPivotRutas from "./egresos-pivot.rutas";

export const registrarRutas: FastifyPluginAsync = async (fastify) => {
  fastify.register(tableroRutas, { prefix: "/tablero" });
  fastify.register(pivotRutas, { prefix: "/pivot" });
  fastify.register(reportesRutas, { prefix: "/reportes" });
  fastify.register(healthRutas, { prefix: "/health" });
  fastify.register(registroHospitalarioRutas, { prefix: "/registro-hospitalario" });
  fastify.register(egresosPivotRutas, { prefix: "/egresos-pivot" });
  fastify.register(configuracionRutas);
};

export default registrarRutas;
