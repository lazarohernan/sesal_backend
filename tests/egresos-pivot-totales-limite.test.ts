import assert from "node:assert/strict";

import { inicializarPool, obtenerPoolActual } from "../src/base_datos/pool";
import { ejecutarConsultaEgresos } from "../src/servicios/egresos-pivot.servicio";

const TOTAL_EGRESOS_2025 = 347_427;
const medidaEgresos = {
  field: "TOTAL_EGRESOS",
  aggregation: "COUNT" as const,
};

const totalEgresos = (
  resultado: Awaited<ReturnType<typeof ejecutarConsultaEgresos>>
) => Number(resultado.totalGeneral?.["Total de Egresos"] ?? 0);

(async () => {
  await inicializarPool();

  const porSexo = await ejecutarConsultaEgresos({
    years: [2025],
    rows: ["SEXO"],
    columns: [],
    values: [medidaEgresos],
    includeTotals: true,
    limit: 100,
  });
  assert.equal(totalEgresos(porSexo), TOTAL_EGRESOS_2025);
  assert.equal(
    porSexo.datos.reduce(
      (total, fila) => total + Number(fila["Total de Egresos"] ?? 0),
      0
    ),
    TOTAL_EGRESOS_2025,
    "la suma por sexo debe coincidir con el total nacional"
  );

  const porGrupoEdad = await ejecutarConsultaEgresos({
    years: [2025],
    rows: ["GRUPO_EDAD"],
    columns: [],
    values: [medidaEgresos],
    includeTotals: true,
    limit: 100,
  });
  assert.equal(totalEgresos(porGrupoEdad), TOTAL_EGRESOS_2025);
  assert.equal(
    porGrupoEdad.datos.reduce(
      (total, fila) => total + Number(fila["Total de Egresos"] ?? 0),
      0
    ),
    TOTAL_EGRESOS_2025,
    "la suma por grupo de edad debe coincidir con el total nacional"
  );

  const truncadoSinColumnas = await ejecutarConsultaEgresos({
    years: [2025],
    rows: ["REGION"],
    columns: [],
    values: [medidaEgresos],
    includeTotals: true,
    limit: 1,
  });
  assert.equal(truncadoSinColumnas.datos.length, 1);
  assert.equal(
    totalEgresos(truncadoSinColumnas),
    TOTAL_EGRESOS_2025,
    "el total general no debe depender del límite visible"
  );

  const truncadoConColumnas = await ejecutarConsultaEgresos({
    years: [2025],
    rows: ["REGION"],
    columns: ["SEXO"],
    values: [medidaEgresos],
    includeTotals: true,
    limit: 1,
  });
  assert.equal(truncadoConColumnas.datos.length, 1);
  assert.equal(totalEgresos(truncadoConColumnas), TOTAL_EGRESOS_2025);

  for (const fila of porSexo.datos) {
    const etiquetaSexo = String(fila["Sexo"]);
    assert.equal(
      Number(truncadoConColumnas.totalGeneral?.[etiquetaSexo] ?? 0),
      Number(fila["Total de Egresos"] ?? 0),
      `el total de la columna ${etiquetaSexo} debe incluir las regiones no visibles`
    );
  }

  await obtenerPoolActual().end();
})();
