import assert from "node:assert/strict";

import { inicializarPool, pool } from "../src/base_datos/pool";
import {
  ejecutarConsultaEgresos,
  obtenerCatalogoEgresos,
  obtenerValoresDimensionEgresos,
} from "../src/servicios/egresos-pivot.servicio";

const valorMedida = (
  resultado: Awaited<ReturnType<typeof ejecutarConsultaEgresos>>,
  etiqueta: string
) => Number(resultado.totalGeneral?.[etiqueta] ?? 0);

(async () => {
  await inicializarPool();

  const catalogo = await obtenerCatalogoEgresos();
  const dimensiones = new Map(catalogo.dimensiones.map((dimension) => [dimension.id, dimension.etiqueta]));
  const medidas = new Map(catalogo.medidas.map((medida) => [medida.id, medida.etiqueta]));

  assert.equal(dimensiones.get("OPERACION_PRINCIPAL"), "Operación Principal");
  assert.equal(dimensiones.get("OPERACIONES_EGRESO"), "Operaciones del Egreso");
  assert.equal(dimensiones.get("CODIGO_ORDEN_OPERACION"), "Código Orden Operación");
  assert.equal(medidas.get("EGRESOS_CON_OPERACION"), "Egresos con Operación");

  const opcionesOperacionPrincipal = await obtenerValoresDimensionEgresos("OPERACION_PRINCIPAL", "6639", 10, null);
  assert.equal(opcionesOperacionPrincipal[0]?.valor, "6639");

  const opcionesOperacionesEgreso = await obtenerValoresDimensionEgresos("OPERACIONES_EGRESO", "6639", 10, null);
  assert.equal(opcionesOperacionesEgreso[0]?.valor, "6639");

  const opcionesOrdenOperacion = await obtenerValoresDimensionEgresos("CODIGO_ORDEN_OPERACION", undefined, 20, null);
  assert.deepEqual(
    opcionesOrdenOperacion.slice(0, 4).map((opcion) => opcion.valor),
    [1, 2, 3, 4]
  );

  const consultaBase = {
    years: [2025],
    rows: [],
    columns: [],
    values: [{ field: "TOTAL_EGRESOS", aggregation: "COUNT" }],
    includeTotals: true,
  };

  const egresosOperacionPrincipal6639 = await ejecutarConsultaEgresos({
    ...consultaBase,
    filters: [{ field: "OPERACION_PRINCIPAL", values: ["6639"] }],
  });
  assert.equal(valorMedida(egresosOperacionPrincipal6639, "Total de Egresos"), 3808);

  const egresosOperacion6639 = await ejecutarConsultaEgresos({
    ...consultaBase,
    filters: [{ field: "OPERACIONES_EGRESO", values: ["6639"] }],
  });
  assert.equal(valorMedida(egresosOperacion6639, "Total de Egresos"), 9224);

  const egresosOperacion6639Orden2 = await ejecutarConsultaEgresos({
    ...consultaBase,
    filters: [
      { field: "OPERACIONES_EGRESO", values: ["6639"] },
      { field: "CODIGO_ORDEN_OPERACION", values: [2] },
    ],
  });
  assert.equal(valorMedida(egresosOperacion6639Orden2, "Total de Egresos"), 5356);

  const egresosConOperacion = await ejecutarConsultaEgresos({
    years: [2025],
    rows: [],
    columns: [],
    values: [{ field: "EGRESOS_CON_OPERACION", aggregation: "COUNT" }],
    includeTotals: true,
  });
  assert.equal(valorMedida(egresosConOperacion, "Egresos con Operación"), 108589);

  await pool?.end();
})();
