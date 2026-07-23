import assert from "node:assert/strict";

import { inicializarPool, obtenerPoolActual } from "../src/base_datos/pool";
import {
  ejecutarConsultaEgresos,
  obtenerAniosEgresos,
} from "../src/servicios/egresos-pivot.servicio";

const REFERENCIA_2025 = {
  egresos: 347_427,
  operaciones: 131_002,
  egresosConOperacion: 108_589,
};

const obtenerTotales = (
  resultado: Awaited<ReturnType<typeof ejecutarConsultaEgresos>>
) => ({
  egresos: Number(resultado.totalGeneral?.["Total de Egresos"] ?? 0),
  operaciones: Number(resultado.totalGeneral?.["Total de Operaciones"] ?? 0),
  egresosConOperacion: Number(resultado.totalGeneral?.["Egresos con Operación"] ?? 0),
});

const medidasOperaciones = [
  { field: "TOTAL_EGRESOS", aggregation: "COUNT" as const },
  { field: "TOTAL_OPERACIONES", aggregation: "SUM" as const },
  { field: "EGRESOS_CON_OPERACION", aggregation: "SUM" as const },
];

const obtenerTotalesPorAnio = (
  resultado: Awaited<ReturnType<typeof ejecutarConsultaEgresos>>
) =>
  Object.fromEntries(
    resultado.datos.map((fila) => [
      Number(fila["Año"]),
      {
        egresos: Number(fila["Total de Egresos"] ?? 0),
        operaciones: Number(fila["Total de Operaciones"] ?? 0),
        egresosConOperacion: Number(fila["Egresos con Operación"] ?? 0),
      },
    ])
  );

(async () => {
  await inicializarPool();

  const consultaBase = {
    years: [2025],
    values: medidasOperaciones,
    includeTotals: true,
    limit: 10_000,
  };

  const sinDesglose = await ejecutarConsultaEgresos({
    ...consultaBase,
    rows: [],
    columns: [],
  });
  assert.deepEqual(obtenerTotales(sinDesglose), REFERENCIA_2025);

  const ordenEnFilas = await ejecutarConsultaEgresos({
    ...consultaBase,
    rows: ["CODIGO_ORDEN_OPERACION"],
    columns: [],
  });
  assert.deepEqual(
    obtenerTotales(ordenEnFilas),
    REFERENCIA_2025,
    "el orden de operación en filas debe conservar los totales únicos"
  );
  assert.equal(
    ordenEnFilas.datos.reduce(
      (total, fila) => total + Number(fila["Total de Operaciones"] ?? 0),
      0
    ),
    REFERENCIA_2025.operaciones,
    "cada línea de operación debe contarse una sola vez"
  );

  const ordenEnColumnas = await ejecutarConsultaEgresos({
    ...consultaBase,
    rows: ["SEXO"],
    columns: ["CODIGO_ORDEN_OPERACION"],
  });
  assert.deepEqual(
    obtenerTotales(ordenEnColumnas),
    REFERENCIA_2025,
    "el orden de operación en columnas debe conservar los totales únicos"
  );
  assert.deepEqual(
    ordenEnColumnas.datos.reduce<{
      egresos: number;
      operaciones: number;
      egresosConOperacion: number;
    }>(
      (totales, fila) => ({
        egresos: totales.egresos + Number(fila["Total de Egresos"] ?? 0),
        operaciones: totales.operaciones + Number(fila["Total de Operaciones"] ?? 0),
        egresosConOperacion:
          totales.egresosConOperacion + Number(fila["Egresos con Operación"] ?? 0),
      }),
      { egresos: 0, operaciones: 0, egresosConOperacion: 0 }
    ),
    REFERENCIA_2025,
    "los totales por fila deben calcularse directamente y no sumando columnas superpuestas"
  );

  const diagnosticoConMedidasOperativas = await ejecutarConsultaEgresos({
    ...consultaBase,
    rows: ["CIE_CATEGORIA"],
    columns: [],
  });
  assert.deepEqual(
    obtenerTotales(diagnosticoConMedidasOperativas),
    REFERENCIA_2025,
    "las métricas operativas no deben multiplicarse al combinarse con diagnósticos"
  );

  const aniosDisponibles = await obtenerAniosEgresos();
  const historicoBase = await ejecutarConsultaEgresos({
    years: aniosDisponibles,
    rows: ["ANIO"],
    columns: [],
    values: medidasOperaciones,
    includeTotals: true,
    limit: 10_000,
  });
  const historicoPorOrden = await ejecutarConsultaEgresos({
    years: aniosDisponibles,
    rows: ["ANIO"],
    columns: ["CODIGO_ORDEN_OPERACION"],
    values: medidasOperaciones,
    includeTotals: true,
    limit: 10_000,
  });
  assert.deepEqual(
    obtenerTotalesPorAnio(historicoPorOrden),
    obtenerTotalesPorAnio(historicoBase),
    "el desglose por orden debe conservar los totales de todos los años disponibles"
  );

  await obtenerPoolActual().end();
})();
