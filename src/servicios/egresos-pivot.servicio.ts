import type { RowDataPacket } from "mysql2";
import { obtenerPoolActual } from "../base_datos/pool";

const tomarPool = () => obtenerPoolActual();

type AggregationType = "SUM" | "AVG" | "COUNT" | "MAX" | "MIN";
type JoinKey =
  | "US"
  | "REGIONES"
  | "NIVEL_EST"
  | "DEPTOS"
  | "DEPTO_PACIENTE"
  | "MUNICIPIOS_PACIENTE"
  | "GRUPO_EDAD"
  | "DIAGSET"
  | "DX"
  | "DX_RAW"
  | "OP"
  | "OP_RAW"
  | "PT"
  | "PT_RAW"
  | "CAUSAS";
interface QueryJoinContext {
  anios?: number[];
  regionIds?: number[] | null;
}

interface DimensionDef {
  id: string;
  label: string;
  column: string;
  type: "string" | "number";
  filterable?: boolean;
  matchAllValues?: boolean;
  joins?: JoinKey[];
  filterJoins?: JoinKey[];
  formatValue?: (value: unknown) => string | number;
}

interface MeasureDef {
  id: string;
  label: string;
  description: string;
  expression: string;
  defaultAggregation: AggregationType;
  joins?: JoinKey[];
}

interface QueryMeasureDef extends MeasureDef {}

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

const formatearFecha = (value: unknown): string | number => {
  if (!value) return "Sin dato";
  const fecha = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(fecha.getTime())) return "Sin dato";
  return new Intl.DateTimeFormat("es-HN", {
    dateStyle: "medium",
  }).format(fecha);
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
  return numero;
};

const formatearDepartamento = (value: unknown): string | number => {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return "Sin dato";
};

const formatearCodigo = (prefix: string) => (value: unknown): string | number => {
  const numero = normalizarNumero(value);
  if (numero === null) return "Sin dato";
  return `${prefix} ${numero}`;
};

const formatearTexto = (value: unknown): string | number => {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return "Sin dato";
};

const DIAGNOSTICO_BASE_SQL = "COALESCE(NULLIF(TRIM(causas.C_CIE1), ''), NULLIF(TRIM(g.C_INGRESO_CIE_1), ''), '')";
const DIAGNOSTICO_DETALLE_SQL = "COALESCE(NULLIF(TRIM(d.C_CIE), ''), '')";
const DIAGNOSTICO_DETALLE_NORMALIZADO_SQL = `
  REPLACE(REPLACE(UPPER(${DIAGNOSTICO_DETALLE_SQL}), '.', ''), '*', '')
`;
const GE_ASI_SQL = `
  CASE
    WHEN g.C_PAC_EDAD_TIPO IN (1, 2) THEN '< 1 Mes'
    WHEN g.C_PAC_EDAD_TIPO = 3 AND g.N_PAC_EDAD BETWEEN 1 AND 11 THEN '1-11 Meses'
    WHEN g.C_PAC_EDAD_TIPO = 3 AND g.N_PAC_EDAD = 12 THEN '1- 4 Años'
    WHEN g.C_PAC_EDAD_TIPO = 4 AND g.N_PAC_EDAD BETWEEN 1 AND 4 THEN '1- 4 Años'
    WHEN g.C_PAC_EDAD_TIPO = 4 AND g.N_PAC_EDAD BETWEEN 5 AND 9 THEN '5- 9 Años'
    WHEN g.C_PAC_EDAD_TIPO = 4 AND g.N_PAC_EDAD BETWEEN 10 AND 14 THEN '10- 14 Años'
    WHEN g.C_PAC_EDAD_TIPO = 4 AND g.N_PAC_EDAD BETWEEN 15 AND 19 THEN '15- 19 Años'
    WHEN g.C_PAC_EDAD_TIPO = 4 AND g.N_PAC_EDAD BETWEEN 20 AND 49 THEN '20- 49 Años'
    WHEN g.C_PAC_EDAD_TIPO = 4 AND g.N_PAC_EDAD BETWEEN 50 AND 59 THEN '50- 59 Años'
    WHEN g.C_PAC_EDAD_TIPO = 4 AND g.N_PAC_EDAD >= 60 THEN '60 y mas Años'
    ELSE 'Sin grupo'
  END
`;

const normalizarEnteros = (values?: Array<number | string> | null) =>
  Array.from(
    new Set(
      (values ?? [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value))
    )
  );

const normalizarCodigoDiagnostico = (value: string | number) =>
  String(value).trim().toUpperCase().replace(/\./g, "").replace(/\*/g, "");

const construirWhereSubqueryPorPeriodo = (alias: string, context: QueryJoinContext) => {
  const anios = normalizarEnteros(context.anios);
  const regiones = normalizarEnteros(context.regionIds);
  const whereParts: string[] = [];
  let joinRegion = "";

  if (anios.length > 0) {
    whereParts.push(`${alias}.N_ANIO IN (${anios.join(",")})`);
  }

  if (regiones.length > 0) {
    joinRegion = `
      LEFT JOIN BAS_BDR_US us_${alias}
        ON us_${alias}.C_US = ${alias}.C_US
    `;
    whereParts.push(`us_${alias}.C_REGION IN (${regiones.join(",")})`);
  }

  return {
    joinRegion,
    whereClause: whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "",
  };
};

const JOIN_DEFINITIONS: Record<JoinKey, { sql: (context: QueryJoinContext) => string; dependsOn?: JoinKey[] }> = {
  US: {
    sql: () => `
      LEFT JOIN BAS_BDR_US us
        ON us.C_US = g.C_US
    `,
  },
  REGIONES: {
    dependsOn: ["US"],
    sql: () => `
      LEFT JOIN BAS_BDR_REGIONES regiones
        ON regiones.C_REGION = us.C_REGION
    `,
  },
  NIVEL_EST: {
    dependsOn: ["US"],
    sql: () => `
      LEFT JOIN cat_nivel_establecimiento nivel_est
        ON CAST(nivel_est.codigo AS SIGNED) = us.C_NIVEL_US
    `,
  },
  DEPTOS: {
    dependsOn: ["US"],
    sql: () => `
      LEFT JOIN BAS_BDR_DEPARTAMENTOS deptos
        ON deptos.C_DEPARTAMENTO = us.C_DEPARTAMENTO
    `,
  },
  DEPTO_PACIENTE: {
    sql: () => `
      LEFT JOIN BAS_BDR_DEPARTAMENTOS deptos_paciente
        ON deptos_paciente.C_DEPARTAMENTO = g.C_PAC_DEPARTAMENTO
    `,
  },
  MUNICIPIOS_PACIENTE: {
    sql: () => `
      LEFT JOIN BAS_BDR_MUNICIPIOS municipios_paciente
        ON municipios_paciente.C_DEPARTAMENTO = g.C_PAC_DEPARTAMENTO
       AND municipios_paciente.C_MUNICIPIO = g.C_PAC_MUNICIPIO
    `,
  },
  GRUPO_EDAD: {
    sql: () => `
      LEFT JOIN (
        SELECT
          CAST(N_EDAD AS SIGNED) AS edad_num,
          CAST(C_EDAD AS SIGNED) AS edad_tipo,
          MAX(NULLIF(TRIM(GRUPO_EDAD_Quinquenal), '')) AS grupo_edad_quinquenal,
          MAX(NULLIF(TRIM(GRUPO_EDAD_PMA), '')) AS grupo_edad_pma,
          MAX(NULLIF(TRIM(GRUPO_EDAD_SIDA_COMISCA), '')) AS grupo_edad_sida_comisca
        FROM EHO_CAT_GRUPOS_EDAD
        GROUP BY CAST(N_EDAD AS SIGNED), CAST(C_EDAD AS SIGNED)
      ) grupo_edad
        ON grupo_edad.edad_num = g.N_PAC_EDAD
       AND grupo_edad.edad_tipo = g.C_PAC_EDAD_TIPO
    `,
  },
  DIAGSET: {
    sql: (context) => {
      const { joinRegion, whereClause } = construirWhereSubqueryPorPeriodo("diag_src", context);
      return `
      LEFT JOIN (
        SELECT
          diag_src.C_US,
          diag_src.N_ANIO,
          diag_src.N_MES,
          diag_src.N_PAGINA,
          GROUP_CONCAT(DISTINCT NULLIF(TRIM(diag_src.C_CIE), '') ORDER BY diag_src.C_CIE SEPARATOR ' | ') AS diagnosticos_egreso
        FROM EHO_BDT_EGR_DIAGNOSTICOS diag_src
        ${joinRegion}
        ${whereClause}
        GROUP BY diag_src.C_US, diag_src.N_ANIO, diag_src.N_MES, diag_src.N_PAGINA
      ) diagset
        ON diagset.C_US = g.C_US
       AND diagset.N_ANIO = g.N_ANIO
       AND diagset.N_MES = g.N_MES
       AND diagset.N_PAGINA = g.N_PAGINA
    `;
    },
  },
  DX: {
    sql: (context) => {
      const { joinRegion, whereClause } = construirWhereSubqueryPorPeriodo("dx_src", context);
      return `
      LEFT JOIN (
        SELECT
          dx_src.C_US,
          dx_src.N_ANIO,
          dx_src.N_MES,
          dx_src.N_PAGINA,
          COUNT(*) AS total_diagnosticos
        FROM EHO_BDT_EGR_DIAGNOSTICOS dx_src
        ${joinRegion}
        ${whereClause}
        GROUP BY dx_src.C_US, dx_src.N_ANIO, dx_src.N_MES, dx_src.N_PAGINA
      ) dx
        ON dx.C_US = g.C_US
       AND dx.N_ANIO = g.N_ANIO
       AND dx.N_MES = g.N_MES
       AND dx.N_PAGINA = g.N_PAGINA
    `;
    },
  },
  DX_RAW: {
    sql: () => `
      LEFT JOIN EHO_BDT_EGR_DIAGNOSTICOS dx_raw
        ON dx_raw.C_US = g.C_US
       AND dx_raw.N_ANIO = g.N_ANIO
       AND dx_raw.N_MES = g.N_MES
       AND dx_raw.N_PAGINA = g.N_PAGINA
    `,
  },
  OP: {
    sql: (context) => {
      const { joinRegion, whereClause } = construirWhereSubqueryPorPeriodo("op_src", context);
      return `
      LEFT JOIN (
        SELECT
          op_src.C_US,
          op_src.N_ANIO,
          op_src.N_MES,
          op_src.N_PAGINA,
          COUNT(*) AS total_operaciones
        FROM EHO_BDT_EGR_OPERACIONES op_src
        ${joinRegion}
        ${whereClause}
        GROUP BY op_src.C_US, op_src.N_ANIO, op_src.N_MES, op_src.N_PAGINA
      ) op
        ON op.C_US = g.C_US
       AND op.N_ANIO = g.N_ANIO
       AND op.N_MES = g.N_MES
       AND op.N_PAGINA = g.N_PAGINA
    `;
    },
  },
  OP_RAW: {
    sql: () => `
      LEFT JOIN EHO_BDT_EGR_OPERACIONES op_raw
        ON op_raw.C_US = g.C_US
       AND op_raw.N_ANIO = g.N_ANIO
       AND op_raw.N_MES = g.N_MES
       AND op_raw.N_PAGINA = g.N_PAGINA
    `,
  },
  PT: {
    sql: (context) => {
      const { joinRegion, whereClause } = construirWhereSubqueryPorPeriodo("pt_src", context);
      return `
      LEFT JOIN (
        SELECT
          pt_src.C_US,
          pt_src.N_ANIO,
          pt_src.N_MES,
          pt_src.N_PAGINA,
          COUNT(*) AS total_partos
        FROM EHO_BDT_EGR_PARTOS pt_src
        ${joinRegion}
        ${whereClause}
        GROUP BY pt_src.C_US, pt_src.N_ANIO, pt_src.N_MES, pt_src.N_PAGINA
      ) pt
        ON pt.C_US = g.C_US
       AND pt.N_ANIO = g.N_ANIO
       AND pt.N_MES = g.N_MES
       AND pt.N_PAGINA = g.N_PAGINA
    `;
    },
  },
  PT_RAW: {
    sql: () => `
      LEFT JOIN EHO_BDT_EGR_PARTOS pt_raw
        ON pt_raw.C_US = g.C_US
       AND pt_raw.N_ANIO = g.N_ANIO
       AND pt_raw.N_MES = g.N_MES
       AND pt_raw.N_PAGINA = g.N_PAGINA
    `,
  },
  CAUSAS: {
    sql: () => `
      LEFT JOIN EHO_TABLA_TODAS_CAUSAS causas
        ON causas.C_US = g.C_US
       AND causas.N_ANIO = g.N_ANIO
       AND causas.N_MES = g.N_MES
       AND causas.N_PAGINA = g.N_PAGINA
    `,
  },
};

const DIMENSIONES: DimensionDef[] = [
  { id: "ANIO", label: "Año", column: "g.N_ANIO", type: "number" },
  { id: "MES", label: "Mes", column: "g.N_MES", type: "number", formatValue: formatearMes },
  {
    id: "REGION",
    label: "Región",
    column: "COALESCE(regiones.D_REGION, CONCAT('Region ', us.C_REGION))",
    type: "string",
    joins: ["REGIONES"],
  },
  {
    id: "DEPARTAMENTO",
    label: "Departamento",
    column: "COALESCE(deptos.D_DEPARTAMENTO, 'Sin departamento')",
    type: "string",
    joins: ["DEPTOS"],
    formatValue: formatearDepartamento,
  },
  {
    id: "DEPTO_PACIENTE",
    label: "Departamento del Paciente",
    column: "COALESCE(deptos_paciente.D_DEPARTAMENTO, CONCAT('Departamento ', g.C_PAC_DEPARTAMENTO))",
    type: "string",
    joins: ["DEPTO_PACIENTE"],
    formatValue: formatearDepartamento,
  },
  {
    id: "MUN_PACIENTE",
    label: "Municipio del Paciente",
    column: "COALESCE(municipios_paciente.D_MUNICIPIO, CONCAT(g.C_PAC_DEPARTAMENTO, '-', g.C_PAC_MUNICIPIO))",
    type: "string",
    joins: ["MUNICIPIOS_PACIENTE"],
  },
  {
    id: "CATEGORIA_ESTABLECIMIENTO",
    label: "Categoría de Establecimiento",
    column: "COALESCE(nivel_est.descripcion, 'Sin categoría')",
    type: "string",
    joins: ["NIVEL_EST"],
  },
  { id: "ESTABLECIMIENTO", label: "Establecimiento", column: "g.C_US", type: "number", formatValue: formatearEstablecimiento },
  {
    id: "SERVICIO",
    label: "Servicio",
    column: "COALESCE(g.C_EGRESO_SERVICIO, g.C_INGRESO_SERVICIO)",
    type: "number",
    formatValue: formatearCodigo("Servicio"),
  },
  {
    id: "SALA",
    label: "Sala",
    column: "COALESCE(g.C_EGRESO_SALA, g.C_INGRESO_SALA)",
    type: "number",
    formatValue: formatearCodigo("Sala"),
  },
  {
    id: "DIAGNOSTICO",
    label: "Diagnóstico",
    column: `COALESCE(NULLIF(TRIM(${DIAGNOSTICO_BASE_SQL}), ''), 'Sin diagnóstico')`,
    type: "string",
    joins: ["CAUSAS"],
    formatValue: formatearTexto,
  },
  {
    id: "DIAGNOSTICOS_EGRESO",
    label: "Diagnósticos del Egreso",
    column: "COALESCE(diagset.diagnosticos_egreso, 'Sin diagnóstico')",
    type: "string",
    matchAllValues: true,
    joins: ["DIAGSET"],
    filterJoins: [],
    formatValue: formatearTexto,
  },
  {
    id: "CODIGO_ORDEN_AFECCION",
    label: "Código Orden Afección",
    column: "COALESCE(causas.C_CORRELATIVO1, 1)",
    type: "number",
    joins: ["CAUSAS"],
  },
  { id: "PAGINA", label: "Página", column: "g.N_PAGINA", type: "number" },
  { id: "N_HISTORIA_CLINICA", label: "Historia Clínica", column: "g.N_HISTORIA_CLINICA", type: "number" },
  { id: "NUMERO_EDAD", label: "Número de Edad", column: "g.N_PAC_EDAD", type: "number" },
  { id: "FECHA_EGRESO", label: "Fecha de Egreso", column: "g.F_EGRESO", type: "string", formatValue: formatearFecha },
  { id: "SEXO", label: "Sexo", column: "g.C_PAC_SEXO", type: "number", formatValue: formatearSexo },
  { id: "TIPO_EDAD", label: "Tipo de Edad", column: "g.C_PAC_EDAD_TIPO", type: "number", formatValue: formatearTipoEdad },
  {
    id: "GRUPO_EDAD",
    label: "Grupo de Edad",
    column: "COALESCE(grupo_edad.grupo_edad_quinquenal, 'Sin grupo')",
    type: "string",
    joins: ["GRUPO_EDAD"],
  },
  {
    id: "GRUPO_EDAD_PMA",
    label: "Grupo de Edad PMA",
    column: "COALESCE(grupo_edad.grupo_edad_pma, 'Sin grupo')",
    type: "string",
    joins: ["GRUPO_EDAD"],
  },
  {
    id: "GE_QUINQUENAL",
    label: "GE Quinquenal",
    column: "COALESCE(grupo_edad.grupo_edad_quinquenal, 'Sin grupo')",
    type: "string",
    joins: ["GRUPO_EDAD"],
  },
  {
    id: "GE_ASI",
    label: "GE ASI",
    column: GE_ASI_SQL,
    type: "string",
    formatValue: formatearTexto,
  },
  {
    id: "GE_VIH",
    label: "GE VIH",
    column: "COALESCE(grupo_edad.grupo_edad_sida_comisca, 'Sin grupo')",
    type: "string",
    joins: ["GRUPO_EDAD"],
    formatValue: formatearTexto,
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
    joins: ["DX"],
  },
  {
    id: "TOTAL_OPERACIONES",
    label: "Total de Operaciones",
    description: "Operaciones asociadas a los egresos",
    expression: "SUM(COALESCE(op.total_operaciones, 0))",
    defaultAggregation: "SUM",
    joins: ["OP"],
  },
  {
    id: "TOTAL_PARTOS",
    label: "Total de Partos",
    description: "Partos asociados a los egresos",
    expression: "SUM(COALESCE(pt.total_partos, 0))",
    defaultAggregation: "SUM",
    joins: ["PT"],
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

const optimizarMedidasConsulta = (measures: MeasureDef[]): QueryMeasureDef[] => {
  if (measures.length !== 1) {
    return [...measures];
  }

  const [measure] = measures;
  if (!measure) return [];

  if (measure.id === "TOTAL_DIAGNOSTICOS") {
    return [{ ...measure, expression: "COUNT(dx_raw.C_CORRELATIVO)", joins: ["DX_RAW"] }];
  }
  if (measure.id === "TOTAL_OPERACIONES") {
    return [{ ...measure, expression: "COUNT(op_raw.C_CORRELATIVO)", joins: ["OP_RAW"] }];
  }
  if (measure.id === "TOTAL_PARTOS") {
    return [{ ...measure, expression: "COUNT(pt_raw.C_CORRELATIVO)", joins: ["PT_RAW"] }];
  }

  return [...measures];
};

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

const puedeDerivarTotalesDesdeDatos = (measures: MeasureDef[]) =>
  measures.every((measure) => measure.id !== "ESTANCIA_PROMEDIO");

const derivarTotalGeneralDesdeDatos = (
  datos: Array<Record<string, unknown>>,
  measures: MeasureDef[]
): Record<string, unknown> | null => {
  if (!datos.length) return null;
  const total: Record<string, unknown> = {};

  for (const measure of measures) {
    if (measure.id === "ESTANCIA_PROMEDIO") {
      return null;
    }

    const valor = datos.reduce((acc, row) => {
      const current = row[measure.label];
      return acc + (typeof current === "number" ? current : Number(current) || 0);
    }, 0);

    total[measure.label] = valor;
  }

  return total;
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

const obtenerJoinsDimension = (
  dimension: DimensionDef,
  purpose: "select" | "filter" | "value" = "select"
): JoinKey[] => {
  if (purpose === "filter") {
    return dimension.filterJoins ?? dimension.joins ?? [];
  }
  return dimension.joins ?? [];
};

const resolverJoinKeys = (joinKeys: Iterable<JoinKey>): JoinKey[] => {
  const ordered: JoinKey[] = [];
  const visiting = new Set<JoinKey>();
  const visited = new Set<JoinKey>();

  const visit = (joinKey: JoinKey) => {
    if (visited.has(joinKey)) return;
    if (visiting.has(joinKey)) return;
    visiting.add(joinKey);
    for (const dependency of JOIN_DEFINITIONS[joinKey].dependsOn ?? []) {
      visit(dependency);
    }
    visiting.delete(joinKey);
    visited.add(joinKey);
    ordered.push(joinKey);
  };

  for (const joinKey of joinKeys) {
    visit(joinKey);
  }

  return ordered;
};

const construirFromDinamico = (joinKeys: Iterable<JoinKey>, context: QueryJoinContext = {}) => {
  const orderedJoinKeys = resolverJoinKeys(joinKeys);
  const joinsSql = orderedJoinKeys
    .map((joinKey) => JOIN_DEFINITIONS[joinKey].sql(context).trim())
    .join("\n");
  return joinsSql
    ? `FROM EHO_BDT_EGR_GENERAL g\n${joinsSql}`
    : `FROM EHO_BDT_EGR_GENERAL g`;
};

const recolectarJoinKeysConsulta = ({
  dimensions = [],
  filterDimensions = [],
  measures = [],
  requiereAlcanceRegional = false,
}: {
  dimensions?: DimensionDef[];
  filterDimensions?: DimensionDef[];
  measures?: MeasureDef[];
  requiereAlcanceRegional?: boolean;
}) => {
  const joinKeys = new Set<JoinKey>();

  if (requiereAlcanceRegional) {
    joinKeys.add("US");
  }

  for (const dimension of dimensions) {
    for (const joinKey of obtenerJoinsDimension(dimension, "select")) {
      joinKeys.add(joinKey);
    }
  }

  for (const dimension of filterDimensions) {
    for (const joinKey of obtenerJoinsDimension(dimension, "filter")) {
      joinKeys.add(joinKey);
    }
  }

  for (const measure of measures) {
    for (const joinKey of measure.joins ?? []) {
      joinKeys.add(joinKey);
    }
  }

  return joinKeys;
};

const construirFiltroDiagnosticoEgreso = (
  dimensionId: string,
  values: Array<string | number>
) => {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  const selectByDimension: Record<string, string> = {
    DIAGNOSTICOS_EGRESO: "COALESCE(NULLIF(TRIM(d.C_CIE), ''), 'Sin diagnóstico')",
  };

  const selectedColumn = selectByDimension[dimensionId];
  if (!selectedColumn) {
    return { clauses, params };
  }

  for (const value of values) {
    clauses.push(`
      EXISTS (
        SELECT 1
        FROM EHO_BDT_EGR_DIAGNOSTICOS d
        WHERE d.C_US = g.C_US
          AND d.N_ANIO = g.N_ANIO
          AND d.N_MES = g.N_MES
          AND d.N_PAGINA = g.N_PAGINA
          AND (
            ${selectedColumn} = ?
            OR ${DIAGNOSTICO_DETALLE_NORMALIZADO_SQL} = ?
          )
      )
    `);
    params.push(value, normalizarCodigoDiagnostico(value));
  }

  return { clauses, params };
};

const construirWhere = (payload: EgresosPivotPayload, anios: number[], regionIds?: number[] | null) => {
  const whereParts: string[] = [];
  const whereParams: Array<string | number> = [];

  if (anios.length > 0) {
    whereParts.push(`g.N_ANIO IN (${anios.map(() => "?").join(",")})`);
    whereParams.push(...anios);
  }

  if (regionIds?.length) {
    whereParts.push(`us.C_REGION IN (${regionIds.map(() => "?").join(",")})`);
    whereParams.push(...regionIds);
  }

  for (const filter of payload.filters ?? []) {
    const dimension = obtenerDimension(filter.field);
    if (!dimension || !dimension.filterable && dimension.filterable !== undefined) continue;
    if (!filter.values || filter.values.length === 0) continue;
    const values = filter.values.filter((value) => value !== undefined && value !== null && value !== "");
    if (values.length === 0) continue;

    if (dimension.matchAllValues) {
      const { clauses, params } = construirFiltroDiagnosticoEgreso(dimension.id, values);
      if (clauses.length) {
        whereParts.push(...clauses);
        whereParams.push(...params);
        continue;
      }
    }

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
  limite?: number,
  regionIds?: number[] | null
): Promise<Array<{ valor: number | string; etiqueta: string }>> => {
  const dimension = obtenerDimension(dimensionId);
  if (!dimension) return [];

  const pool = tomarPool();

  const sqlByDimensionLigera: Record<string, string> = {
    DIAGNOSTICOS_EGRESO: `
      SELECT DISTINCT COALESCE(NULLIF(TRIM(d.C_CIE), ''), 'Sin diagnóstico') AS valor, us.C_REGION
      FROM EHO_BDT_EGR_DIAGNOSTICOS d
      LEFT JOIN BAS_BDR_US us
        ON us.C_US = d.C_US
    `,
  };

  if (sqlByDimensionLigera[dimensionId]) {
    let sql = `SELECT DISTINCT valor FROM (${sqlByDimensionLigera[dimensionId]}) AS valores_dim`;
    const params: Array<string | number> = [];
    const whereParts: string[] = [];

    if (regionIds?.length && dimensionId === "DIAGNOSTICOS_EGRESO") {
      whereParts.push(`C_REGION IN (${regionIds.map(() => "?").join(",")})`);
      params.push(...regionIds);
    }

    if (busqueda?.trim()) {
      whereParts.push(`CAST(valor AS CHAR) LIKE ?`);
      params.push(`%${busqueda.trim()}%`);
    }

    if (whereParts.length) {
      sql += ` WHERE ${whereParts.join(" AND ")}`;
    }

    sql += ` ORDER BY valor`;
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
  }

  if (dimension.matchAllValues) {
    let sql = `SELECT DISTINCT valor FROM (${sqlByDimensionLigera[dimensionId]}) AS valores_diag`;
    const params: Array<string | number> = [];
    const whereParts: string[] = [];

    if (regionIds?.length) {
      whereParts.push(`C_REGION IN (${regionIds.map(() => "?").join(",")})`);
      params.push(...regionIds);
    }

    if (busqueda?.trim()) {
      whereParts.push(`CAST(valor AS CHAR) LIKE ?`);
      params.push(`%${busqueda.trim()}%`);
    }

    if (whereParts.length) {
      sql += ` WHERE ${whereParts.join(" AND ")}`;
    }

    sql += ` ORDER BY valor`;
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
  }

  const fromClause = construirFromDinamico(
    recolectarJoinKeysConsulta({
      dimensions: [dimension],
      requiereAlcanceRegional: Boolean(regionIds?.length),
    }),
    { regionIds }
  );

  let sql = `SELECT DISTINCT ${dimension.column} AS valor ${fromClause}`;
  const params: Array<string | number> = [];

  const whereParts: string[] = [];
  if (regionIds?.length) {
    whereParts.push(`us.C_REGION IN (${regionIds.map(() => "?").join(",")})`);
    params.push(...regionIds);
  }
  if (busqueda?.trim()) {
    whereParts.push(`CAST(${dimension.column} AS CHAR) LIKE ?`);
    params.push(`%${busqueda.trim()}%`);
  }

  if (whereParts.length) {
    sql += ` WHERE ${whereParts.join(" AND ")}`;
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
  payload: EgresosPivotPayload,
  regionIds?: number[] | null
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

  const medidasBase = payload.values
    .map((value) => obtenerMedida(value.field))
    .filter((measure): measure is MeasureDef => measure !== undefined);

  if (medidasBase.length === 0) {
    medidasBase.push(MEDIDAS[0]!);
  }

  const medidasSel = optimizarMedidasConsulta(medidasBase);

  const filterDims = (payload.filters ?? [])
    .map((filter) => obtenerDimension(filter.field))
    .filter((dim): dim is DimensionDef => dim !== undefined);

  const fromClause = construirFromDinamico(
    recolectarJoinKeysConsulta({
      dimensions: allDims,
      filterDimensions: filterDims,
      measures: medidasSel,
      requiereAlcanceRegional: Boolean(regionIds?.length),
    }),
    { anios: aniosConsultados, regionIds }
  );

  const selectParts = [
    ...allDims.map((dim) => `${dim.column} AS \`${dim.label}\``),
    ...medidasSel.map((measure) => `${measure.expression} AS \`${measure.label}\``),
  ];

  const { whereClause, whereParams } = construirWhere(payload, aniosConsultados, regionIds);
  const sqlParts = [`SELECT ${selectParts.join(", ")}`, fromClause, whereClause];

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
  const appliedLimit = Math.min(Math.max(payload.limit ?? 5000, 1), 10000);

  let totalGeneral: Record<string, unknown> | null = null;
  if (payload.includeTotals !== false) {
    const puedeDerivarDesdeResultados =
      allDims.length > 0 &&
      puedeDerivarTotalesDesdeDatos(medidasSel) &&
      datos.length < appliedLimit;

    if (puedeDerivarDesdeResultados) {
      totalGeneral = derivarTotalGeneralDesdeDatos(datos, medidasSel);
    } else {
      const totalSql = `
        SELECT ${medidasSel.map((measure) => `${measure.expression} AS \`${measure.label}\``).join(", ")}
        ${fromClause}
        ${whereClause}
      `;
      const [totalRows] = await pool.query<RowDataPacket[]>(totalSql, whereParams);
      totalGeneral = totalRows[0]
        ? normalizarMedidas(totalRows[0] as Record<string, unknown>, medidasSel)
        : null;
    }
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

export const obtenerResumenEgresos = async (regionIds?: number[] | null) => {
  const pool = tomarPool();
  const measures = ["TOTAL_DIAGNOSTICOS", "TOTAL_OPERACIONES", "TOTAL_PARTOS"]
    .map((measureId) => obtenerMedida(measureId))
    .filter((measure): measure is MeasureDef => measure !== undefined);
  const fromClause = construirFromDinamico(
    recolectarJoinKeysConsulta({
      measures,
      requiereAlcanceRegional: Boolean(regionIds?.length),
    }),
    { regionIds }
  );
  const whereClause = regionIds?.length
    ? `WHERE us.C_REGION IN (${regionIds.map(() => "?").join(",")})`
    : "";
  const [rows] = await pool.query<RowDataPacket[]>(
    `
      SELECT
        g.N_ANIO AS anio,
        COUNT(*) AS total_egresos,
        SUM(COALESCE(g.Q_DIAS_ESTANCIA, 0)) AS dias_estancia,
        SUM(COALESCE(dx.total_diagnosticos, 0)) AS total_diagnosticos,
        SUM(COALESCE(op.total_operaciones, 0)) AS total_operaciones,
        SUM(COALESCE(pt.total_partos, 0)) AS total_partos
      ${fromClause}
      ${whereClause}
      GROUP BY g.N_ANIO
      ORDER BY g.N_ANIO
    `,
    [...(regionIds ?? [])]
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
