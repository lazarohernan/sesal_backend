import assert from "node:assert/strict";
import type { RowDataPacket } from "mysql2";

import { inicializarPool, obtenerPoolActual } from "../src/base_datos/pool";
import { guardarRegistroControlador } from "../src/controladores/registro-hospitalario.controlador";
import { obtenerTablaDetalleAt2 } from "../src/servicios/at2-detalle-fuente.servicio";

interface GrupoExistente extends RowDataPacket {
  C_US: string;
  N_ANIO: number;
  N_MES: number;
  C_SERVICIO: string;
  V_FORMULARIO: string;
  C_REGION: number;
  C_NIVEL_US: number | null;
}

(async () => {
  await inicializarPool();
  const pool = obtenerPoolActual();

  try {
    const tabla = obtenerTablaDetalleAt2(2026);
    const [grupos] = await pool.query<GrupoExistente[]>(`
      SELECT
        CAST(det.C_US AS CHAR) AS C_US,
        det.N_ANIO,
        det.N_MES,
        det.C_SERVICIO,
        det.V_FORMULARIO,
        us.C_REGION,
        us.C_NIVEL_US
      FROM ${tabla} det
      INNER JOIN BAS_BDR_US us
        ON CAST(us.C_US AS CHAR) = CAST(det.C_US AS CHAR)
      WHERE det.N_ANIO = 2026
      GROUP BY det.C_US, det.N_ANIO, det.N_MES, det.C_SERVICIO,
        det.V_FORMULARIO, us.C_REGION, us.C_NIVEL_US
      ORDER BY det.C_US, det.N_MES, det.C_SERVICIO
      LIMIT 100
    `);

    const grupo = grupos[0];
    assert.ok(grupo, "se requiere un registro de la versión activa para la prueba");
    const registros = Array.from({ length: 92 }, (_, index) => ({
      concepto: index + 1,
      enfermeraAux: 0,
      enfermeraPro: 0,
      medicoGen: 0,
      medicoEsp: 0,
    }));
    registros[0] = { ...registros[0]!, enfermeraAux: 1 };
    registros[19] = { ...registros[19]!, enfermeraAux: 1 };
    registros[21] = { ...registros[21]!, enfermeraAux: 1 };

    const esHospital = [1, 2, 3].includes(Number(grupo.C_NIVEL_US));
    const servicio = esHospital
      ? String(grupo.C_SERVICIO) === "2"
        ? "emergencia"
        : "consulta_externa"
      : undefined;

    let codigoRespuesta = 0;
    let cuerpoRespuesta: unknown;
    const reply = {
      status(codigo: number) {
        codigoRespuesta = codigo;
        return this;
      },
      send(cuerpo: unknown) {
        cuerpoRespuesta = cuerpo;
        return cuerpo;
      },
    };

    await guardarRegistroControlador(
      {
        method: "POST",
        body: {
          region: Number(grupo.C_REGION),
          anio: grupo.N_ANIO,
          mes: grupo.N_MES,
          establecimientoCodigo: grupo.C_US,
          servicio,
          registros,
        },
      } as never,
      reply as never
    );

    assert.equal(codigoRespuesta, 409);
    assert.equal(
      (cuerpoRespuesta as { codigo?: string })?.codigo,
      "REGISTRO_DUPLICADO"
    );
  } finally {
    await pool.end();
  }
})();
