import assert from "node:assert/strict";

import { inicializarPool, pool } from "../src/base_datos/pool";
import {
  ejecutarConsultaEgresos,
  obtenerValoresDimensionEgresos,
} from "../src/servicios/egresos-pivot.servicio";

const totalEgresos = (resultado: Awaited<ReturnType<typeof ejecutarConsultaEgresos>>) =>
  Number(resultado.totalGeneral?.["Total de Egresos"] ?? 0);

(async () => {
  await inicializarPool();

  const opcionesOrden = await obtenerValoresDimensionEgresos("CODIGO_ORDEN_AFECCION", undefined, 10, null);
  assert.deepEqual(
    opcionesOrden.map((opcion) => opcion.valor),
    [0, 1, 2, 3, 4]
  );

  const consultaBase = {
    years: [2025],
    rows: [],
    columns: [],
    values: [{ field: "TOTAL_EGRESOS", aggregation: "COUNT" }],
    includeTotals: true,
  };

  const totalSinOrden = await ejecutarConsultaEgresos({
    ...consultaBase,
    filters: [{ field: "DIAGNOSTICOS_EGRESO", values: ["A09"] }],
  });
  assert.equal(totalEgresos(totalSinOrden), 8472);

  const totalOrdenPrincipal = await ejecutarConsultaEgresos({
    ...consultaBase,
    filters: [
      { field: "DIAGNOSTICOS_EGRESO", values: ["A09"] },
      { field: "CODIGO_ORDEN_AFECCION", values: [1] },
    ],
  });
  assert.equal(totalEgresos(totalOrdenPrincipal), 5754);

  const totalOrdenSecundario = await ejecutarConsultaEgresos({
    ...consultaBase,
    filters: [
      { field: "DIAGNOSTICOS_EGRESO", values: ["A09"] },
      { field: "CODIGO_ORDEN_AFECCION", values: [2] },
    ],
  });
  assert.equal(totalEgresos(totalOrdenSecundario), 1871);

  await pool?.end();
})();
