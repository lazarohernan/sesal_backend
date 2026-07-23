import assert from "node:assert/strict";

import { inicializarPool, obtenerPoolActual } from "../src/base_datos/pool";
import {
  ejecutarConsultaEgresos,
  obtenerAniosEgresos,
} from "../src/servicios/egresos-pivot.servicio";

const medidaPromedio = {
  field: "ESTANCIA_PROMEDIO",
  aggregation: "AVG" as const,
};

const promedio = (valor: unknown) => Number(valor ?? 0);

const compararTotalesPorFila = (
  dimension: string,
  base: Awaited<ReturnType<typeof ejecutarConsultaEgresos>>,
  columnas: Awaited<ReturnType<typeof ejecutarConsultaEgresos>>
) => {
  const esperados = new Map(
    base.datos.map((fila) => [
      String(fila[dimension]),
      promedio(fila["Estancia Promedio"]),
    ])
  );

  for (const fila of columnas.datos) {
    assert.equal(
      promedio(fila["Estancia Promedio"]),
      esperados.get(String(fila[dimension])),
      `el promedio total de ${dimension}=${String(fila[dimension])} debe ser ponderado`
    );
  }
};

(async () => {
  await inicializarPool();

  const nacional = await ejecutarConsultaEgresos({
    years: [2025],
    rows: [],
    columns: [],
    values: [
      { field: "TOTAL_EGRESOS", aggregation: "COUNT" },
      { field: "DIAS_ESTANCIA", aggregation: "SUM" },
      medidaPromedio,
    ],
    includeTotals: true,
  });
  const totalEgresos = promedio(nacional.totalGeneral?.["Total de Egresos"]);
  const diasEstancia = promedio(nacional.totalGeneral?.["Días de Estancia"]);
  const promedioCalculado = Math.round((diasEstancia / totalEgresos) * 100) / 100;

  assert.equal(promedio(nacional.totalGeneral?.["Estancia Promedio"]), 5.54);
  assert.equal(
    promedio(nacional.totalGeneral?.["Estancia Promedio"]),
    promedioCalculado,
    "el promedio nacional debe ser suma de días dividida entre egresos"
  );

  const porSexo = await ejecutarConsultaEgresos({
    years: [2025],
    rows: ["SEXO"],
    columns: [],
    values: [medidaPromedio],
    includeTotals: true,
  });
  const sexoEnColumnas = await ejecutarConsultaEgresos({
    years: [2025],
    rows: [],
    columns: ["SEXO"],
    values: [medidaPromedio],
    includeTotals: true,
  });

  assert.equal(promedio(sexoEnColumnas.totalGeneral?.["Estancia Promedio"]), 5.54);
  assert.notEqual(
    promedio(sexoEnColumnas.totalGeneral?.["Estancia Promedio"]),
    14.59,
    "el total nacional no debe sumar los promedios por sexo"
  );
  for (const fila of porSexo.datos) {
    assert.equal(
      promedio(sexoEnColumnas.totalGeneral?.[String(fila["Sexo"])]),
      promedio(fila["Estancia Promedio"]),
      `el total de la columna ${String(fila["Sexo"])} debe conservar su promedio real`
    );
  }

  for (const dimension of ["REGION", "ESTABLECIMIENTO"] as const) {
    const etiqueta = dimension === "REGION" ? "Región" : "Establecimiento";
    const base = await ejecutarConsultaEgresos({
      years: [2025],
      rows: [dimension],
      columns: [],
      values: [medidaPromedio],
      includeTotals: true,
      limit: 10_000,
    });
    const conSexoEnColumnas = await ejecutarConsultaEgresos({
      years: [2025],
      rows: [dimension],
      columns: ["SEXO"],
      values: [medidaPromedio],
      includeTotals: true,
      limit: 10_000,
    });

    compararTotalesPorFila(etiqueta, base, conSexoEnColumnas);
    assert.equal(
      promedio(conSexoEnColumnas.totalGeneral?.["Hombre"]),
      promedio(sexoEnColumnas.totalGeneral?.["Hombre"])
    );
    assert.equal(
      promedio(conSexoEnColumnas.totalGeneral?.["Mujer"]),
      promedio(sexoEnColumnas.totalGeneral?.["Mujer"])
    );
  }

  const aniosDisponibles = await obtenerAniosEgresos();
  const basePorAnio = await ejecutarConsultaEgresos({
    years: aniosDisponibles,
    rows: ["ANIO"],
    columns: [],
    values: [medidaPromedio],
    includeTotals: true,
  });
  const anioConSexoEnColumnas = await ejecutarConsultaEgresos({
    years: aniosDisponibles,
    rows: ["ANIO"],
    columns: ["SEXO"],
    values: [medidaPromedio],
    includeTotals: true,
  });
  compararTotalesPorFila("Año", basePorAnio, anioConSexoEnColumnas);

  await obtenerPoolActual().end();
})();
