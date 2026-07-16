import assert from "node:assert/strict";

import { inicializarPool, pool } from "../src/base_datos/pool";
import { ejecutarConsultaEgresos } from "../src/servicios/egresos-pivot.servicio";

const EMBARAZO_ESPERADO_2025 = 114_657;
const ABORTO_ESPERADO_2025 = 8_016;

const medida = (resultado: Awaited<ReturnType<typeof ejecutarConsultaEgresos>>, etiqueta: string) =>
  Number(resultado.totalGeneral?.[etiqueta] ?? 0);

(async () => {
  await inicializarPool();

  const pivotEmbarazo = await ejecutarConsultaEgresos({
    years: [2025],
    rows: [],
    columns: [],
    values: [{ field: "EGRESOS_EMBARAZO", aggregation: "SUM" }],
    includeTotals: true,
  });

  assert.equal(
    medida(pivotEmbarazo, "Egresos con Embarazo"),
    EMBARAZO_ESPERADO_2025,
    "embarazo nacional debe coincidir con reporte Excel"
  );

  const pivotAborto = await ejecutarConsultaEgresos({
    years: [2025],
    rows: [],
    columns: [],
    values: [{ field: "EGRESOS_ABORTO", aggregation: "SUM" }],
    includeTotals: true,
  });

  assert.equal(
    medida(pivotAborto, "Egresos con Aborto"),
    ABORTO_ESPERADO_2025,
    "aborto nacional debe coincidir con reporte Excel"
  );

  const pivotMunicipio = await ejecutarConsultaEgresos({
    years: [2025],
    rows: ["MUN_PACIENTE"],
    columns: [],
    values: [
      { field: "EGRESOS_EMBARAZO", aggregation: "SUM" },
      { field: "EGRESOS_ABORTO", aggregation: "SUM" },
    ],
    includeTotals: true,
    limit: 10_000,
  });

  const sumaEmbarazo = pivotMunicipio.datos.reduce(
    (acc, fila) => acc + Number(fila["Egresos con Embarazo"] ?? 0),
    0
  );
  const sumaAborto = pivotMunicipio.datos.reduce(
    (acc, fila) => acc + Number(fila["Egresos con Aborto"] ?? 0),
    0
  );

  assert.equal(sumaEmbarazo, EMBARAZO_ESPERADO_2025);
  assert.equal(sumaAborto, ABORTO_ESPERADO_2025);

  await pool?.end();
})();
