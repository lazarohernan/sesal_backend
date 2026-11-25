import assert from "node:assert/strict";
import type { RowDataPacket } from "mysql2/promise";

import { inicializarPool, obtenerPoolActual } from "../src/base_datos/pool";
import { obtenerResumenMaestroAt2 } from "../src/servicios/reportes.servicio";
import { construirFuenteDetalleAt2 } from "../src/servicios/at2-detalle-fuente.servicio";

const TOTAL_PACIENTES_AT2_2025 = 11_083_214;
const REGION_MUESTRA = 19;

(async () => {
  await inicializarPool();

  try {
    const [nacional, regional, nacional2026] = await Promise.all([
      obtenerResumenMaestroAt2({
        anio: 2025,
        mesInicio: 1,
        mesFin: 12,
      }),
      obtenerResumenMaestroAt2({
        anio: 2025,
        mesInicio: 1,
        mesFin: 12,
        regionIds: [REGION_MUESTRA],
      }),
      obtenerResumenMaestroAt2({
        anio: 2026,
        mesInicio: 1,
        mesFin: 1,
      }),
    ]);

    assert.equal(nacional.nivel, "Nivel Central");
    assert.equal(nacional.versionFormulario, "1");
    assert.equal(nacional.filas.length, 53);
    assert.equal(regional.filas.length, 53);
    assert.equal(nacional2026.versionFormulario, "1");
    assert.equal(nacional2026.filas.length, 53);
    assert.equal(
      nacional2026.filas.find((fila) => fila.numero === 32)?.concepto,
      "Condones 10 Unidades"
    );
    const ultimoConceptoNacional = nacional.filas[nacional.filas.length - 1];
    assert.equal(ultimoConceptoNacional?.numero, 53);
    assert.equal(
      ultimoConceptoNacional?.concepto,
      "Otras Actividades Planificación Familiar"
    );
    assert.equal(
      nacional.filas.find((fila) => fila.numero === 32)?.concepto,
      "Condones 10 Unidades"
    );

    [...nacional.filas, ...regional.filas].forEach((fila) => {
      assert.equal(
        fila.total,
        fila.enfermeraAuxiliar +
          fila.enfermeraProfesional +
          fila.medicoGeneral +
          fila.medicoEspecialista,
        `el total del concepto ${fila.numero} debe ser la suma de sus cuatro recursos`
      );
    });

    const concepto19Nacional = nacional.filas.find((fila) => fila.numero === 19);
    const concepto19Regional = regional.filas.find((fila) => fila.numero === 19);
    assert.ok(concepto19Nacional);
    assert.ok(concepto19Regional);
    assert.equal(concepto19Nacional.total, TOTAL_PACIENTES_AT2_2025);
    assert.ok(concepto19Regional.total > 0);
    assert.ok(concepto19Regional.total <= concepto19Nacional.total);

    const [establecimientoMuestra] = await obtenerPoolActual().query<RowDataPacket[]>(
      `
        SELECT CAST(us.C_US AS CHAR) AS rups
        FROM ${construirFuenteDetalleAt2([2025])}
        INNER JOIN BAS_BDR_US us
          ON CAST(us.C_US AS CHAR) COLLATE utf8mb4_unicode_ci = det.C_US COLLATE utf8mb4_unicode_ci
        WHERE us.C_REGION = ?
          AND CAST(TRIM(LEADING '0' FROM TRIM(det.C_CONCEPTO)) AS UNSIGNED) = 19
        GROUP BY us.C_US
        ORDER BY SUM(
          COALESCE(det.Q_AT_ENFERMERA_AUX, 0) +
          COALESCE(det.Q_AT_ENFERMERA_PRO, 0) +
          COALESCE(det.Q_AT_MEDICO_GEN, 0) +
          COALESCE(det.Q_AT_MEDICO_ESP, 0)
        ) DESC
        LIMIT 1
      `,
      [REGION_MUESTRA]
    );
    const rupsMuestra = String(establecimientoMuestra[0]?.rups ?? "");
    assert.ok(/^\d+$/.test(rupsMuestra), "debe existir un establecimiento con AT2 2025 en la región de muestra");

    const [porEstablecimiento, unMes] = await Promise.all([
      obtenerResumenMaestroAt2({
        anio: 2025,
        mesInicio: 1,
        mesFin: 12,
        regionIds: [REGION_MUESTRA],
        rups: rupsMuestra,
      }),
      obtenerResumenMaestroAt2({
        anio: 2025,
        mesInicio: 3,
        mesFin: 3,
        regionIds: [REGION_MUESTRA],
        rups: rupsMuestra,
      }),
    ]);

    assert.match(porEstablecimiento.nivel, new RegExp(`RUPS: ${rupsMuestra}`));
    assert.equal(porEstablecimiento.establecimientoRups, rupsMuestra);
    assert.equal(unMes.mesInicio, 3);
    assert.equal(unMes.mesFin, 3);
    const concepto19Establecimiento = porEstablecimiento.filas.find((fila) => fila.numero === 19);
    const concepto19UnMes = unMes.filas.find((fila) => fila.numero === 19);
    assert.ok(concepto19Establecimiento);
    assert.ok(concepto19UnMes);
    assert.ok(concepto19Establecimiento.total > 0);
    assert.ok(concepto19Establecimiento.total <= concepto19Regional.total);
    assert.ok(concepto19UnMes.total <= concepto19Establecimiento.total);

    try {
      await obtenerResumenMaestroAt2({
        anio: 2025,
        mesInicio: 1,
        mesFin: 12,
        regionIds: [REGION_MUESTRA],
        rups: "99999999",
      });
      assert.fail("un RUPS inexistente debe rechazarse");
    } catch (error) {
      assert.equal((error as { codigo?: string }).codigo, "ESTABLECIMIENTO_INVALIDO");
    }

    (
      [
        "enfermeraAuxiliar",
        "enfermeraProfesional",
        "medicoGeneral",
        "medicoEspecialista",
        "total",
      ] as const
    ).forEach((campo) => {
      assert.ok(
        concepto19Regional[campo] <= concepto19Nacional[campo],
        `${campo}: el subtotal regional no puede superar el nacional`
      );
    });
  } finally {
    await obtenerPoolActual().end();
  }
})();
