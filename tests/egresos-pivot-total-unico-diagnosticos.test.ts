import assert from "node:assert/strict";

import { inicializarPool, obtenerPoolActual } from "../src/base_datos/pool";
import { ejecutarConsultaEgresos } from "../src/servicios/egresos-pivot.servicio";

const TOTAL_EGRESOS_2025 = 347_427;

const totalEgresos = (resultado: Awaited<ReturnType<typeof ejecutarConsultaEgresos>>) =>
  Number(resultado.totalGeneral?.["Total de Egresos"] ?? 0);

(async () => {
  await inicializarPool();

  const consultaBase = {
    years: [2025],
    columns: [],
    values: [{ field: "TOTAL_EGRESOS", aggregation: "COUNT" }],
    includeTotals: true,
    limit: 10_000,
  };

  for (const dimension of [
    "DIAGNOSTICOS_EGRESO",
    "CIE_CATEGORIA",
    "CIE_CAPITULO",
    "CIE_GRUPO",
    "CODIGO_ORDEN_AFECCION",
  ]) {
    const resultado = await ejecutarConsultaEgresos({
      ...consultaBase,
      rows: [dimension],
    });

    assert.equal(
      totalEgresos(resultado),
      TOTAL_EGRESOS_2025,
      `${dimension} debe mantener el total nacional de egresos únicos`
    );
  }

  const categoriaEnColumnas = await ejecutarConsultaEgresos({
    ...consultaBase,
    rows: ["SEXO"],
    columns: ["CIE_CATEGORIA"],
  });

  assert.equal(
    totalEgresos(categoriaEnColumnas),
    TOTAL_EGRESOS_2025,
    "CIE_CATEGORIA en columnas debe mantener el total nacional de egresos únicos"
  );
  assert.equal(
    categoriaEnColumnas.datos.reduce(
      (total, fila) => total + Number(fila["Total de Egresos"] ?? 0),
      0
    ),
    TOTAL_EGRESOS_2025,
    "los totales territoriales por fila tampoco deben sumar categorías superpuestas"
  );

  await obtenerPoolActual().end();
})();
