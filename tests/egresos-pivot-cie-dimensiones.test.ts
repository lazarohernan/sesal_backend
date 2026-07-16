import assert from "node:assert/strict";

import { inicializarPool, pool } from "../src/base_datos/pool";
import {
  ejecutarConsultaEgresos,
  obtenerCatalogoEgresos,
  obtenerValoresDimensionEgresos,
} from "../src/servicios/egresos-pivot.servicio";

(async () => {
  await inicializarPool();

  const catalogo = await obtenerCatalogoEgresos();
  const idsDimensiones = new Set(catalogo.dimensiones.map((dimension) => dimension.id));

  for (const id of ["CIE_CATEGORIA", "CIE_CAPITULO", "CIE_GRUPO"]) {
    assert.ok(idsDimensiones.has(id), `debe exponer dimensión ${id}`);
  }

  const capitulos = await obtenerValoresDimensionEgresos("CIE_CAPITULO");
  assert.equal(
    capitulos.find((item) => Number(item.valor) === 15)?.etiqueta,
    "15 Embarazo, parto y puerperio"
  );

  const grupos = await obtenerValoresDimensionEgresos("CIE_GRUPO");
  assert.equal(
    grupos.find((item) => item.valor === "15:6")?.etiqueta,
    "Capítulo 15 — 6 Parto"
  );

  const categorias = await obtenerValoresDimensionEgresos("CIE_CATEGORIA");
  assert.equal(
    categorias.find((item) => item.valor === "O80")?.etiqueta,
    "O80 Parto Unico Espontaneo"
  );

  const porCategoria = await ejecutarConsultaEgresos({
    years: [2025],
    rows: [],
    columns: ["CIE_CATEGORIA"],
    filters: [{ field: "CIE_CATEGORIA", values: ["O80"] }],
    values: [{ field: "TOTAL_EGRESOS", aggregation: "COUNT" }],
    includeTotals: true,
    limit: 500,
  });

  const columnas = Object.keys(porCategoria.datos[0] ?? {}).filter(
    (key) => key !== "Total de Egresos"
  );
  assert.ok(columnas.length > 0, "debe generar columnas por categoría O80");
  assert.ok(
    columnas.some((columna) => columna === "O80 Parto Unico Espontaneo"),
    "debe mostrar código y nombre de la categoría O80"
  );
  for (const columna of columnas) {
    assert.ok(
      columna.trim().startsWith("O80"),
      `columna inesperada para filtro O80: "${columna}"`
    );
    assert.ok(!columna.includes("O63"), `O63 mezclado en categoría parto: "${columna}"`);
  }

  const porCapitulo = await ejecutarConsultaEgresos({
    years: [2025],
    rows: ["CIE_CAPITULO"],
    columns: [],
    filters: [{ field: "CIE_CAPITULO", values: [15] }],
    values: [{ field: "EGRESOS_EMBARAZO", aggregation: "SUM" }],
    includeTotals: true,
    limit: 200,
  });

  assert.ok(porCapitulo.datos.length > 0, "capítulo 15 debe devolver filas");
  assert.ok(
    Number(porCapitulo.totalGeneral?.["Egresos con Embarazo"] ?? 0) > 0,
    "capítulo 15 debe tener egresos con embarazo"
  );

  const partosAdolescentes = await ejecutarConsultaEgresos({
    years: [2025],
    rows: ["CIE_CAPITULO"],
    columns: ["GE_ASI"],
    filters: [
      { field: "GE_ASI", values: ["10- 14 Años", "15- 19 Años"] },
      { field: "CIE_CAPITULO", values: [15] },
      { field: "CIE_GRUPO", values: ["15:6"] },
    ],
    values: [{ field: "TOTAL_EGRESOS", aggregation: "COUNT" }],
    includeTotals: true,
    limit: 200,
  });

  assert.equal(partosAdolescentes.datos.length, 1, "solo debe aparecer el capítulo 15");
  assert.equal(
    partosAdolescentes.datos[0]?.["CIE CAPÍTULO"],
    "15 Embarazo, parto y puerperio"
  );
  assert.equal(partosAdolescentes.datos[0]?.["10- 14 Años"], 957);
  assert.equal(partosAdolescentes.datos[0]?.["15- 19 Años"], 18_524);
  assert.equal(partosAdolescentes.totalGeneral?.["Total de Egresos"], 19_481);

  const partosPorGrupo = await ejecutarConsultaEgresos({
    years: [2025],
    rows: ["CIE_GRUPO"],
    columns: [],
    filters: [
      { field: "CIE_CAPITULO", values: [15] },
      { field: "CIE_GRUPO", values: ["15:6"] },
    ],
    values: [{ field: "TOTAL_EGRESOS", aggregation: "COUNT" }],
    includeTotals: true,
    limit: 20,
  });
  assert.equal(partosPorGrupo.datos[0]?.["CIE GRUPO"], "6 Parto");

  await pool?.end();
})();
