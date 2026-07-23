import assert from "node:assert/strict";
import type { RowDataPacket } from "mysql2";

import { inicializarPool, obtenerPoolActual } from "../src/base_datos/pool";
import { obtenerTablaDetalleAt2 } from "../src/servicios/at2-detalle-fuente.servicio";
import { seguimientoServicio } from "../src/servicios/seguimiento.servicio";

interface RegistroPrueba extends RowDataPacket {
  C_US: string;
  N_ANIO: number;
  N_MES: number;
  C_SERVICIO: string;
  C_REGION: number;
  C_NIVEL_US: number | null;
}

(async () => {
  await inicializarPool();
  const pool = obtenerPoolActual();
  const tabla = obtenerTablaDetalleAt2(2026);
  const [candidatos] = await pool.query<RegistroPrueba[]>(`
    SELECT
      CAST(det.C_US AS CHAR) AS C_US,
      det.N_ANIO,
      det.N_MES,
      det.C_SERVICIO,
      us.C_REGION,
      us.C_NIVEL_US
    FROM ${tabla} det
    INNER JOIN BAS_BDR_US us
      ON CAST(us.C_US AS CHAR) = CAST(det.C_US AS CHAR)
    WHERE det.N_ANIO = 2026
    GROUP BY
      det.C_US,
      det.N_ANIO,
      det.N_MES,
      det.C_SERVICIO,
      us.C_REGION,
      us.C_NIVEL_US
    ORDER BY det.C_US, det.N_MES, det.C_SERVICIO
    LIMIT 1
  `);
  const registro = candidatos[0];
  assert.ok(registro, "se requiere al menos un registro AT2R 2026 para probar el rollback");

  const esHospital = [1, 2, 3].includes(Number(registro.C_NIVEL_US));
  const servicio = esHospital
    ? (String(registro.C_SERVICIO) === "2" ? "emergencia" : "consulta_externa")
    : "general";
  const parametros = [
    registro.C_US,
    registro.N_ANIO,
    registro.N_MES,
    registro.C_SERVICIO,
  ];
  const [conteoAntesRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
     FROM ${tabla}
     WHERE C_US = ? AND N_ANIO = ? AND N_MES = ? AND C_SERVICIO = ?`,
    parametros
  );
  const conteoAntes = Number(conteoAntesRows[0]?.total ?? 0);
  assert.ok(conteoAntes > 0);

  await seguimientoServicio.asegurarTabla();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await seguimientoServicio.registrarEnvio(
      {
        anio: registro.N_ANIO,
        mes: registro.N_MES,
        regionCodigo: Number(registro.C_REGION),
        establecimientoRups: registro.C_US,
        servicio,
      },
      conn
    );

    const [resultado] = await conn.query(
      `DELETE FROM ${tabla}
       WHERE C_US = ? AND N_ANIO = ? AND N_MES = ? AND C_SERVICIO = ?`,
      parametros
    );
    assert.equal(
      Number((resultado as { affectedRows?: number }).affectedRows ?? 0),
      conteoAntes
    );

    await seguimientoServicio.registrarEliminacion(
      {
        anio: registro.N_ANIO,
        mes: registro.N_MES,
        regionCodigo: Number(registro.C_REGION),
        establecimientoRups: registro.C_US,
        servicio,
      },
      conn
    );

    const [detalleDentro] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
       FROM ${tabla}
       WHERE C_US = ? AND N_ANIO = ? AND N_MES = ? AND C_SERVICIO = ?`,
      parametros
    );
    assert.equal(Number(detalleDentro[0]?.total ?? 0), 0);

    const [seguimientoDentro] = await conn.query<RowDataPacket[]>(
      `SELECT estado, fecha_envio, fecha_revision
       FROM AT2_SEGUIMIENTO_ENVIO
       WHERE anio = ? AND mes = ? AND establecimiento_rups = ? AND servicio = ?
       LIMIT 1`,
      [registro.N_ANIO, registro.N_MES, registro.C_US, servicio]
    );
    assert.equal(seguimientoDentro[0]?.estado, "no_enviado");
    assert.equal(seguimientoDentro[0]?.fecha_envio, null);
    assert.equal(seguimientoDentro[0]?.fecha_revision, null);
  } finally {
    await conn.rollback();
    conn.release();
  }

  const [conteoDespuesRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
     FROM ${tabla}
     WHERE C_US = ? AND N_ANIO = ? AND N_MES = ? AND C_SERVICIO = ?`,
    parametros
  );
  assert.equal(
    Number(conteoDespuesRows[0]?.total ?? 0),
    conteoAntes,
    "el rollback de la prueba debe restaurar todos los datos"
  );

  await pool.end();
})();
