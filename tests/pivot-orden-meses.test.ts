import assert from "node:assert/strict";

import { ordenarValoresColumnaPivot, ordenarValoresColumnaPivotSiAplica } from "../src/utilidades/pivot-orden.util";

const mesesDesordenados = [
  "Abril",
  "Enero",
  "Febrero",
  "Julio",
  "Junio",
  "Marzo",
  "Mayo"
];

assert.deepEqual(
  ordenarValoresColumnaPivot(mesesDesordenados, ["MES"]),
  ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio"]
);

assert.deepEqual(
  ordenarValoresColumnaPivot(
    ["Hospital Básico", "Centro Integral de Salud", "Hospital General"],
    ["NIVEL_ESTABLECIMIENTO"]
  ),
  ["Hospital Básico", "Hospital General", "Centro Integral de Salud"]
);

assert.deepEqual(
  ordenarValoresColumnaPivot(
    ["2025 / Abril", "2024 / Enero", "2024 / Abril", "2025 / Enero"],
    ["ANIO", "MES"]
  ),
  ["2024 / Enero", "2024 / Abril", "2025 / Enero", "2025 / Abril"]
);

assert.deepEqual(
  ordenarValoresColumnaPivot(
    ["Abril · Total de Egresos", "Enero · Total de Egresos", "Marzo · Total de Egresos"],
    ["MES"]
  ),
  ["Enero · Total de Egresos", "Marzo · Total de Egresos", "Abril · Total de Egresos"]
);

assert.deepEqual(
  ordenarValoresColumnaPivot(
    ["Total 2026", "Abril", "Enero"],
    ["MES"]
  ),
  ["Enero", "Abril", "Total 2026"]
);

assert.deepEqual(
  ordenarValoresColumnaPivotSiAplica(
    ["A00 Cólera", "B20 VIH", "A09 Diarrea"],
    ["DIAGNOSTICOS_EGRESO"]
  ),
  ["A00 Cólera", "B20 VIH", "A09 Diarrea"]
);

assert.deepEqual(
  ordenarValoresColumnaPivotSiAplica(
    ["Centro Integral de Salud", "Hospital Básico", "Hospital General"],
    ["CATEGORIA_ESTABLECIMIENTO"]
  ),
  ["Hospital Básico", "Hospital General", "Centro Integral de Salud"]
);
