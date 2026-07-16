import assert from "node:assert/strict";

import { inicializarPool, pool } from "../src/base_datos/pool";
import { ejecutarConsultaEgresos } from "../src/servicios/egresos-pivot.servicio";

const totalEgresos = (resultado: Awaited<ReturnType<typeof ejecutarConsultaEgresos>>) =>
  Number(resultado.totalGeneral?.["Total de Egresos"] ?? 0);

const columnasDiagnostico = (resultado: Awaited<ReturnType<typeof ejecutarConsultaEgresos>>) => {
  const fila = resultado.datos[0];
  if (!fila) return [];

  return Object.keys(fila).filter(
    (key) => key !== "Total de Egresos" && !key.includes("Municipio") && !key.includes("Departamento")
  );
};

(async () => {
  await inicializarPool();

  const consultaBase = {
    years: [2025],
    rows: ["MUNICIPIO_PACIENTE"],
    values: [{ field: "TOTAL_EGRESOS", aggregation: "COUNT" }],
    includeTotals: true,
    limit: 10000,
  };

  const codigosFiltrados = ["O02.1", "O30.0", "O30.1"];

  const conDiagnosticoEnColumnas = await ejecutarConsultaEgresos({
    ...consultaBase,
    columns: ["DIAGNOSTICOS_EGRESO"],
    filters: [{ field: "DIAGNOSTICOS_EGRESO", values: codigosFiltrados }],
  });

  assert.ok(conDiagnosticoEnColumnas.datos.length > 0, "debe devolver filas");
  assert.ok(totalEgresos(conDiagnosticoEnColumnas) > 0, "debe tener total de egresos");

  const columnas = columnasDiagnostico(conDiagnosticoEnColumnas);
  assert.ok(columnas.length > 0, "debe generar columnas de diagnóstico");
  assert.equal(
    columnas.length,
    codigosFiltrados.length,
    `debe respetar subcodigos exactos, obtuvo ${columnas.length}: ${columnas.join(" | ")}`
  );

  for (const columna of columnas) {
    const codigoColumna = columna.trim().split(/\s+/)[0] ?? "";
    const coincide = codigosFiltrados.some((codigo) => {
      const normalizado = codigo.replace(/\./g, "").toUpperCase();
      const colNormalizado = codigoColumna.replace(/\./g, "").toUpperCase();
      return colNormalizado === normalizado;
    });
    assert.ok(
      coincide,
      `columna inesperada "${columna}"; solo se permiten ${codigosFiltrados.join(", ")}`
    );
    assert.ok(!/\|/.test(columna), `columna concatenada detectada: "${columna}"`);
  }

  const categoriaParto = await ejecutarConsultaEgresos({
    years: [2025],
    rows: [],
    columns: ["DIAGNOSTICOS_EGRESO"],
    values: [{ field: "TOTAL_EGRESOS", aggregation: "COUNT" }],
    filters: [{ field: "DIAGNOSTICOS_EGRESO", values: ["O80"] }],
    includeTotals: true,
    limit: 500,
  });

  const columnasParto = columnasDiagnostico(categoriaParto);
  for (const columna of columnasParto) {
    const codigo = (columna.trim().split(/\s+/)[0] ?? "").replace(/\./g, "").toUpperCase();
    assert.ok(
      codigo.startsWith("O80"),
      `categoría O80 no debe mezclar otros códigos: "${columna}"`
    );
    assert.ok(!codigo.startsWith("O63"), `O63 mezclado en columna de parto: "${columna}"`);
  }

  await pool?.end();
})();
