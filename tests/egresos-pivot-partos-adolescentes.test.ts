import assert from "node:assert/strict";

import { inicializarPool, pool } from "../src/base_datos/pool";
import { ejecutarConsultaEgresos } from "../src/servicios/egresos-pivot.servicio";
import { obtenerIndicadoresTableroEgresos } from "../src/servicios/egresos-tablero.servicio";

const totalPartosAdolescentes = (resultado: Awaited<ReturnType<typeof ejecutarConsultaEgresos>>) =>
  Number(resultado.totalGeneral?.["Partos Adolescentes"] ?? 0);

(async () => {
  await inicializarPool();

  const tablero = await obtenerIndicadoresTableroEgresos({ anio: 2025 });
  const esperado = tablero.resumen.totalPartosAdolescentes;

  const pivotNacional = await ejecutarConsultaEgresos({
    years: [2025],
    rows: [],
    columns: [],
    values: [{ field: "PARTOS_ADOLESCENTES", aggregation: "SUM" }],
    includeTotals: true,
  });

  assert.equal(
    totalPartosAdolescentes(pivotNacional),
    esperado,
    "el pivot nacional debe coincidir con el mapa/tablero"
  );
  assert.ok(esperado > 0, "debe haber partos adolescentes en 2025");

  const pivotPorDepartamento = await ejecutarConsultaEgresos({
    years: [2025],
    rows: ["DEPARTAMENTO"],
    columns: [],
    values: [{ field: "PARTOS_ADOLESCENTES", aggregation: "SUM" }],
    includeTotals: true,
    limit: 500,
  });

  const sumaDepartamentos = pivotPorDepartamento.datos.reduce((acc, fila) => {
    const valor = Number(fila["Partos Adolescentes"] ?? 0);
    return acc + (Number.isFinite(valor) ? valor : 0);
  }, 0);

  assert.equal(
    sumaDepartamentos,
    esperado,
    "la suma por departamento debe igualar el total nacional del mapa"
  );

  const pivotManualCorrecto = await ejecutarConsultaEgresos({
    years: [2025],
    filters: [
      { field: "GRUPO_EDAD", values: ["10-14 Años", "15-19 Años"] },
      { field: "DIAGNOSTICOS_EGRESO", values: ["O80", "O81", "O82", "O84"] },
    ],
    rows: [],
    columns: [],
    values: [{ field: "TOTAL_EGRESOS", aggregation: "COUNT" }],
    includeTotals: true,
  });

  assert.equal(
    Number(pivotManualCorrecto.totalGeneral?.["Total de Egresos"] ?? 0),
    esperado,
    "cruce manual con etiquetas del catálogo también debe coincidir"
  );

  const pivotEtiquetasIncorrectas = await ejecutarConsultaEgresos({
    years: [2025],
    filters: [
      { field: "GRUPO_EDAD", values: ["10- 14 Años", "15- 19 Años"] },
      { field: "DIAGNOSTICOS_EGRESO", values: ["O80", "O81", "O82", "O84"] },
    ],
    rows: [],
    columns: [],
    values: [{ field: "TOTAL_EGRESOS", aggregation: "COUNT" }],
    includeTotals: true,
  });

  assert.equal(
    Number(pivotEtiquetasIncorrectas.totalGeneral?.["Total de Egresos"] ?? 0),
    0,
    "etiquetas con espacio extra (GE_ASI) no encuentran filas en GRUPO_EDAD"
  );

  await pool?.end();
})();
