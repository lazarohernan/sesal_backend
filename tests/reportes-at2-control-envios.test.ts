import assert from "node:assert/strict";
import type { RowDataPacket } from "mysql2";

import { inicializarPool, obtenerPoolActual } from "../src/base_datos/pool";
import { obtenerControlEnviosAt2 } from "../src/servicios/reportes.servicio";

const REGION_MUESTRA = 19;

(async () => {
  await inicializarPool();
  const pool = obtenerPoolActual();

  try {
    const [nacional, regional, esperadosRows] = await Promise.all([
      obtenerControlEnviosAt2(
        { anio: 2026 },
        { sincronizar: false }
      ),
      obtenerControlEnviosAt2(
        { anio: 2026, regionIds: [REGION_MUESTRA] },
        { sincronizar: false }
      ),
      pool.query<RowDataPacket[]>(`
        SELECT
          SUM(CASE WHEN C_NIVEL_US IN (1, 2, 3) THEN 2 ELSE 1 END) AS nacional,
          SUM(
            CASE
              WHEN C_REGION = ? AND C_NIVEL_US IN (1, 2, 3) THEN 2
              WHEN C_REGION = ? THEN 1
              ELSE 0
            END
          ) AS regional
        FROM BAS_BDR_US
        WHERE C_REGION BETWEEN 1 AND 20
      `, [REGION_MUESTRA, REGION_MUESTRA]),
    ]);

    const esperados = esperadosRows[0][0] ?? {};
    assert.equal(nacional.filas.length, Number(esperados.nacional ?? 0));
    assert.equal(regional.filas.length, Number(esperados.regional ?? 0));
    assert.ok(regional.filas.length > 0);
    assert.ok(regional.filas.every((fila) => fila.regionCodigo === REGION_MUESTRA));

    [nacional, regional].forEach((resultado) => {
      const claves = resultado.filas.map(
        (fila) => `${fila.codigo}|${fila.unidadSalud}`
      );
      assert.equal(
        new Set(claves).size,
        claves.length,
        "cada establecimiento/servicio debe aparecer una sola vez"
      );

      resultado.filas.forEach((fila) => {
        assert.deepEqual(
          Object.keys(fila.meses).map(Number),
          Array.from({ length: 12 }, (_, index) => index + 1)
        );
        Object.values(fila.meses).forEach((estado) => {
          assert.ok(
            ["no_enviado", "enviado", "revisado"].includes(estado),
            `estado mensual inválido: ${estado}`
          );
        });
      });
    });

    assert.ok(
      nacional.filas.some((fila) =>
        Object.values(fila.meses).some((estado) => estado !== "no_enviado")
      ),
      "el control debe reflejar los envíos existentes"
    );
  } finally {
    await pool.end();
  }
})();
