import assert from "node:assert/strict";
import type { RowDataPacket } from "mysql2";

import { inicializarPool, obtenerPoolActual } from "../src/base_datos/pool";
import { obtenerRegistroControlador } from "../src/controladores/registro-hospitalario.controlador";
import { obtenerTablaDetalleAt2 } from "../src/servicios/at2-detalle-fuente.servicio";

interface GrupoLegado extends RowDataPacket {
  C_US: string;
  N_MES: number;
  C_SERVICIO: string;
  C_REGION: number;
  C_NIVEL_US: number | null;
}

(async () => {
  await inicializarPool();
  const pool = obtenerPoolActual();

  try {
    const tabla = obtenerTablaDetalleAt2(2026);
    const [grupos] = await pool.query<GrupoLegado[]>(`
      SELECT
        CAST(det.C_US AS CHAR) AS C_US,
        det.N_MES,
        det.C_SERVICIO,
        us.C_REGION,
        us.C_NIVEL_US
      FROM ${tabla} det
      INNER JOIN BAS_BDR_US us
        ON CAST(us.C_US AS CHAR) = CAST(det.C_US AS CHAR)
      WHERE det.N_ANIO = 2026
      GROUP BY det.C_US, det.N_MES, det.C_SERVICIO, us.C_REGION, us.C_NIVEL_US
      HAVING SUM(det.V_FORMULARIO = '3') > 0
         AND SUM(det.V_FORMULARIO = '4') = 0
      ORDER BY det.C_US, det.N_MES, det.C_SERVICIO
      LIMIT 1
    `);
    const grupo = grupos[0];
    assert.ok(grupo, "se requiere un bloque 2026 legado para la prueba");

    const esHospital = [1, 2, 3].includes(Number(grupo.C_NIVEL_US));
    const servicio = esHospital
      ? String(grupo.C_SERVICIO) === "2"
        ? "emergencia"
        : "consulta_externa"
      : undefined;

    let codigoRespuesta = 0;
    let cuerpoRespuesta: {
      versionFormulario?: string;
      vFormularioBD?: string;
      datos?: Array<{ concepto: number }>;
    } = {};
    const reply = {
      status(codigo: number) {
        codigoRespuesta = codigo;
        return this;
      },
      send(cuerpo: typeof cuerpoRespuesta) {
        cuerpoRespuesta = cuerpo;
        return cuerpo;
      },
    };

    await obtenerRegistroControlador(
      {
        query: {
          region: Number(grupo.C_REGION),
          anio: 2026,
          mes: Number(grupo.N_MES),
          establecimiento: grupo.C_US,
          servicio,
        },
      } as never,
      reply as never
    );

    assert.equal(codigoRespuesta, 200);
    assert.equal(cuerpoRespuesta.versionFormulario, "1");
    assert.equal(cuerpoRespuesta.vFormularioBD, "3");
    assert.ok((cuerpoRespuesta.datos?.length ?? 0) > 0);
    assert.ok(
      cuerpoRespuesta.datos!.every((fila) => Number(fila.concepto) <= 53),
      "un bloque legado no debe reinterpretarse con conceptos 54–92"
    );
  } finally {
    await pool.end();
  }
})();
