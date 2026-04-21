import type { FastifyPluginAsync } from "fastify";

import authRutas from "./auth.rutas";
import tableroRutas from "./tablero.rutas";
import configuracionRutas from "./configuracion.rutas";
import pivotRutas from "./pivot.rutas";
import reportesRutas from "./reportes.rutas";
import usuariosRutas from "./usuarios.rutas";
import establecimientosRutas from "./establecimientos.rutas";
import healthRutas from "./health.rutas";
import registroHospitalarioRutas from "./registro-hospitalario.rutas";
import egresosPivotRutas from "./egresos-pivot.rutas";
import egresosTableroRutas from "./egresos-tablero.rutas";
import seguimientoRutas from "./seguimiento.rutas";
import { requireUserSession } from "../middleware/auth.middleware";

const rutasProtegidas: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", requireUserSession);

  fastify.register(tableroRutas, { prefix: "/tablero" });
  fastify.register(pivotRutas, { prefix: "/pivot" });
  fastify.register(reportesRutas, { prefix: "/reportes" });
  fastify.register(usuariosRutas, { prefix: "/usuarios" });
  fastify.register(establecimientosRutas, { prefix: "/establecimientos" });
  fastify.register(healthRutas, { prefix: "/health" });
  fastify.register(registroHospitalarioRutas, { prefix: "/registro-hospitalario" });
  fastify.register(seguimientoRutas, { prefix: "/seguimiento" });
  fastify.register(egresosPivotRutas, { prefix: "/egresos-pivot" });
  fastify.register(egresosTableroRutas, { prefix: "/egresos-tablero" });
  fastify.register(configuracionRutas);
};

export const registrarRutas: FastifyPluginAsync = async (fastify) => {
  fastify.register(authRutas, { prefix: "/auth" });
  fastify.register(rutasProtegidas);
};

export default registrarRutas;
