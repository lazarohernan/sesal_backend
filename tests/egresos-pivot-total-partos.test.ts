import assert from "node:assert/strict";

import { inicializarPool, obtenerPoolActual } from "../src/base_datos/pool";
import {
  ejecutarConsultaEgresos,
  obtenerAniosEgresos,
  obtenerResumenEgresos,
} from "../src/servicios/egresos-pivot.servicio";
import { obtenerIndicadoresTableroEgresos } from "../src/servicios/egresos-tablero.servicio";

const TOTAL_PARTOS_2025 = 91_841;

const totalPartos = (
  resultado: Awaited<ReturnType<typeof ejecutarConsultaEgresos>>
) => Number(resultado.totalGeneral?.["Total de Partos"] ?? 0);

const partosPorAnio = (
  resultado: Awaited<ReturnType<typeof ejecutarConsultaEgresos>>
) =>
  Object.fromEntries(
    resultado.datos.map((fila) => [
      Number(fila["Año"]),
      Number(fila["Total de Partos"] ?? 0),
    ])
  );

(async () => {
  await inicializarPool();

  const medidaPartos = { field: "TOTAL_PARTOS", aggregation: "SUM" as const };
  const consulta2025 = {
    years: [2025],
    rows: [],
    columns: [],
    includeTotals: true,
    limit: 10_000,
  };

  const medidaAislada = await ejecutarConsultaEgresos({
    ...consulta2025,
    values: [medidaPartos],
  });
  assert.equal(
    totalPartos(medidaAislada),
    TOTAL_PARTOS_2025,
    "la medida aislada debe contar egresos únicos y no líneas diagnósticas"
  );

  const medidaCombinada = await ejecutarConsultaEgresos({
    ...consulta2025,
    values: [
      { field: "TOTAL_EGRESOS", aggregation: "COUNT" },
      medidaPartos,
    ],
  });
  assert.equal(
    totalPartos(medidaCombinada),
    TOTAL_PARTOS_2025,
    "la fórmula no debe cambiar al combinar métricas"
  );

  const conDiagnosticos = await ejecutarConsultaEgresos({
    ...consulta2025,
    rows: ["CIE_CATEGORIA"],
    values: [medidaPartos],
  });
  assert.equal(
    totalPartos(conDiagnosticos),
    TOTAL_PARTOS_2025,
    "el desglose diagnóstico no debe duplicar el total general de partos"
  );

  const conOrdenOperacion = await ejecutarConsultaEgresos({
    ...consulta2025,
    rows: ["CODIGO_ORDEN_OPERACION"],
    values: [
      { field: "TOTAL_EGRESOS", aggregation: "COUNT" },
      medidaPartos,
    ],
  });
  assert.equal(
    totalPartos(conOrdenOperacion),
    TOTAL_PARTOS_2025,
    "el desglose de operaciones tampoco debe duplicar partos"
  );

  const tablero = await obtenerIndicadoresTableroEgresos({ anio: 2025 });
  assert.equal(
    tablero.resumen.totalPartos,
    TOTAL_PARTOS_2025,
    "el tablero y el reporte dinámico deben usar la misma regla"
  );

  const aniosDisponibles = await obtenerAniosEgresos();
  const historicoAislado = await ejecutarConsultaEgresos({
    years: aniosDisponibles,
    rows: ["ANIO"],
    columns: [],
    values: [medidaPartos],
    includeTotals: true,
    limit: 10_000,
  });
  const historicoCombinado = await ejecutarConsultaEgresos({
    years: aniosDisponibles,
    rows: ["ANIO"],
    columns: [],
    values: [
      { field: "TOTAL_EGRESOS", aggregation: "COUNT" },
      medidaPartos,
    ],
    includeTotals: true,
    limit: 10_000,
  });
  assert.deepEqual(
    partosPorAnio(historicoAislado),
    partosPorAnio(historicoCombinado),
    "la medida aislada y combinada deben coincidir en todos los años"
  );

  const resumenHistorico = await obtenerResumenEgresos();
  assert.deepEqual(
    partosPorAnio(historicoAislado),
    Object.fromEntries(
      resumenHistorico.map((fila) => [
        Number(fila.anio),
        Number(fila.total_partos ?? 0),
      ])
    ),
    "el resumen histórico debe conservar la misma fórmula por año"
  );

  await obtenerPoolActual().end();
})();
