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

  assert.equal(dimensiones.has("SERVICIO"), false);
  assert.equal(dimensiones.has("SALA"), false);
  assert.equal(dimensiones.get("SERVICIO_INGRESO"), "Servicio de Ingreso");
  assert.equal(dimensiones.get("SERVICIO_EGRESO"), "Servicio de Egreso");
  assert.equal(dimensiones.get("SALA_INGRESO"), "Sala de Ingreso");
  assert.equal(dimensiones.get("SALA_EGRESO"), "Sala de Egreso");

  const opcionesServicioIngreso = await obtenerValoresDimensionEgresos("SERVICIO_INGRESO", "700", 10, null);
  assert.equal(opcionesServicioIngreso[0]?.valor, 700);

  const opcionesSalaEgreso = await obtenerValoresDimensionEgresos("SALA_EGRESO", "710", 10, null);
  assert.equal(opcionesSalaEgreso[0]?.valor, 710);

  const consultaBase = {
    years: [2025],
    rows: [],
    columns: [],
    values: [{ field: "TOTAL_EGRESOS", aggregation: "COUNT" }],
    includeTotals: true,
  };

  const ingresoServicio700 = await ejecutarConsultaEgresos({
    ...consultaBase,
    filters: [{ field: "SERVICIO_INGRESO", values: [700] }],
  });
  assert.equal(totalEgresos(ingresoServicio700), 89192);

  const egresoServicio700 = await ejecutarConsultaEgresos({
    ...consultaBase,
    filters: [{ field: "SERVICIO_EGRESO", values: [700] }],
  });
  assert.equal(totalEgresos(egresoServicio700), 97362);

  const ingresoSala710 = await ejecutarConsultaEgresos({
    ...consultaBase,
    filters: [{ field: "SALA_INGRESO", values: [710] }],
  });
  assert.equal(totalEgresos(ingresoSala710), 87021);

  const egresoSala710 = await ejecutarConsultaEgresos({
    ...consultaBase,
    filters: [{ field: "SALA_EGRESO", values: [710] }],
  });
  assert.equal(totalEgresos(egresoSala710), 95205);

  await pool?.end();
})();
