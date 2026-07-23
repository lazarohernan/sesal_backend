import assert from "node:assert/strict";

import { inicializarPool, obtenerPoolActual } from "../src/base_datos/pool";
import {
  ejecutarConsultaPivot,
  obtenerValoresDimension,
} from "../src/servicios/pivot.servicio";

const consultarConceptos = (anio: number, dimension: "CONCEPTO" | "CONCEPTO_ORDENADO") =>
  ejecutarConsultaPivot({
    years: [anio],
    rows: [dimension],
    columns: [],
    values: [{ field: "TOTAL", aggregation: "SUM" }],
    includeTotals: true,
    limit: 250,
  });

(async () => {
  await inicializarPool();

  try {
    const catalogoNuevo = await obtenerValoresDimension(
      "CONCEPTO_ORDENADO",
      undefined,
      100
    );
    assert.equal(catalogoNuevo.length, 92);
    assert.equal(catalogoNuevo.find((fila) => String(fila.valor) === "82")?.etiqueta, "Garífuna");
    assert.equal(
      catalogoNuevo.find((fila) => String(fila.valor) === "92")?.etiqueta,
      "No Sabe / Ninguno"
    );

    const historico2025 = await consultarConceptos(2025, "CONCEPTO");
    assert.ok(
      historico2025.datos.some(
        (fila) => fila.CONCEPTO === "Condones 10 Unidades"
      ),
      "el concepto 32 de V3 debe conservar su significado histórico"
    );
    assert.ok(
      historico2025.datos.some(
        (fila) => fila.CONCEPTO === "Otras Actividades Planificación Familiar"
      ),
      "el concepto 53 histórico debe resolverse aunque su catálogo tenga versión nula"
    );

    const historico2026 = await consultarConceptos(2026, "CONCEPTO_ORDENADO");
    assert.ok(
      historico2026.datos.some(
        (fila) =>
          fila.CONCEPTO_ORDENADO === "Otras Actividades Planificación Familiar"
      ),
      "los bloques V3 de 2026 no deben recibir etiquetas del formulario nuevo"
    );

    const versiones2011 = await consultarConceptos(2011, "CONCEPTO_ORDENADO");
    assert.ok(
      versiones2011.datos.some(
        (fila) => fila.CONCEPTO_ORDENADO === "Partos Atendidos"
      ),
      "el concepto 51 de V2 debe conservar su etiqueta"
    );
    assert.ok(
      versiones2011.datos.some(
        (fila) =>
          fila.CONCEPTO_ORDENADO ===
          "Atencion prenatal nueva en las primeras 12 SG"
      ),
      "el concepto 51 de V3 debe aparecer separado del concepto 51 de V2"
    );
  } finally {
    await obtenerPoolActual().end();
  }
})();
