import assert from "node:assert/strict";

import {
  actualizarVersionFormularioControlador,
  obtenerVersionFormularioControlador,
} from "../src/controladores/registro-hospitalario.controlador";

const crearReply = () => {
  let statusCode = 0;
  let body: Record<string, unknown> = {};
  return {
    reply: {
      status(codigo: number) {
        statusCode = codigo;
        return this;
      },
      send(cuerpo: Record<string, unknown>) {
        body = cuerpo;
        return cuerpo;
      },
    },
    resultado: () => ({ statusCode, body }),
  };
};

(async () => {
  const consulta = crearReply();
  await obtenerVersionFormularioControlador({} as never, consulta.reply as never);
  assert.equal(consulta.resultado().statusCode, 200);
  assert.equal(consulta.resultado().body.modoSeleccion, "por_anio");
  assert.equal(
    consulta.resultado().body.versionFormulario,
    new Date().getFullYear() >= 2026 ? "2" : "1"
  );

  const actualizacion = crearReply();
  await actualizarVersionFormularioControlador(
    { body: { version: "1" } } as never,
    actualizacion.reply as never
  );
  assert.equal(actualizacion.resultado().statusCode, 409);
  assert.equal(
    actualizacion.resultado().body.codigo,
    "VERSION_DEFINIDA_POR_ANIO"
  );
})();
