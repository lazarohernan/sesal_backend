import assert from "node:assert/strict";

import { inicializarPool, obtenerPoolActual } from "../src/base_datos/pool";
import { obtenerResumenMaestroAt2 } from "../src/servicios/reportes.servicio";

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
        mesFin: 12,
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
