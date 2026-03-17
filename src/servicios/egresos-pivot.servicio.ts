import type { RowDataPacket } from "mysql2";
import { obtenerPoolActual } from "../base_datos/pool";

const tomarPool = () => obtenerPoolActual();

type AggregationType = "SUM" | "AVG" | "COUNT" | "MAX" | "MIN";

interface DimensionDef {
  id: string;
  label: string;
  column: string;
  type: "string" | "number";
  filterable?: boolean;
  formatValue?: (value: unknown) => string | number;
}

interface MeasureDef {
  id: string;
  label: string;
  description: string;
  expression: string;
  defaultAggregation: AggregationType;
}

const MESES_LABELS: Record<number, string> = {
  1: "Enero",
  2: "Febrero",
  3: "Marzo",
  4: "Abril",
  5: "Mayo",
  6: "Junio",
  7: "Julio",
  8: "Agosto",
  9: "Septiembre",
  10: "Octubre",
  11: "Noviembre",
  12: "Diciembre",
};

const SEXO_LABELS: Record<number, string> = {
  1: "Hombre",
  2: "Mujer",
  9: "Desconocido",
};

// Convención histórica usada en los egresos hospitalarios.
const TIPO_EDAD_LABELS: Record<number, string> = {
  1: "Horas",
  2: "Días",
  3: "Meses",
  4: "Años",
};

const normalizarNumero = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatearMes = (value: unknown): string | number => {
  const numero = normalizarNumero(value);
  if (numero === null) return "Sin dato";
  return MESES_LABELS[numero] ?? `Mes ${numero}`;
};

const formatearSexo = (value: unknown): string | number => {
  const numero = normalizarNumero(value);
  if (numero === null) return "Sin dato";
  return SEXO_LABELS[numero] ?? `Código ${numero}`;
};

const formatearTipoEdad = (value: unknown): string | number => {
  const numero = normalizarNumero(value);
  if (numero === null) return "Sin dato";
  return TIPO_EDAD_LABELS[numero] ?? `Tipo ${numero}`;
};

const formatearEstablecimiento = (value: unknown): string | number => {
  const numero = normalizarNumero(value);
  if (numero === null) return "Sin dato";
  return `US ${numero}`;
};

const formatearCodigo = (prefix: string) => (value: unknown): string | number => {
  const numero = normalizarNumero(value);
  if (numero === null) return "Sin dato";
  return `${prefix} ${numero}`;
};

const BASE_FROM = `
  FROM EHO_BDT_EGR_GENERAL g
  LEFT JOIN EHO_CAT_SEXO sexo
    ON sexo.CODIGO = g.C_PAC_SEXO
  LEFT JOIN (
    SELECT
      CAST(N_EDAD AS SIGNED) AS edad_num,
      CAST(C_EDAD AS SIGNED) AS edad_tipo,
      MAX(NULLIF(TRIM(GRUPO_EDAD_Quinquenal), '')) AS grupo_edad_quinquenal
    FROM EHO_CAT_GRUPOS_EDAD
    GROUP BY CAST(N_EDAD AS SIGNED), CAST(C_EDAD AS SIGNED)
  ) grupo_edad
    ON grupo_edad.edad_num = g.N_PAC_EDAD
   AND grupo_edad.edad_tipo = g.C_PAC_EDAD_TIPO
  LEFT JOIN (
    SELECT
      C_US,
      N_ANIO,
      N_MES,
      N_PAGINA,
      COUNT(*) AS total_diagnosticos
    FROM EHO_BDT_EGR_DIAGNOSTICOS
    GROUP BY C_US, N_ANIO, N_MES, N_PAGINA
  ) dx
    ON dx.C_US = g.C_US
   AND dx.N_ANIO = g.N_ANIO
   AND dx.N_MES = g.N_MES
   AND dx.N_PAGINA = g.N_PAGINA
  LEFT JOIN (
    SELECT
      C_US,
      N_ANIO,
      N_MES,
      N_PAGINA,
      COUNT(*) AS total_operaciones
    FROM EHO_BDT_EGR_OPERACIONES
    GROUP BY C_US, N_ANIO, N_MES, N_PAGINA
  ) op
    ON op.C_US = g.C_US
   AND op.N_ANIO = g.N_ANIO
   AND op.N_MES = g.N_MES
   AND op.N_PAGINA = g.N_PAGINA
  LEFT JOIN (
    SELECT
      C_US,
      N_ANIO,
      N_MES,
      N_PAGINA,
      COUNT(*) AS total_partos
    FROM EHO_BDT_EGR_PARTOS
    GROUP BY C_US, N_ANIO, N_MES, N_PAGINA
  ) pt
    ON pt.C_US = g.C_US
   AND pt.N_ANIO = g.N_ANIO
   AND pt.N_MES = g.N_MES
   AND pt.N_PAGINA = g.N_PAGINA
`;

const DIMENSIONES: DimensionDef[] = [
  { id: "ANIO", label: "Año", column: "g.N_ANIO", type: "number" },
  { id: "MES", label: "Mes", column: "g.N_MES", type: "number", formatValue: formatearMes },
  { id: "ESTABLECIMIENTO", label: "Establecimiento", column: "g.C_US", type: "number", formatValue: formatearEstablecimiento },
  { id: "SEXO", label: "Sexo", column: "g.C_PAC_SEXO", type: "number", formatValue: formatearSexo },
  { id: "TIPO_EDAD", label: "Tipo de Edad", column: "g.C_PAC_EDAD_TIPO", type: "number", formatValue: formatearTipoEdad },
  {
    id: "GRUPO_EDAD",
    label: "Grupo de Edad",
    column: "COALESCE(grupo_edad.grupo_edad_quinquenal, 'Sin grupo')",
    type: "string",
  },
  {
    id: "CONDICION_SALIDA",
    label: "Condición de Salida",
    column: "g.C_CONDICION_SALIDA",
    type: "number",
    formatValue: formatearCodigo("Condición"),
  },
  {
    id: "RAZON_SALIDA",
    label: "Razón de Salida",
    column: "g.C_RAZON_SALIDA",
    type: "number",
    formatValue: formatearCodigo("Razón"),
  },
];

const MEDIDAS: MeasureDef[] = [
  {
    id: "TOTAL_EGRESOS",
    label: "Total de Egresos",
    description: "Cantidad total de egresos hospitalarios",
    expression: "COUNT(*)",
    defaultAggregation: "COUNT",
  },
  {
    id: "DIAS_ESTANCIA",
    label: "Días de Estancia",
    description: "Suma de días de estancia registrados",
    expression: "SUM(COALESCE(g.Q_DIAS_ESTANCIA, 0))",
    defaultAggregation: "SUM",
  },
  {
    id: "ESTANCIA_PROMEDIO",
    label: "Estancia Promedio",
    description: "Promedio de días de estancia",
    expression: "ROUND(AVG(COALESCE(g.Q_DIAS_ESTANCIA, 0)), 2)",
    defaultAggregation: "AVG",
  },
  {
    id: "TOTAL_DIAGNOSTICOS",
    label: "Total de Diagnósticos",
    description: "Diagnósticos asociados a los egresos",
    expression: "SUM(COALESCE(dx.total_diagnosticos, 0))",
    defaultAggregation: "SUM",
  },
  {
    id: "TOTAL_OPERACIONES",
    label: "Total de Operaciones",
    description: "Operaciones asociadas a los egresos",
    expression: "SUM(COALESCE(op.total_operaciones, 0))",
    defaultAggregation: "SUM",
  },
  {
    id: "TOTAL_PARTOS",
    label: "Total de Partos",
    description: "Partos asociados a los egresos",
    expression: "SUM(COALESCE(pt.total_partos, 0))",
    defaultAggregation: "SUM",
  },
  {
    id: "REFERIDOS",
    label: "Referidos",
    description: "Egresos con referencia a otra US",
    expression: "SUM(CASE WHEN COALESCE(g.C_US_REFERIDO, 0) <> 0 THEN 1 ELSE 0 END)",
    defaultAggregation: "SUM",
  },
];

const obtenerDimension = (dimensionId: string) => DIMENSIONES.find((dim) => dim.id === dimensionId);

const obtenerMedida = (measureId: string) => MEDIDAS.find((measure) => measure.id === measureId);

const formatearDimension = (dimension: DimensionDef, value: unknown) => {
  if (dimension.formatValue) {
    return dimension.formatValue(value);
  }
  return value ?? "Sin dato";
};

const normalizarValorMedida = (value: unknown) => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return value;
};

const normalizarMedidas = (
  row: Record<string, unknown>,
  measures: MeasureDef[]
): Record<string, unknown> => {
  const normalized = { ...row };
  for (const measure of measures) {
    if (Object.prototype.hasOwnProperty.call(normalized, measure.label)) {
      normalized[measure.label] = normalizarValorMedida(normalized[measure.label]);
    }
  }
  return normalized;
};

const obtenerAniosSolicitados = (payload: EgresosPivotPayload): number[] => {
  const sourceYears = payload.years?.length ? payload.years : payload.year ? [payload.year] : [];
  return Array.from(
    new Set(
      sourceYears
        .map((year) => Number(year))
        .filter((year) => Number.isInteger(year) && year >= 2000 && year <= 2100)
    )
  ).sort((a, b) => a - b);
};

const construirWhere = (payload: EgresosPivotPayload, anios: number[]) => {
  const whereParts: string[] = [];
  const whereParams: Array<string | number> = [];

  if (anios.length > 0) {
    whereParts.push(`g.N_ANIO IN (${anios.map(() => "?").join(",")})`);
    whereParams.push(...anios);
  }

  for (const filter of payload.filters ?? []) {
    const dimension = obtenerDimension(filter.field);
    if (!dimension || !dimension.filterable && dimension.filterable !== undefined) continue;
    if (!filter.values || filter.values.length === 0) continue;
    const values = filter.values.filter((value) => value !== undefined && value !== null && value !== "");
    if (values.length === 0) continue;

    const placeholders = values.map(() => "?").join(",");
    whereParts.push(`${dimension.column} IN (${placeholders})`);
    whereParams.push(...values);
  }

  return {
    whereClause: whereParts.length > 0 ? ` WHERE ${whereParts.join(" AND ")}` : "",
    whereParams,
  };
};

const enriquecerFila = (
  row: Record<string, unknown>,
  dimensions: DimensionDef[]
): Record<string, unknown> => {
  const enriched = { ...row };
  for (const dimension of dimensions) {
    if (Object.prototype.hasOwnProperty.call(enriched, dimension.label)) {
      enriched[dimension.label] = formatearDimension(dimension, enriched[dimension.label]);
    }
  }
  return enriched;
};

export const obtenerAniosEgresos = async (): Promise<number[]> => {
  const pool = tomarPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT g.N_ANIO AS anio
     FROM EHO_BDT_EGR_GENERAL g
     ORDER BY g.N_ANIO DESC`
  );

  return rows
    .map((row) => Number(row.anio))
    .filter((anio) => Number.isInteger(anio));
};

export const obtenerCatalogoEgresos = async () => {
  const aniosDisponibles = await obtenerAniosEgresos();

  return {
    dimensiones: DIMENSIONES.map((dimension) => ({
      id: dimension.id,
      etiqueta: dimension.label,
      tipo: dimension.type,
      admiteFiltrado: true,
      endpointValores: `/api/egresos-pivot/dimensiones/${dimension.id}/valores`,
    })),
    medidas: MEDIDAS.map((measure) => ({
      id: measure.id,
      etiqueta: measure.label,
      descripcion: measure.description,
      tipoValor: "number" as const,
      agregacionPorDefecto: measure.defaultAggregation,
    })),
    aniosDisponibles,
    actualizadoEn: new Date().toISOString(),
  };
};

export const obtenerValoresDimensionEgresos = async (
  dimensionId: string,
  busqueda?: string,
  limite?: number
): Promise<Array<{ valor: number | string; etiqueta: string }>> => {
  const dimension = obtenerDimension(dimensionId);
  if (!dimension) return [];

  const pool = tomarPool();
  let sql = `SELECT DISTINCT ${dimension.column} AS valor ${BASE_FROM}`;
  const params: Array<string | number> = [];

  if (busqueda?.trim()) {
    sql += ` WHERE CAST(${dimension.column} AS CHAR) LIKE ?`;
    params.push(`%${busqueda.trim()}%`);
  }

  sql += ` ORDER BY ${dimension.column}`;
  if (limite) {
    sql += ` LIMIT ${Math.min(Math.max(limite, 1), 200)}`;
  }

  const [rows] = await pool.query<RowDataPacket[]>(sql, params);
  return rows
    .filter((row) => row.valor !== null && row.valor !== undefined)
    .map((row) => {
    const valor = row.valor as string | number;
    const etiqueta = String(formatearDimension(dimension, valor));
    return { valor, etiqueta };
    });
};

export interface EgresosPivotPayload {
  year?: number;
  years?: number[];
  filters?: Array<{ field: string; values?: Array<string | number> }>;
  rows?: string[];
  columns?: string[];
  values: Array<{ field: string; aggregation?: string }>;
  limit?: number;
  includeTotals?: boolean;
}

export const ejecutarConsultaEgresos = async (
  payload: EgresosPivotPayload
): Promise<{
  datos: Array<Record<string, unknown>>;
  totalGeneral: Record<string, unknown> | null;
  aniosConsultados: number[];
  metadata: {
    dimensionesFilas: string[];
    dimensionesColumnas: string[];
    dimensionesSeleccionadas: string[];
    medidasSeleccionadas: string[];
  };
}> => {
  const pool = tomarPool();
  const aniosConsultados = obtenerAniosSolicitados(payload);
  const filaDims = (payload.rows ?? [])
    .map(obtenerDimension)
    .filter((dim): dim is DimensionDef => dim !== undefined);
  const colDims = (payload.columns ?? [])
    .map(obtenerDimension)
    .filter((dim): dim is DimensionDef => dim !== undefined);
  const allDims = [...filaDims, ...colDims];

  const medidasSel = payload.values
    .map((value) => obtenerMedida(value.field))
    .filter((measure): measure is MeasureDef => measure !== undefined);

  if (medidasSel.length === 0) {
    medidasSel.push(MEDIDAS[0]!);
  }

  const selectParts = [
    ...allDims.map((dim) => `${dim.column} AS \`${dim.label}\``),
    ...medidasSel.map((measure) => `${measure.expression} AS \`${measure.label}\``),
  ];

  const { whereClause, whereParams } = construirWhere(payload, aniosConsultados);
  const sqlParts = [`SELECT ${selectParts.join(", ")}`, BASE_FROM, whereClause];

  if (allDims.length > 0) {
    sqlParts.push(` GROUP BY ${allDims.map((dim) => dim.column).join(", ")}`);
    sqlParts.push(` ORDER BY ${allDims.map((dim) => dim.column).join(", ")}`);
  }

  sqlParts.push(` LIMIT ${Math.min(Math.max(payload.limit ?? 5000, 1), 10000)}`);

  const [rows] = await pool.query<RowDataPacket[]>(sqlParts.join(""), whereParams);
  const datos = rows.map((row) =>
    normalizarMedidas(
      enriquecerFila(row as Record<string, unknown>, allDims),
      medidasSel
    )
  );

  let totalGeneral: Record<string, unknown> | null = null;
  if (payload.includeTotals !== false) {
    const totalSql = `
      SELECT ${medidasSel.map((measure) => `${measure.expression} AS \`${measure.label}\``).join(", ")}
      ${BASE_FROM}
      ${whereClause}
    `;
    const [totalRows] = await pool.query<RowDataPacket[]>(totalSql, whereParams);
    totalGeneral = totalRows[0]
      ? normalizarMedidas(totalRows[0] as Record<string, unknown>, medidasSel)
      : null;
  }

  return {
    datos,
    totalGeneral,
    aniosConsultados,
    metadata: {
      dimensionesFilas: filaDims.map((dim) => dim.label),
      dimensionesColumnas: colDims.map((dim) => dim.label),
      dimensionesSeleccionadas: allDims.map((dim) => dim.label),
      medidasSeleccionadas: medidasSel.map((measure) => measure.label),
    },
  };
};

export const obtenerResumenEgresos = async () => {
  const pool = tomarPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `
      SELECT
        g.N_ANIO AS anio,
        COUNT(*) AS total_egresos,
        SUM(COALESCE(g.Q_DIAS_ESTANCIA, 0)) AS dias_estancia,
        SUM(COALESCE(dx.total_diagnosticos, 0)) AS total_diagnosticos,
        SUM(COALESCE(op.total_operaciones, 0)) AS total_operaciones,
        SUM(COALESCE(pt.total_partos, 0)) AS total_partos
      ${BASE_FROM}
      GROUP BY g.N_ANIO
      ORDER BY g.N_ANIO
    `
  );

  return rows.map((row) =>
    normalizarMedidas(row as Record<string, unknown>, [
      {
        id: "TOTAL_EGRESOS",
        label: "total_egresos",
        description: "",
        expression: "",
        defaultAggregation: "COUNT",
      },
      {
        id: "DIAS_ESTANCIA",
        label: "dias_estancia",
        description: "",
        expression: "",
        defaultAggregation: "SUM",
      },
      {
        id: "TOTAL_DIAGNOSTICOS",
        label: "total_diagnosticos",
        description: "",
        expression: "",
        defaultAggregation: "SUM",
      },
      {
        id: "TOTAL_OPERACIONES",
        label: "total_operaciones",
        description: "",
        expression: "",
        defaultAggregation: "SUM",
      },
      {
        id: "TOTAL_PARTOS",
        label: "total_partos",
        description: "",
        expression: "",
        defaultAggregation: "SUM",
      },
    ])
  );
};
