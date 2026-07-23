import assert from "node:assert/strict";

import { inicializarPool, obtenerPoolActual } from "../src/base_datos/pool";
import { ejecutarConsultaEgresos } from "../src/servicios/egresos-pivot.servicio";
import {
  obtenerDatosMapaHondurasEgresos,
  obtenerIndicadoresDepartamentoEgresos,
  obtenerIndicadoresTableroEgresos,
} from "../src/servicios/egresos-tablero.servicio";

const ANIOS_COMPARACION = [2023, 2024, 2025];
const DEPARTAMENTO_MUESTRA = 8;
const EGRESOS_OFICIALES_ACCESS: Record<number, number> = {
  2023: 362_235,
  2024: 372_578,
  2025: 347_427,
};
const BLOQUES_HOSPITAL_ESCUELA_2025: Record<number, number> = {
  281: 21_317,
  302: 22_074,
};

const numero = (valor: unknown) => Number(valor ?? 0);

(async () => {
  await inicializarPool();

  try {
    const medidas = [
      { field: "TOTAL_EGRESOS", aggregation: "COUNT" },
      { field: "DIAS_ESTANCIA", aggregation: "SUM" },
      { field: "ESTANCIA_PROMEDIO", aggregation: "AVG" },
      { field: "TOTAL_DIAGNOSTICOS", aggregation: "SUM" },
      { field: "TOTAL_OPERACIONES", aggregation: "SUM" },
      { field: "TOTAL_PARTOS", aggregation: "SUM" },
      { field: "REFERIDOS", aggregation: "SUM" },
    ];

    const [pivoteHistorico, mapa, tableros] = await Promise.all([
      ejecutarConsultaEgresos({
        years: ANIOS_COMPARACION,
        rows: ["ANIO"],
        columns: [],
        values: medidas,
        includeTotals: true,
        limit: 100,
      }),
      obtenerDatosMapaHondurasEgresos(),
      Promise.all(
        ANIOS_COMPARACION.map((anio) =>
          obtenerIndicadoresTableroEgresos({ anio })
        )
      ),
    ]);

    const filasPorAnio = new Map(
      pivoteHistorico.datos.map((fila) => [numero(fila["Año"]), fila])
    );

    ANIOS_COMPARACION.forEach((anio, indice) => {
      const fila = filasPorAnio.get(anio);
      const tablero = tableros[indice]!;
      assert.ok(fila, `el pivote debe devolver el año ${anio}`);

      assert.equal(
        numero(fila["Total de Egresos"]),
        tablero.resumen.totalEgresos,
        `egresos: pivote y tablero deben coincidir en ${anio}`
      );
      assert.equal(
        tablero.resumen.totalEgresos,
        EGRESOS_OFICIALES_ACCESS[anio],
        `el total nacional ${anio} debe coincidir con la fuente Access oficial`
      );
      assert.equal(
        numero(fila["Estancia Promedio"]),
        tablero.resumen.estanciaPromedio,
        `estancia promedio: pivote y tablero deben coincidir en ${anio}`
      );
      assert.equal(
        numero(fila["Total de Diagnósticos"]),
        tablero.resumen.totalDiagnosticos,
        `diagnósticos: pivote y tablero deben coincidir en ${anio}`
      );
      assert.equal(
        numero(fila["Total de Operaciones"]),
        tablero.resumen.totalOperaciones,
        `operaciones: pivote y tablero deben coincidir en ${anio}`
      );
      assert.equal(
        numero(fila["Total de Partos"]),
        tablero.resumen.totalPartos,
        `partos: pivote y tablero deben coincidir en ${anio}`
      );
      assert.equal(
        numero(fila["Referidos"]),
        tablero.resumen.referidos,
        `referidos: pivote y tablero deben coincidir en ${anio}`
      );

      const totalMapa = mapa.reduce(
        (acumulado, departamento) =>
          acumulado + numero(departamento.totalesPorAnio[anio]),
        0
      );
      assert.equal(
        totalMapa,
        tablero.resumen.totalEgresos,
        `mapa y tablero deben conservar el total nacional en ${anio}`
      );
    });

    const departamentoMapa = mapa.find(
      (departamento) => departamento.departamentoId === DEPARTAMENTO_MUESTRA
    );
    assert.ok(departamentoMapa, "el departamento de muestra debe existir en el mapa");

    const [departamentoTablero, departamentoPivote] = await Promise.all([
      obtenerIndicadoresDepartamentoEgresos({
        departamentoId: DEPARTAMENTO_MUESTRA,
        anio: 2025,
      }),
      ejecutarConsultaEgresos({
        years: [2025],
        filters: [
          {
            field: "DEPARTAMENTO",
            values: [departamentoMapa.nombre],
          },
        ],
        rows: [],
        columns: [],
        values: medidas,
        includeTotals: true,
        limit: 10,
      }),
    ]);

    assert.equal(
      numero(departamentoMapa.totalesPorAnio[2025]),
      departamentoTablero.totalEgresos,
      "mapa y detalle territorial deben coincidir en el departamento de muestra"
    );
    assert.equal(
      numero(departamentoPivote.totalGeneral?.["Total de Egresos"]),
      departamentoTablero.totalEgresos,
      "pivote y detalle territorial deben coincidir en egresos"
    );
    assert.equal(
      numero(departamentoPivote.totalGeneral?.["Días de Estancia"]),
      departamentoTablero.diasEstancia,
      "pivote y detalle territorial deben coincidir en días de estancia"
    );
    assert.equal(
      numero(departamentoPivote.totalGeneral?.["Total de Diagnósticos"]),
      departamentoTablero.totalDiagnosticos,
      "pivote y detalle territorial deben coincidir en diagnósticos"
    );
    assert.equal(
      numero(departamentoPivote.totalGeneral?.["Total de Operaciones"]),
      departamentoTablero.totalOperaciones,
      "pivote y detalle territorial deben coincidir en operaciones"
    );
    assert.equal(
      numero(departamentoPivote.totalGeneral?.["Total de Partos"]),
      departamentoTablero.totalPartos,
      "pivote y detalle territorial deben coincidir en partos"
    );

    const bloquesHospitalEscuela = await Promise.all(
      Object.keys(BLOQUES_HOSPITAL_ESCUELA_2025).map(async (codigoTexto) => {
        const codigo = Number(codigoTexto);
        const resultado = await ejecutarConsultaEgresos({
          years: [2025],
          filters: [{ field: "ESTABLECIMIENTO", values: [codigo] }],
          rows: [],
          columns: [],
          values: [{ field: "TOTAL_EGRESOS", aggregation: "COUNT" }],
          includeTotals: true,
          limit: 10,
        });
        return [codigo, numero(resultado.totalGeneral?.["Total de Egresos"])] as const;
      })
    );

    bloquesHospitalEscuela.forEach(([codigo, total]) => {
      assert.equal(
        total,
        BLOQUES_HOSPITAL_ESCUELA_2025[codigo],
        `el bloque ${codigo} de Hospital Escuela debe coincidir con Access`
      );
    });
  } finally {
    await obtenerPoolActual().end();
  }
})();
