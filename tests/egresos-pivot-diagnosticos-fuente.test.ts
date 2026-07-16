import assert from "node:assert/strict";

import { inicializarPool, pool } from "../src/base_datos/pool";
import {
  ejecutarConsultaEgresos,
  obtenerCatalogoEgresos,
  obtenerValoresDimensionEgresos,
} from "../src/servicios/egresos-pivot.servicio";

const totalEgresos = (resultado: Awaited<ReturnType<typeof ejecutarConsultaEgresos>>) =>
  Number(resultado.totalGeneral?.["Total de Egresos"] ?? 0);

(async () => {
  await inicializarPool();

  const catalogo = await obtenerCatalogoEgresos();
  const dimensiones = new Map(catalogo.dimensiones.map((dimension) => [dimension.id, dimension.etiqueta]));
  assert.equal(dimensiones.has("DIAGNOSTICO"), false);
  assert.equal(dimensiones.get("DIAGNOSTICO_INGRESO"), "Diagnóstico de Ingreso");
  assert.equal(dimensiones.get("DIAGNOSTICO_EGRESO_PRINCIPAL"), "Diagnóstico de Egreso Principal");

  const opcionesIngreso = await obtenerValoresDimensionEgresos("DIAGNOSTICO_INGRESO", "A09", 10, null);
  assert.equal(opcionesIngreso[0]?.valor, "A09");

  const opcionesEgresoPrincipal = await obtenerValoresDimensionEgresos(
    "DIAGNOSTICO_EGRESO_PRINCIPAL",
    "A09",
    10,
    null
  );
  assert.equal(opcionesEgresoPrincipal[0]?.valor, "A09");

  const consultaBase = {
    years: [2025],
    rows: [],
    columns: [],
    values: [{ field: "TOTAL_EGRESOS", aggregation: "COUNT" }],
    includeTotals: true,
  };

  const ingresoA09 = await ejecutarConsultaEgresos({
    ...consultaBase,
    filters: [{ field: "DIAGNOSTICO_INGRESO", values: ["A09"] }],
  });
  assert.equal(totalEgresos(ingresoA09), 6652);

  const egresoPrincipalA09 = await ejecutarConsultaEgresos({
    ...consultaBase,
    filters: [{ field: "DIAGNOSTICO_EGRESO_PRINCIPAL", values: ["A09"] }],
  });
  assert.equal(totalEgresos(egresoPrincipalA09), 5754);

  const egresoCualquierOrdenA09 = await ejecutarConsultaEgresos({
    ...consultaBase,
    filters: [{ field: "DIAGNOSTICOS_EGRESO", values: ["A09"] }],
  });
  assert.equal(totalEgresos(egresoCualquierOrdenA09), 8472);

  await pool?.end();
})();
