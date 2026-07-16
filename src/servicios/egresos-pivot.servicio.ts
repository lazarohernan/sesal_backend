import type { RowDataPacket } from "mysql2";
import { obtenerPoolActual } from "../base_datos/pool";
import { cache, CACHE_TTL } from "../utilidades/cache.utilidad";
import {
  CIE_PARTO_CATEGORIAS,
  construirCondicionAbortoCieSql,
  construirCondicionEmbarazoCieSql,
  esCodigoCategoriaCie,
  normalizarCodigoCie,
} from "./egresos-cie.util";

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
  | "CIE_DX_RAW"
  | "CIE_CAPITULO_CAT"
  | "CIE_GRUPO_CAT"
  | "CIE_CATEGORIA_CAT"
  | "DX_PRINCIPAL"
  | "CIE_CAUSAS"
  | "CIE_INGRESO"
  | "OP"
  | "OPSET"
  | "OP_RAW"
  | "OP_PRINCIPAL"
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
  hiddenFromCatalog?: boolean;
  filterColumn?: string;
  groupBy?: string;
  orderBy?: string;
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
  9: "Desconocido",
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

const formatearRegionSanitaria = (value: unknown): string | number => {
  const texto = formatearTexto(value);
  if (typeof texto !== "string") return texto;
  return texto.replace(/^Departamental de /, "Región Sanitaria de ");
};

const normalizarCodigoCieSql = (expresion: string) =>
  `REPLACE(REPLACE(UPPER(${expresion}), '.', ''), '*', '')`;

const DIAGNOSTICO_INGRESO_1_SQL = "COALESCE(NULLIF(TRIM(g.C_INGRESO_CIE_1), ''), '')";
const DIAGNOSTICO_INGRESO_2_SQL = "COALESCE(NULLIF(TRIM(g.C_INGRESO_CIE_2), ''), '')";
const DIAGNOSTICO_INGRESO_1_NORMALIZADO_SQL = normalizarCodigoCieSql(DIAGNOSTICO_INGRESO_1_SQL);
const DIAGNOSTICO_INGRESO_2_NORMALIZADO_SQL = normalizarCodigoCieSql(DIAGNOSTICO_INGRESO_2_SQL);
const DIAGNOSTICO_BASE_SQL = "COALESCE(NULLIF(TRIM(causas.C_CIE1), ''), NULLIF(TRIM(g.C_INGRESO_CIE_1), ''), '')";
const DIAGNOSTICO_DETALLE_SQL = "COALESCE(NULLIF(TRIM(d.C_CIE), ''), '')";
const DIAGNOSTICO_EGRESO_PRINCIPAL_SQL = "COALESCE(NULLIF(TRIM(dx_principal.C_CIE), ''), '')";
const DIAGNOSTICO_BASE_ETIQUETA_SQL = `
  CASE
    WHEN NULLIF(TRIM(${DIAGNOSTICO_BASE_SQL}), '') IS NULL THEN 'Sin diagnóstico'
    WHEN NULLIF(TRIM(cie_base.D_CIE), '') IS NULL THEN TRIM(${DIAGNOSTICO_BASE_SQL})
    ELSE CONCAT(TRIM(${DIAGNOSTICO_BASE_SQL}), ' ', TRIM(cie_base.D_CIE))
  END
`;
const DIAGNOSTICO_INGRESO_ETIQUETA_SQL = `
  CASE
    WHEN NULLIF(TRIM(${DIAGNOSTICO_INGRESO_1_SQL}), '') IS NULL THEN 'Sin diagnóstico'
    WHEN NULLIF(TRIM(cie_ingreso.D_CIE), '') IS NULL THEN TRIM(${DIAGNOSTICO_INGRESO_1_SQL})
    ELSE CONCAT(TRIM(${DIAGNOSTICO_INGRESO_1_SQL}), ' ', TRIM(cie_ingreso.D_CIE))
  END
`;
const DIAGNOSTICO_EGRESO_PRINCIPAL_ETIQUETA_SQL = `
  CASE
    WHEN NULLIF(TRIM(${DIAGNOSTICO_EGRESO_PRINCIPAL_SQL}), '') IS NULL THEN 'Sin diagnóstico'
    WHEN NULLIF(TRIM(cie_egreso_principal.D_CIE), '') IS NULL THEN TRIM(${DIAGNOSTICO_EGRESO_PRINCIPAL_SQL})
    ELSE CONCAT(TRIM(${DIAGNOSTICO_EGRESO_PRINCIPAL_SQL}), ' ', TRIM(cie_egreso_principal.D_CIE))
  END
`;
const DIAGNOSTICO_DETALLE_NORMALIZADO_SQL = normalizarCodigoCieSql(DIAGNOSTICO_DETALLE_SQL);
const DIAGNOSTICO_DETALLE_CODIGO_DX_SQL = "COALESCE(NULLIF(TRIM(dx_raw.C_CIE), ''), '')";
const DIAGNOSTICO_DETALLE_NORMALIZADO_DX_SQL = normalizarCodigoCieSql(DIAGNOSTICO_DETALLE_CODIGO_DX_SQL);
const DIAGNOSTICO_DETALLE_ETIQUETA_SQL = `
  CASE
    WHEN NULLIF(TRIM(${DIAGNOSTICO_DETALLE_CODIGO_DX_SQL}), '') IS NULL THEN 'Sin diagnóstico'
    WHEN NULLIF(TRIM(cie_dx_raw.D_CIE), '') IS NULL THEN TRIM(${DIAGNOSTICO_DETALLE_CODIGO_DX_SQL})
    ELSE CONCAT(TRIM(${DIAGNOSTICO_DETALLE_CODIGO_DX_SQL}), ' ', TRIM(cie_dx_raw.D_CIE))
  END
`;
const EGRESO_CLAVE_SQL = "CONCAT(g.C_US, '|', g.N_ANIO, '|', g.N_MES, '|', g.N_PAGINA)";
const CIE_CATEGORIA_CODIGO_SQL =
  "COALESCE(NULLIF(TRIM(cie_dx_raw.C_CIE_CATEGORIA), ''), 'Sin categoría')";
const CIE_CAPITULO_CODIGO_SQL =
  "COALESCE(CAST(cie_dx_raw.C_CIE_CAPITULO AS CHAR), 'Sin capítulo')";
const CIE_GRUPO_CODIGO_SQL = "COALESCE(CAST(cie_dx_raw.C_CIE_GRUPO AS CHAR), 'Sin grupo')";
const CIE_CATEGORIA_COLUMNA_SQL = `
  CASE
    WHEN cie_dx_raw.C_CIE_CATEGORIA IS NULL THEN 'Sin categoría'
    WHEN NULLIF(TRIM(cie_categoria_cat.D_CIE_CATEGORIA), '') IS NULL THEN TRIM(cie_dx_raw.C_CIE_CATEGORIA)
    ELSE CONCAT(TRIM(cie_dx_raw.C_CIE_CATEGORIA), ' ', TRIM(cie_categoria_cat.D_CIE_CATEGORIA))
  END
`;
const CIE_CAPITULO_COLUMNA_SQL = `
  CASE
    WHEN cie_dx_raw.C_CIE_CAPITULO IS NULL THEN 'Sin capítulo'
    WHEN NULLIF(TRIM(cie_capitulo_cat.D_CIE_CAPITULO), '') IS NULL THEN CAST(cie_dx_raw.C_CIE_CAPITULO AS CHAR)
    ELSE CONCAT(cie_dx_raw.C_CIE_CAPITULO, ' ', TRIM(cie_capitulo_cat.D_CIE_CAPITULO))
  END
`;
const CIE_GRUPO_COLUMNA_SQL = `
  CASE
    WHEN cie_dx_raw.C_CIE_GRUPO IS NULL THEN 'Sin grupo'
    WHEN NULLIF(TRIM(cie_grupo_cat.D_CIE_GRUPO), '') IS NULL THEN CAST(cie_dx_raw.C_CIE_GRUPO AS CHAR)
    ELSE CONCAT(cie_dx_raw.C_CIE_GRUPO, ' ', TRIM(cie_grupo_cat.D_CIE_GRUPO))
  END
`;

const DIMENSIONES_LINEA_DIAGNOSTICO = new Set([
  "DIAGNOSTICOS_EGRESO",
  "CIE_CATEGORIA",
  "CIE_CAPITULO",
  "CIE_GRUPO",
]);
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

const normalizarCodigoDiagnostico = normalizarCodigoCie;

const construirCondicionCategoriasParto = (alias: string) => {
  const codigoNormalizado = `REPLACE(REPLACE(UPPER(TRIM(${alias}.C_CIE)), '.', ''), '*', '')`;
  return `(${CIE_PARTO_CATEGORIAS.map((categoria) => `${codigoNormalizado} LIKE '${categoria}%'`).join(" OR ")})`;
};

/** Misma lógica que el mapa de egresos (egresos-tablero.servicio). */
const construirCondicionPartoAdolescenteEnLinea = () =>
  `g.C_PAC_EDAD_TIPO = 4
    AND g.N_PAC_EDAD BETWEEN 10 AND 19
    AND EXISTS (
      SELECT 1
      FROM EHO_BDT_EGR_DIAGNOSTICOS d_parto
      WHERE d_parto.C_US = g.C_US
        AND d_parto.N_ANIO = g.N_ANIO
        AND d_parto.N_MES = g.N_MES
        AND d_parto.N_PAGINA = g.N_PAGINA
        AND ${construirCondicionCategoriasParto("d_parto")}
    )`;

const EXPRESION_PARTOS_ADOLESCENTES = `SUM(CASE WHEN ${construirCondicionPartoAdolescenteEnLinea()} THEN 1 ELSE 0 END)`;

const construirExistsDiagnosticoCie = (aliasDx: string, aliasCie: string, condicionCie: string) =>
  `EXISTS (
      SELECT 1
      FROM EHO_BDT_EGR_DIAGNOSTICOS ${aliasDx}
      INNER JOIN EHO_BDR_CIE ${aliasCie}
        ON ${aliasCie}.C_CIE = ${aliasDx}.C_CIE
      WHERE ${aliasDx}.C_US = g.C_US
        AND ${aliasDx}.N_ANIO = g.N_ANIO
        AND ${aliasDx}.N_MES = g.N_MES
        AND ${aliasDx}.N_PAGINA = g.N_PAGINA
        AND ${condicionCie}
    )`;

const EXPRESION_EGRESOS_EMBARAZO = `SUM(CASE WHEN ${construirExistsDiagnosticoCie("d_emb", "cie_emb", construirCondicionEmbarazoCieSql("cie_emb"))} THEN 1 ELSE 0 END)`;

const EXPRESION_EGRESOS_ABORTO = `SUM(CASE WHEN ${construirExistsDiagnosticoCie("d_abort", "cie_abort", construirCondicionAbortoCieSql("cie_abort"))} THEN 1 ELSE 0 END)`;

const agregarCondicionWhere = (whereClause: string, condition: string) =>
  whereClause.trim() ? `${whereClause} AND ${condition}` : `WHERE ${condition}`;

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
          GROUP_CONCAT(
            DISTINCT
            CASE
              WHEN NULLIF(TRIM(diag_src.C_CIE), '') IS NULL THEN NULL
              WHEN NULLIF(TRIM(cie_diag.D_CIE), '') IS NULL THEN TRIM(diag_src.C_CIE)
              ELSE CONCAT(TRIM(diag_src.C_CIE), ' ', TRIM(cie_diag.D_CIE))
            END
            ORDER BY diag_src.C_CIE
            SEPARATOR ' | '
          ) AS diagnosticos_egreso
        FROM EHO_BDT_EGR_DIAGNOSTICOS diag_src
        ${joinRegion}
        LEFT JOIN EHO_BDR_CIE cie_diag
          ON cie_diag.C_CIE = diag_src.C_CIE
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
  CIE_DX_RAW: {
    dependsOn: ["DX_RAW"],
    sql: () => `
      LEFT JOIN EHO_BDR_CIE cie_dx_raw
        ON cie_dx_raw.C_CIE = dx_raw.C_CIE
    `,
  },
  CIE_CAPITULO_CAT: {
    dependsOn: ["CIE_DX_RAW"],
    sql: () => `
      LEFT JOIN EHO_BDR_CIE_CAPITULOS cie_capitulo_cat
        ON cie_capitulo_cat.C_CIE_CAPITULO = cie_dx_raw.C_CIE_CAPITULO
    `,
  },
  CIE_GRUPO_CAT: {
    dependsOn: ["CIE_DX_RAW"],
    sql: () => `
      LEFT JOIN EHO_BDR_CIE_GRUPOS cie_grupo_cat
        ON cie_grupo_cat.C_CIE_CAPITULO = cie_dx_raw.C_CIE_CAPITULO
       AND cie_grupo_cat.C_CIE_GRUPO = cie_dx_raw.C_CIE_GRUPO
    `,
  },
  CIE_CATEGORIA_CAT: {
    dependsOn: ["CIE_DX_RAW"],
    sql: () => `
      LEFT JOIN EHO_BDR_CIE_CATEGORIAS cie_categoria_cat
        ON cie_categoria_cat.C_CIE_CATEGORIA = cie_dx_raw.C_CIE_CATEGORIA
    `,
  },
  DX_PRINCIPAL: {
    sql: () => `
      LEFT JOIN EHO_BDT_EGR_DIAGNOSTICOS dx_principal
        ON dx_principal.C_US = g.C_US
       AND dx_principal.N_ANIO = g.N_ANIO
       AND dx_principal.N_MES = g.N_MES
       AND dx_principal.N_PAGINA = g.N_PAGINA
       AND dx_principal.C_CORRELATIVO = 1
      LEFT JOIN EHO_BDR_CIE cie_egreso_principal
        ON cie_egreso_principal.C_CIE = dx_principal.C_CIE
    `,
  },
  CIE_CAUSAS: {
    dependsOn: ["CAUSAS"],
    sql: () => `
      LEFT JOIN EHO_BDR_CIE cie_base
        ON cie_base.C_CIE = ${DIAGNOSTICO_BASE_SQL}
    `,
  },
  CIE_INGRESO: {
    sql: () => `
      LEFT JOIN EHO_BDR_CIE cie_ingreso
        ON cie_ingreso.C_CIE = ${DIAGNOSTICO_INGRESO_1_SQL}
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
  OPSET: {
    sql: (context) => {
      const { joinRegion, whereClause } = construirWhereSubqueryPorPeriodo("op_set_src", context);
      return `
      LEFT JOIN (
        SELECT
          op_set_src.C_US,
          op_set_src.N_ANIO,
          op_set_src.N_MES,
          op_set_src.N_PAGINA,
          GROUP_CONCAT(DISTINCT NULLIF(TRIM(op_set_src.C_OPERACION), '') ORDER BY op_set_src.C_CORRELATIVO SEPARATOR ', ') AS operaciones_egreso
        FROM EHO_BDT_EGR_OPERACIONES op_set_src
        ${joinRegion}
        ${whereClause}
        GROUP BY op_set_src.C_US, op_set_src.N_ANIO, op_set_src.N_MES, op_set_src.N_PAGINA
      ) opset
        ON opset.C_US = g.C_US
       AND opset.N_ANIO = g.N_ANIO
       AND opset.N_MES = g.N_MES
       AND opset.N_PAGINA = g.N_PAGINA
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
  OP_PRINCIPAL: {
    sql: () => `
      LEFT JOIN EHO_BDT_EGR_OPERACIONES op_principal
        ON op_principal.C_US = g.C_US
       AND op_principal.N_ANIO = g.N_ANIO
       AND op_principal.N_MES = g.N_MES
       AND op_principal.N_PAGINA = g.N_PAGINA
       AND op_principal.C_CORRELATIVO = 1
    `,
  },
  PT: {
    sql: (context) => {
      const { joinRegion, whereClause } = construirWhereSubqueryPorPeriodo("pt_src", context);
      const wherePartos = agregarCondicionWhere(whereClause, construirCondicionCategoriasParto("pt_src"));
      return `
      LEFT JOIN (
        SELECT
          pt_src.C_US,
          pt_src.N_ANIO,
          pt_src.N_MES,
          pt_src.N_PAGINA,
          1 AS total_partos
        FROM EHO_BDT_EGR_DIAGNOSTICOS pt_src
        ${joinRegion}
        ${wherePartos}
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
      LEFT JOIN EHO_BDT_EGR_DIAGNOSTICOS pt_raw
        ON pt_raw.C_US = g.C_US
       AND pt_raw.N_ANIO = g.N_ANIO
       AND pt_raw.N_MES = g.N_MES
       AND pt_raw.N_PAGINA = g.N_PAGINA
       AND ${construirCondicionCategoriasParto("pt_raw")}
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
    formatValue: formatearRegionSanitaria,
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
    // Fallback a 'Sin departamento' para evitar códigos numéricos en columnas
    column: "COALESCE(NULLIF(deptos_paciente.D_DEPARTAMENTO, ''), 'Sin departamento')",
    type: "string",
    joins: ["DEPTO_PACIENTE"],
    formatValue: formatearDepartamento,
  },
  {
    id: "MUN_PACIENTE",
    label: "Municipio del Paciente",
    // Fallback a 'Sin municipio' para evitar códigos numéricos (0-1, 0-4...) en columnas
    column: "COALESCE(NULLIF(municipios_paciente.D_MUNICIPIO, ''), 'Sin municipio')",
    type: "string",
    joins: ["MUNICIPIOS_PACIENTE"],
  },
  {
    id: "CATEGORIA_ESTABLECIMIENTO",
    label: "Categoría de Establecimiento",
    column: "COALESCE(NULLIF(TRIM(REPLACE(REPLACE(nivel_est.descripcion, CHAR(13), ''), CHAR(10), '')), ''), 'Sin categoría')",
    type: "string",
    joins: ["NIVEL_EST"],
    formatValue: formatearTexto,
  },
  {
    id: "ESTABLECIMIENTO",
    label: "Establecimiento",
    column: "CONCAT(g.C_US, ' - ', COALESCE(NULLIF(TRIM(us.D_US), ''), 'Sin nombre'))",
    filterColumn: "g.C_US",
    groupBy: "g.C_US, us.D_US",
    orderBy: "g.C_US",
    type: "string",
    joins: ["US"],
    filterJoins: ["US"],
    formatValue: formatearTexto,
  },
  {
    id: "SERVICIO",
    label: "Servicio (mixto histórico)",
    column: "COALESCE(g.C_EGRESO_SERVICIO, g.C_INGRESO_SERVICIO)",
    type: "number",
    hiddenFromCatalog: true,
    formatValue: formatearCodigo("Servicio"),
  },
  {
    id: "SALA",
    label: "Sala (mixta histórica)",
    column: "COALESCE(g.C_EGRESO_SALA, g.C_INGRESO_SALA)",
    type: "number",
    hiddenFromCatalog: true,
    formatValue: formatearCodigo("Sala"),
  },
  {
    id: "SERVICIO_INGRESO",
    label: "Servicio de Ingreso",
    column: "g.C_INGRESO_SERVICIO",
    type: "number",
    formatValue: formatearCodigo("Servicio"),
  },
  {
    id: "SERVICIO_EGRESO",
    label: "Servicio de Egreso",
    column: "g.C_EGRESO_SERVICIO",
    type: "number",
    formatValue: formatearCodigo("Servicio"),
  },
  {
    id: "SALA_INGRESO",
    label: "Sala de Ingreso",
    column: "g.C_INGRESO_SALA",
    type: "number",
    formatValue: formatearCodigo("Sala"),
  },
  {
    id: "SALA_EGRESO",
    label: "Sala de Egreso",
    column: "g.C_EGRESO_SALA",
    type: "number",
    formatValue: formatearCodigo("Sala"),
  },
  {
    id: "DIAGNOSTICO",
    label: "Diagnóstico (mixto histórico)",
    column: DIAGNOSTICO_BASE_ETIQUETA_SQL,
    type: "string",
    hiddenFromCatalog: true,
    joins: ["CIE_CAUSAS"],
    formatValue: formatearTexto,
  },
  {
    id: "DIAGNOSTICO_INGRESO",
    label: "Diagnóstico de Ingreso",
    column: DIAGNOSTICO_INGRESO_ETIQUETA_SQL,
    type: "string",
    joins: ["CIE_INGRESO"],
    filterJoins: [],
    formatValue: formatearTexto,
  },
  {
    id: "DIAGNOSTICO_EGRESO_PRINCIPAL",
    label: "Diagnóstico de Egreso Principal",
    column: DIAGNOSTICO_EGRESO_PRINCIPAL_ETIQUETA_SQL,
    type: "string",
    joins: ["DX_PRINCIPAL"],
    filterJoins: [],
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
    id: "CIE_CATEGORIA",
    label: "CATEGORÍA CIE",
    column: CIE_CATEGORIA_COLUMNA_SQL,
    filterColumn: CIE_CATEGORIA_CODIGO_SQL,
    type: "string",
    joins: ["DX_RAW", "CIE_DX_RAW", "CIE_CATEGORIA_CAT"],
    filterJoins: [],
    formatValue: formatearTexto,
  },
  {
    id: "CIE_CAPITULO",
    label: "CIE CAPÍTULO",
    column: CIE_CAPITULO_COLUMNA_SQL,
    filterColumn: CIE_CAPITULO_CODIGO_SQL,
    type: "string",
    joins: ["DX_RAW", "CIE_DX_RAW", "CIE_CAPITULO_CAT"],
    filterJoins: [],
    formatValue: formatearTexto,
  },
  {
    id: "CIE_GRUPO",
    label: "CIE GRUPO",
    column: CIE_GRUPO_COLUMNA_SQL,
    filterColumn: CIE_GRUPO_CODIGO_SQL,
    type: "string",
    joins: ["DX_RAW", "CIE_DX_RAW", "CIE_GRUPO_CAT"],
    filterJoins: [],
    formatValue: formatearTexto,
  },
  {
    id: "CODIGO_ORDEN_AFECCION",
    label: "Código Orden Afección",
    column: "COALESCE(dx_raw.C_CORRELATIVO, 0)",
    type: "number",
    joins: ["DX_RAW"],
  },
  {
    id: "OPERACION_PRINCIPAL",
    label: "Operación Principal",
    column: "COALESCE(NULLIF(TRIM(op_principal.C_OPERACION), ''), 'Sin operación')",
    filterColumn: "NULLIF(TRIM(op_principal.C_OPERACION), '')",
    type: "string",
    joins: ["OP_PRINCIPAL"],
    formatValue: formatearTexto,
  },
  {
    id: "OPERACIONES_EGRESO",
    label: "Operaciones del Egreso",
    column: "COALESCE(opset.operaciones_egreso, 'Sin operación')",
    type: "string",
    joins: ["OPSET"],
    filterJoins: [],
    formatValue: formatearTexto,
  },
  {
    id: "CODIGO_ORDEN_OPERACION",
    label: "Código Orden Operación",
    column: "COALESCE(op_raw.C_CORRELATIVO, 0)",
    type: "number",
    joins: ["OP_RAW"],
  },
  { id: "PAGINA", label: "Página", column: "g.N_PAGINA", type: "number" },
  { id: "N_HISTORIA_CLINICA", label: "Historia Clínica", column: "g.N_HISTORIA_CLINICA", type: "number" },
  { id: "NUMERO_EDAD", label: "Número de Edad", column: "g.N_PAC_EDAD", type: "number" },
  { id: "FECHA_EGRESO", label: "Fecha de Egreso", column: "DATE(g.F_EGRESO)", type: "string", formatValue: formatearFecha },
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
    id: "EGRESOS_CON_OPERACION",
    label: "Egresos con Operación",
    description: "Egresos únicos con al menos una operación registrada",
    expression: "SUM(CASE WHEN COALESCE(op.total_operaciones, 0) > 0 THEN 1 ELSE 0 END)",
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
    id: "PARTOS_ADOLESCENTES",
    label: "Partos Adolescentes",
    description:
      "Egresos de pacientes de 10 a 19 años con diagnóstico de parto (O80, O81, O82, O84). Misma lógica que el mapa de indicadores.",
    expression: EXPRESION_PARTOS_ADOLESCENTES,
    defaultAggregation: "SUM",
  },
  {
    id: "EGRESOS_EMBARAZO",
    label: "Egresos con Embarazo",
    description:
      "Egresos con al menos un diagnóstico marcado como embarazo en el catálogo CIE (B_EMBARAZO=1). Cada egreso se cuenta una sola vez.",
    expression: EXPRESION_EGRESOS_EMBARAZO,
    defaultAggregation: "SUM",
  },
  {
    id: "EGRESOS_ABORTO",
    label: "Egresos con Aborto",
    description:
      "Egresos con diagnóstico de aborto (O03-O08, O02.1, O20.0, O31.1 o descripción con 'Aborto'). Misma lógica que el reporte municipal.",
    expression: EXPRESION_EGRESOS_ABORTO,
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

const usaDesglosePorDiagnosticoLinea = (payload: EgresosPivotPayload) =>
  [...(payload.rows ?? []), ...(payload.columns ?? [])].some((dimensionId) =>
    DIMENSIONES_LINEA_DIAGNOSTICO.has(dimensionId)
  );

/** @deprecated Usar usaDesglosePorDiagnosticoLinea */
const usaDesgloseDiagnosticoEgreso = usaDesglosePorDiagnosticoLinea;

const resolverDimensionConsulta = (
  dimension: DimensionDef,
  payload: EgresosPivotPayload
): DimensionDef => {
  if (!usaDesglosePorDiagnosticoLinea(payload)) {
    return dimension;
  }

  if (dimension.id === "DIAGNOSTICOS_EGRESO") {
    return {
      ...dimension,
      column: DIAGNOSTICO_DETALLE_ETIQUETA_SQL,
      joins: ["DX_RAW", "CIE_DX_RAW"],
      filterJoins: ["DX_RAW"],
    };
  }

  return dimension;
};

const ajustarMedidasParaConsulta = (
  measures: QueryMeasureDef[],
  payload: EgresosPivotPayload
): QueryMeasureDef[] => {
  if (!usaDesglosePorDiagnosticoLinea(payload)) {
    return measures;
  }

  return measures.map((measure) => {
    if (measure.id === "TOTAL_EGRESOS") {
      return {
        ...measure,
        expression: `COUNT(DISTINCT ${EGRESO_CLAVE_SQL})`,
      };
    }

    if (measure.id === "TOTAL_DIAGNOSTICOS") {
      return {
        ...measure,
        expression: "COUNT(dx_raw.C_CORRELATIVO)",
        joins: ["DX_RAW"],
      };
    }

    return measure;
  });
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

const esMedidaAcumulable = (measure: MeasureDef) =>
  measure.defaultAggregation === "SUM" || measure.defaultAggregation === "COUNT";

const etiquetaColumnaPivot = (
  row: Record<string, unknown>,
  columnDimensions: DimensionDef[],
  measure: MeasureDef,
  totalMeasures: number
) => {
  const dimensionLabel = columnDimensions
    .map((dimension) => String(row[dimension.label] ?? "Sin dato").trim())
    .filter(Boolean)
    .join(" / ") || "Sin dato";

  return totalMeasures === 1 ? dimensionLabel : `${dimensionLabel} · ${measure.label}`;
};

const pivotearColumnas = (
  datos: Array<Record<string, unknown>>,
  rowDimensions: DimensionDef[],
  columnDimensions: DimensionDef[],
  measures: QueryMeasureDef[],
  totalGeneral: Record<string, unknown> | null
) => {
  if (!columnDimensions.length) {
    return { datos, totalGeneral };
  }

  const rowsByKey = new Map<string, Record<string, unknown>>();
  const dynamicColumns = new Set<string>();
  const rowKeyFor = (row: Record<string, unknown>) =>
    rowDimensions.length
      ? JSON.stringify(rowDimensions.map((dimension) => row[dimension.label] ?? "Sin dato"))
      : "__total__";

  for (const row of datos) {
    const rowKey = rowKeyFor(row);
    let target = rowsByKey.get(rowKey);

    if (!target) {
      target = {};
      for (const dimension of rowDimensions) {
        target[dimension.label] = row[dimension.label] ?? "Sin dato";
      }
      rowsByKey.set(rowKey, target);
    }

    for (const measure of measures) {
      const columnLabel = etiquetaColumnaPivot(row, columnDimensions, measure, measures.length);
      dynamicColumns.add(columnLabel);

      const value = normalizarValorMedida(row[measure.label]);
      const numericValue = typeof value === "number" ? value : Number(value);
      const current = target[columnLabel];
      target[columnLabel] =
        Number.isFinite(numericValue) && typeof current === "number"
          ? current + numericValue
          : value;

      if (esMedidaAcumulable(measure) && Number.isFinite(numericValue)) {
        const totalActual = target[measure.label];
        target[measure.label] = (typeof totalActual === "number" ? totalActual : 0) + numericValue;
      }
    }
  }

  const dynamicColumnList = Array.from(dynamicColumns);
  const measureTotalLabels = measures
    .filter(esMedidaAcumulable)
    .map((measure) => measure.label);

  const datosPivot = Array.from(rowsByKey.values()).map((row) => {
    const ordered: Record<string, unknown> = {};

    for (const dimension of rowDimensions) {
      ordered[dimension.label] = row[dimension.label] ?? "Sin dato";
    }

    for (const column of dynamicColumnList) {
      ordered[column] = row[column] ?? 0;
    }

    for (const measureLabel of measureTotalLabels) {
      if (Object.prototype.hasOwnProperty.call(row, measureLabel)) {
        ordered[measureLabel] = row[measureLabel];
      }
    }

    return ordered;
  });
  const totalPivot: Record<string, unknown> = {};

  for (const column of dynamicColumnList) {
    const total = datosPivot.reduce((acc, row) => {
      const value = row[column];
      return acc + (typeof value === "number" ? value : Number(value) || 0);
    }, 0);
    totalPivot[column] = total;
  }

  for (const measure of measures) {
    if (totalGeneral && Object.prototype.hasOwnProperty.call(totalGeneral, measure.label)) {
      totalPivot[measure.label] = totalGeneral[measure.label];
    }
  }

  return {
    datos: datosPivot,
    totalGeneral: Object.keys(totalPivot).length ? totalPivot : totalGeneral,
  };
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

const obtenerColumnaFiltroDimension = (dimension: DimensionDef) =>
  dimension.filterColumn ?? dimension.column;

const obtenerGroupByDimension = (dimension: DimensionDef) =>
  dimension.groupBy ?? dimension.column;

const obtenerOrderByDimension = (dimension: DimensionDef) =>
  dimension.orderBy ?? obtenerGroupByDimension(dimension);

const tieneFiltroDimension = (payload: EgresosPivotPayload, dimensionId: string) =>
  (payload.filters ?? []).some((filter) =>
    filter.field === dimensionId &&
    (filter.values ?? []).some((value) => value !== undefined && value !== null && value !== "")
  );

const obtenerValoresFiltroDimension = (payload: EgresosPivotPayload, dimensionId: string) =>
  (payload.filters ?? [])
    .filter((filter) => filter.field === dimensionId)
    .flatMap((filter) => filter.values ?? [])
    .filter((value) => value !== undefined && value !== null && value !== "");

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

const construirCondicionCodigoCie = (
  expresionCodigo: string,
  expresionNormalizada: string,
  values: Array<string | number>
) => {
  const condiciones: string[] = [];
  const params: Array<string | number> = [];

  for (const value of values) {
    const codigoNormalizado = normalizarCodigoDiagnostico(value);

    if (esCodigoCategoriaCie(codigoNormalizado)) {
      condiciones.push(`${expresionNormalizada} LIKE ?`);
      params.push(`${codigoNormalizado}%`);
      continue;
    }

    condiciones.push(`(${expresionCodigo} = ? OR ${expresionNormalizada} = ?)`);
    params.push(value, codigoNormalizado);
  }

  return { condicion: condiciones.join(" OR "), params };
};

const construirFiltroDiagnosticoIngreso = (values: Array<string | number>) => {
  const ingreso1 = construirCondicionCodigoCie(
    DIAGNOSTICO_INGRESO_1_SQL,
    DIAGNOSTICO_INGRESO_1_NORMALIZADO_SQL,
    values
  );
  const ingreso2 = construirCondicionCodigoCie(
    DIAGNOSTICO_INGRESO_2_SQL,
    DIAGNOSTICO_INGRESO_2_NORMALIZADO_SQL,
    values
  );

  return {
    clauses: [`((${ingreso1.condicion}) OR (${ingreso2.condicion}))`],
    params: [...ingreso1.params, ...ingreso2.params],
  };
};

const construirFiltroDiagnosticoEgresoPrincipal = (values: Array<string | number>) => {
  const { condicion, params } = construirCondicionCodigoCie(
    "COALESCE(NULLIF(TRIM(d.C_CIE), ''), 'Sin diagnóstico')",
    DIAGNOSTICO_DETALLE_NORMALIZADO_SQL,
    values
  );

  return {
    clauses: [`
      EXISTS (
        SELECT 1
        FROM EHO_BDT_EGR_DIAGNOSTICOS d
        WHERE d.C_US = g.C_US
          AND d.N_ANIO = g.N_ANIO
          AND d.N_MES = g.N_MES
          AND d.N_PAGINA = g.N_PAGINA
          AND d.C_CORRELATIVO = 1
          AND (${condicion})
      )
    `],
    params,
  };
};

const construirFiltroDiagnosticoEgreso = (
  dimensionId: string,
  values: Array<string | number>,
  ordenesAfeccion: number[] = []
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

  const condicionesDiagnostico: string[] = [];

  for (const value of values) {
    const codigoNormalizado = normalizarCodigoDiagnostico(value);

    if (esCodigoCategoriaCie(codigoNormalizado)) {
      condicionesDiagnostico.push(`${DIAGNOSTICO_DETALLE_NORMALIZADO_SQL} LIKE ?`);
      params.push(`${codigoNormalizado}%`);
      continue;
    }

    condicionesDiagnostico.push(`
      (
        ${selectedColumn} = ?
        OR ${DIAGNOSTICO_DETALLE_NORMALIZADO_SQL} = ?
      )
    `);
    params.push(value, codigoNormalizado);
  }

	clauses.push(`
    EXISTS (
      SELECT 1
      FROM EHO_BDT_EGR_DIAGNOSTICOS d
      WHERE d.C_US = g.C_US
        AND d.N_ANIO = g.N_ANIO
        AND d.N_MES = g.N_MES
        AND d.N_PAGINA = g.N_PAGINA
        AND (${condicionesDiagnostico.join(" OR ")})
        ${ordenesAfeccion.length ? `AND d.C_CORRELATIVO IN (${ordenesAfeccion.map(() => "?").join(",")})` : ""}
    )
  `);
  params.push(...ordenesAfeccion);

  return { clauses, params };
};

const construirCondicionFiltroCieCatalogo = (
  dimensionId: string,
  values: Array<string | number>,
  aliasCie: string,
  aliasDiagnostico: string
) => {
  const columnas: Record<string, string> = {
    CIE_CATEGORIA: `COALESCE(NULLIF(TRIM(${aliasCie}.C_CIE_CATEGORIA), ''), 'Sin categoría')`,
    CIE_CAPITULO: `${aliasCie}.C_CIE_CAPITULO`,
    CIE_GRUPO: `${aliasCie}.C_CIE_GRUPO`,
  };

  const columna = columnas[dimensionId];
  if (!columna) {
    return { condition: "", params: [] as Array<string | number> };
  }

  const condiciones: string[] = [];
  const params: Array<string | number> = [];

  for (const value of values) {
    if (dimensionId === "CIE_CATEGORIA") {
      const categoria = normalizarCodigoDiagnostico(value).slice(0, 3);
      if (esCodigoCategoriaCie(categoria)) {
        condiciones.push(
          `(${columna} = ? OR ${normalizarCodigoCieSql(`${aliasDiagnostico}.C_CIE`)} LIKE ?)`
        );
        params.push(String(value).trim(), `${categoria}%`);
        continue;
      }
    }

    if (dimensionId === "CIE_GRUPO") {
      const match = String(value).trim().match(/^(\d+):(\d+)$/);
      if (match) {
        condiciones.push(`(${aliasCie}.C_CIE_CAPITULO = ? AND ${aliasCie}.C_CIE_GRUPO = ?)`);
        params.push(Number(match[1]), Number(match[2]));
        continue;
      }
    }

    condiciones.push(`${columna} = ?`);
    params.push(value);
  }

  return {
    condition: condiciones.length ? `(${condiciones.join(" OR ")})` : "",
    params,
  };
};

const construirFiltrosCieCatalogoCombinados = (
  payload: EgresosPivotPayload,
  enLinea: boolean
) => {
  const aliasCie = enLinea ? "cie_dx_raw" : "cie_f";
  const aliasDiagnostico = enLinea ? "dx_raw" : "d_f";
  const condiciones: string[] = [];
  const params: Array<string | number> = [];

  for (const dimensionId of ["CIE_CATEGORIA", "CIE_CAPITULO", "CIE_GRUPO"]) {
    const values = obtenerValoresFiltroDimension(payload, dimensionId);
    if (!values.length) continue;

    const filtro = construirCondicionFiltroCieCatalogo(
      dimensionId,
      values,
      aliasCie,
      aliasDiagnostico
    );
    if (!filtro.condition) continue;
    condiciones.push(filtro.condition);
    params.push(...filtro.params);
  }

  if (!condiciones.length) {
    return { clauses: [] as string[], params };
  }

  if (enLinea) return { clauses: condiciones, params };

  return {
    clauses: [`
      EXISTS (
        SELECT 1 FROM EHO_BDT_EGR_DIAGNOSTICOS d_f
        INNER JOIN EHO_BDR_CIE cie_f ON cie_f.C_CIE = d_f.C_CIE
        WHERE d_f.C_US = g.C_US AND d_f.N_ANIO = g.N_ANIO
          AND d_f.N_MES = g.N_MES AND d_f.N_PAGINA = g.N_PAGINA
          AND ${condiciones.join(" AND ")}
      )
    `],
    params,
  };
};

const construirFiltroDiagnosticoEgresoEnLinea = (
  values: Array<string | number>,
  ordenesAfeccion: number[] = []
) => {
  const { condicion, params } = construirCondicionCodigoCie(
    "COALESCE(NULLIF(TRIM(dx_raw.C_CIE), ''), 'Sin diagnóstico')",
    DIAGNOSTICO_DETALLE_NORMALIZADO_DX_SQL,
    values
  );

  const clauses = [`(${condicion})`];
  if (ordenesAfeccion.length) {
    clauses.push(`dx_raw.C_CORRELATIVO IN (${ordenesAfeccion.map(() => "?").join(",")})`);
    params.push(...ordenesAfeccion);
  }

  return { clauses, params };
};

const construirFiltroOperacionEgreso = (
  values: Array<string | number>,
  ordenesOperacion: number[] = []
) => {
  const codigos = values
    .map((value) => String(value).trim())
    .filter(Boolean)
    .map((value) => value.toUpperCase());

  if (!codigos.length) {
    return { clauses: [], params: [] as Array<string | number> };
  }

  const params: Array<string | number> = [...codigos];
  const filtroOrden = ordenesOperacion.length
    ? `AND op.C_CORRELATIVO IN (${ordenesOperacion.map(() => "?").join(",")})`
    : "";

  params.push(...ordenesOperacion);

  return {
    clauses: [`
      EXISTS (
        SELECT 1
        FROM EHO_BDT_EGR_OPERACIONES op
        WHERE op.C_US = g.C_US
          AND op.N_ANIO = g.N_ANIO
          AND op.N_MES = g.N_MES
          AND op.N_PAGINA = g.N_PAGINA
          AND UPPER(TRIM(op.C_OPERACION)) IN (${codigos.map(() => "?").join(",")})
          ${filtroOrden}
      )
    `],
    params,
  };
};

const construirWhere = (
  payload: EgresosPivotPayload,
  anios: number[],
  regionIds?: number[] | null,
  desglosarPorLinea = usaDesglosePorDiagnosticoLinea(payload)
) => {
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

  const combinarOrdenConDiagnostico = tieneFiltroDimension(payload, "DIAGNOSTICOS_EGRESO");
  const ordenesAfeccion = normalizarEnteros(obtenerValoresFiltroDimension(payload, "CODIGO_ORDEN_AFECCION"));
  const combinarOrdenConOperacion = tieneFiltroDimension(payload, "OPERACIONES_EGRESO");
  const ordenesOperacion = normalizarEnteros(obtenerValoresFiltroDimension(payload, "CODIGO_ORDEN_OPERACION"));

  const filtrosCie = construirFiltrosCieCatalogoCombinados(payload, desglosarPorLinea);
  whereParts.push(...filtrosCie.clauses);
  whereParams.push(...filtrosCie.params);

  for (const filter of payload.filters ?? []) {
    const dimension = obtenerDimension(filter.field);
    if (!dimension || !dimension.filterable && dimension.filterable !== undefined) continue;
    if (!filter.values || filter.values.length === 0) continue;
    const values = filter.values.filter((value) => value !== undefined && value !== null && value !== "");
    if (values.length === 0) continue;

    if (combinarOrdenConDiagnostico && dimension.id === "CODIGO_ORDEN_AFECCION") {
      continue;
    }

    if (combinarOrdenConOperacion && dimension.id === "CODIGO_ORDEN_OPERACION") {
      continue;
    }

    if (dimension.id === "DIAGNOSTICO_INGRESO") {
      const { clauses, params } = construirFiltroDiagnosticoIngreso(values);
      whereParts.push(...clauses);
      whereParams.push(...params);
      continue;
    }

    if (dimension.id === "DIAGNOSTICO_EGRESO_PRINCIPAL") {
      const { clauses, params } = construirFiltroDiagnosticoEgresoPrincipal(values);
      whereParts.push(...clauses);
      whereParams.push(...params);
      continue;
    }

    if (dimension.id === "OPERACIONES_EGRESO") {
      const { clauses, params } = construirFiltroOperacionEgreso(values, ordenesOperacion);
      whereParts.push(...clauses);
      whereParams.push(...params);
      continue;
    }

    if (["CIE_CATEGORIA", "CIE_CAPITULO", "CIE_GRUPO"].includes(dimension.id)) {
      continue;
    }

    if (dimension.matchAllValues) {
      if (dimension.id === "DIAGNOSTICOS_EGRESO" && desglosarPorLinea) {
        const { clauses, params } = construirFiltroDiagnosticoEgresoEnLinea(values, ordenesAfeccion);
        whereParts.push(...clauses);
        whereParams.push(...params);
        continue;
      }

      const { clauses, params } = construirFiltroDiagnosticoEgreso(
        dimension.id,
        values,
        dimension.id === "DIAGNOSTICOS_EGRESO" ? ordenesAfeccion : []
      );
      if (clauses.length) {
        whereParts.push(...clauses);
        whereParams.push(...params);
        continue;
      }
    }

    const placeholders = values.map(() => "?").join(",");
    whereParts.push(`${obtenerColumnaFiltroDimension(dimension)} IN (${placeholders})`);
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

export const obtenerAniosEgresos = async (): Promise<number[]> => cache.getOrSet(
  "egresos-pivot:anios",
  async () => {
  const pool = tomarPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT g.N_ANIO AS anio
     FROM EHO_BDT_EGR_GENERAL g
     ORDER BY g.N_ANIO DESC`
  );

  return rows
    .map((row) => Number(row.anio))
    .filter((anio) => Number.isInteger(anio));
  },
  CACHE_TTL.ANIOS_DISPONIBLES
);

export const obtenerCatalogoEgresos = async () => {
  return cache.getOrSet(
    "egresos-pivot:catalogo",
    async () => {
  const aniosDisponibles = await obtenerAniosEgresos();

  return {
    dimensiones: DIMENSIONES
      .filter((dimension) => !dimension.hiddenFromCatalog)
      .map((dimension) => ({
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
    },
    CACHE_TTL.CATALOGO_PIVOT
  );
};

const DIMENSIONES_EGRESOS_SIN_CACHE = new Set([
  "N_HISTORIA_CLINICA",
  "PAGINA",
  "FECHA_EGRESO",
]);

export interface FiltrosCieValoresDimension {
  capitulos?: number[];
  grupos?: string[];
  categorias?: string[];
}

const construirClaveValoresDimensionEgresos = (
  dimensionId: string,
  busqueda?: string,
  limite?: number,
  regionIds?: number[] | null,
  filtrosCie?: FiltrosCieValoresDimension
) => {
  const busquedaKey = busqueda?.trim() ? busqueda.trim().toLocaleLowerCase("es-HN") : "";
  const regionKey = regionIds?.length ? [...regionIds].sort((a, b) => a - b).join(",") : "all";
  const capitulosKey = [...(filtrosCie?.capitulos ?? [])].sort((a, b) => a - b).join(",") || "all";
  const gruposKey = [...(filtrosCie?.grupos ?? [])].sort().join(",") || "all";
  const categoriasKey = [...(filtrosCie?.categorias ?? [])].sort().join(",") || "all";
  return `egresos-pivot:dimension:${dimensionId}:q:${busquedaKey}:l:${limite ?? "default"}:r:${regionKey}:cap:${capitulosKey}:grp:${gruposKey}:cat:${categoriasKey}`;
};

const obtenerValoresDimensionEgresosSinCache = async (
  dimensionId: string,
  busqueda?: string,
  limite?: number,
  regionIds?: number[] | null,
  filtrosCie: FiltrosCieValoresDimension = {}
): Promise<Array<{ valor: number | string; etiqueta: string }>> => {
  const dimension = obtenerDimension(dimensionId);
  if (!dimension) return [];

  const pool = tomarPool();
  const limitesPorDimension: Record<string, number> = {
    DIAGNOSTICO: 15000,
    DIAGNOSTICOS_EGRESO: 15000,
    CIE_CATEGORIA: 1500,
    CIE_CAPITULO: 30,
    CIE_GRUPO: 300,
    OPERACION_PRINCIPAL: 15000,
    OPERACIONES_EGRESO: 15000,
    ESTABLECIMIENTO: 5000,
    MUN_PACIENTE: 1000,
    PAGINA: 30000,
    N_HISTORIA_CLINICA: 350000,
    FECHA_EGRESO: 10000,
  };
  const limiteMaximo = limitesPorDimension[dimensionId] ?? 5000;
  const limiteFinal = Math.min(Math.max(limite ?? limiteMaximo, 1), limiteMaximo);

  const consultarValoresSimples = async (
    sqlBase: string,
    paramsBase: Array<string | number> = []
  ) => {
    const [rows] = await pool.query<RowDataPacket[]>(sqlBase, [...paramsBase, limiteFinal]);
    return rows
      .filter((row) => row.valor !== null && row.valor !== undefined)
      .map((row) => ({
        valor: row.valor as string | number,
        etiqueta: String(formatearDimension(dimension, row.etiqueta ?? row.valor)),
      }));
  };

  const construirCondicionCascadaCie = (codigoSql: string) => {
    const condiciones: string[] = [];
    const params: Array<string | number> = [];

    if (filtrosCie.capitulos?.length) {
      condiciones.push(`cie_filtro.C_CIE_CAPITULO IN (${filtrosCie.capitulos.map(() => "?").join(",")})`);
      params.push(...filtrosCie.capitulos);
    }

    const grupos = (filtrosCie.grupos ?? []).flatMap((valor) => {
      const match = valor.match(/^(\d+):(\d+)$/);
      return match ? [{ capitulo: Number(match[1]), grupo: Number(match[2]) }] : [];
    });
    if (grupos.length) {
      condiciones.push(`(${grupos.map(() => `(cie_filtro.C_CIE_CAPITULO = ? AND cie_filtro.C_CIE_GRUPO = ?)`).join(" OR ")})`);
      grupos.forEach(({ capitulo, grupo }) => params.push(capitulo, grupo));
    }

    if (filtrosCie.categorias?.length) {
      condiciones.push(`cie_filtro.C_CIE_CATEGORIA IN (${filtrosCie.categorias.map(() => "?").join(",")})`);
      params.push(...filtrosCie.categorias);
    }

    if (!condiciones.length) {
      return { condition: "", params };
    }

    const categoriaCodigo = `SUBSTRING(REPLACE(REPLACE(UPPER(TRIM(${codigoSql})), '.', ''), '*', ''), 1, 3)`;
    return {
      condition: `EXISTS (
        SELECT 1
        FROM EHO_BDR_CIE cie_filtro
        WHERE cie_filtro.C_CIE_CATEGORIA = ${categoriaCodigo}
          AND ${condiciones.join(" AND ")}
      )`,
      params
    };
  };

  const consultarValoresCie = async (codigosSql: string, textoBusqueda?: string) => {
    let sql = `
      SELECT valor, etiqueta
      FROM (
        SELECT
          categorias.categoria AS valor,
          CONCAT(categorias.categoria, ' Todos los subcodigos') AS etiqueta,
          categorias.categoria AS orden,
          0 AS tipo_orden
        FROM (
          SELECT DISTINCT SUBSTRING(REPLACE(REPLACE(UPPER(TRIM(codigos_categoria.codigo)), '.', ''), '*', ''), 1, 3) AS categoria
          FROM (${codigosSql}) codigos_categoria
        ) categorias
        WHERE categorias.categoria REGEXP '^[A-Z][0-9][0-9]$'

        UNION ALL

        SELECT
          codigos.codigo AS valor,
          CASE
            WHEN NULLIF(TRIM(cie.D_CIE), '') IS NULL THEN codigos.codigo
            ELSE CONCAT(codigos.codigo, ' ', TRIM(cie.D_CIE))
          END AS etiqueta,
          REPLACE(REPLACE(UPPER(codigos.codigo), '.', ''), '*', '') AS orden,
          1 AS tipo_orden
        FROM (${codigosSql}) codigos
        LEFT JOIN EHO_BDR_CIE cie
          ON cie.C_CIE = codigos.codigo
      ) opciones
    `;
    const params: Array<string | number> = [];
    const condiciones: string[] = [];

    if (textoBusqueda) {
      condiciones.push(`(valor LIKE ? OR etiqueta LIKE ?)`);
      params.push(`${textoBusqueda}%`, `%${textoBusqueda}%`);
    }

    const cascada = construirCondicionCascadaCie("opciones.valor");
    if (cascada.condition) {
      condiciones.push(cascada.condition);
      params.push(...cascada.params);
    }

    if (condiciones.length) {
      sql += ` WHERE ${condiciones.join(" AND ")}`;
    }

    sql += ` ORDER BY orden, tipo_orden, valor LIMIT ?`;
    params.push(limiteFinal);

    const [rows] = await pool.query<RowDataPacket[]>(sql, params);
    return rows
      .filter((row) => row.valor !== null && row.valor !== undefined)
      .map((row) => ({
        valor: String(row.valor),
        etiqueta: String(row.etiqueta ?? row.valor),
      }));
  };

  if (dimensionId === "REGION") {
    const textoBusqueda = busqueda?.trim();
    const where = textoBusqueda ? "WHERE D_REGION LIKE ?" : "";
    const params = textoBusqueda ? [`%${textoBusqueda}%`] : [];
    return consultarValoresSimples(
      `SELECT D_REGION AS valor, D_REGION AS etiqueta
       FROM BAS_BDR_REGIONES
       ${where}
       ORDER BY C_REGION
       LIMIT ?`,
      params
    );
  }

  if (dimensionId === "DEPARTAMENTO" || dimensionId === "DEPTO_PACIENTE") {
    if (dimensionId === "DEPTO_PACIENTE") {
      const textoBusqueda = busqueda?.trim();
      const params: Array<string | number> = [];
      let sql = `
        SELECT valor, valor AS etiqueta
        FROM (
          SELECT DISTINCT
            COALESCE(deptos_paciente.D_DEPARTAMENTO, CONCAT('Departamento ', g.C_PAC_DEPARTAMENTO)) AS valor,
            MIN(g.C_PAC_DEPARTAMENTO) AS orden
          FROM EHO_BDT_EGR_GENERAL g
          LEFT JOIN BAS_BDR_DEPARTAMENTOS deptos_paciente
            ON deptos_paciente.C_DEPARTAMENTO = g.C_PAC_DEPARTAMENTO
          WHERE g.C_PAC_DEPARTAMENTO IS NOT NULL
          GROUP BY COALESCE(deptos_paciente.D_DEPARTAMENTO, CONCAT('Departamento ', g.C_PAC_DEPARTAMENTO))
        ) deptos
      `;

      if (textoBusqueda) {
        sql += ` WHERE valor LIKE ?`;
        params.push(`%${textoBusqueda}%`);
      }

      sql += ` ORDER BY orden, valor LIMIT ?`;
      params.push(limiteFinal);

      const [rows] = await pool.query<RowDataPacket[]>(sql, params);
      return rows
        .filter((row) => row.valor !== null && row.valor !== undefined)
        .map((row) => ({
          valor: String(row.valor),
          etiqueta: String(row.etiqueta),
        }));
    }

    const textoBusqueda = busqueda?.trim();
    const where = textoBusqueda ? "WHERE D_DEPARTAMENTO LIKE ?" : "";
    const params = textoBusqueda ? [`%${textoBusqueda}%`] : [];
    return consultarValoresSimples(
      `SELECT D_DEPARTAMENTO AS valor, D_DEPARTAMENTO AS etiqueta
       FROM BAS_BDR_DEPARTAMENTOS
       ${where}
       ORDER BY C_DEPARTAMENTO
       LIMIT ?`,
      params
    );
  }

  if (dimensionId === "MUN_PACIENTE") {
    const textoBusqueda = busqueda?.trim();
    const params: Array<string | number> = [];
    let sql = `
      SELECT valor, valor AS etiqueta
      FROM (
        SELECT DISTINCT
          COALESCE(municipios_paciente.D_MUNICIPIO, CONCAT(g.C_PAC_DEPARTAMENTO, '-', g.C_PAC_MUNICIPIO)) AS valor
        FROM EHO_BDT_EGR_GENERAL g
        LEFT JOIN BAS_BDR_MUNICIPIOS municipios_paciente
          ON municipios_paciente.C_DEPARTAMENTO = g.C_PAC_DEPARTAMENTO
         AND municipios_paciente.C_MUNICIPIO = g.C_PAC_MUNICIPIO
        WHERE g.C_PAC_DEPARTAMENTO IS NOT NULL
          AND g.C_PAC_MUNICIPIO IS NOT NULL
      ) municipios
    `;

    if (textoBusqueda) {
      sql += ` WHERE valor LIKE ?`;
      params.push(`%${textoBusqueda}%`);
    }

    sql += ` ORDER BY valor LIMIT ?`;
    params.push(limiteFinal);

    const [rows] = await pool.query<RowDataPacket[]>(sql, params);
    return rows
      .filter((row) => row.valor !== null && row.valor !== undefined)
      .map((row) => ({
        valor: String(row.valor),
        etiqueta: String(row.etiqueta),
      }));
  }

  if (dimensionId === "ESTABLECIMIENTO") {
    const textoBusqueda = busqueda?.trim();
    const params: Array<string | number> = [];
    let sql = `
      SELECT
        g.C_US AS valor,
        CONCAT(g.C_US, ' - ', COALESCE(NULLIF(TRIM(us.D_US), ''), 'Sin nombre')) AS etiqueta
      FROM EHO_BDT_EGR_GENERAL g
      LEFT JOIN BAS_BDR_US us
        ON us.C_US = g.C_US
      WHERE g.C_US IS NOT NULL
    `;

    if (regionIds?.length) {
      sql += ` AND us.C_REGION IN (${regionIds.map(() => "?").join(",")})`;
      params.push(...regionIds);
    }

    if (textoBusqueda) {
      sql += ` AND (CAST(g.C_US AS CHAR) LIKE ? OR us.D_US LIKE ?)`;
      params.push(`%${textoBusqueda}%`, `%${textoBusqueda}%`);
    }

    sql += ` GROUP BY g.C_US, us.D_US ORDER BY us.D_US, g.C_US LIMIT ?`;
    params.push(limiteFinal);

    const [rows] = await pool.query<RowDataPacket[]>(sql, params);
    return rows
      .filter((row) => row.valor !== null && row.valor !== undefined)
      .map((row) => ({
        valor: row.valor as string | number,
        etiqueta: String(row.etiqueta),
      }));
  }

  if (dimensionId === "CATEGORIA_ESTABLECIMIENTO") {
    let sql = `
      SELECT
        COALESCE(NULLIF(TRIM(REPLACE(REPLACE(descripcion, CHAR(13), ''), CHAR(10), '')), ''), 'Sin categoría') AS valor,
        COALESCE(NULLIF(TRIM(REPLACE(REPLACE(descripcion, CHAR(13), ''), CHAR(10), '')), ''), 'Sin categoría') AS etiqueta
      FROM cat_nivel_establecimiento
    `;
    const params: Array<string | number> = [];
    const textoBusqueda = busqueda?.trim();

    if (textoBusqueda) {
      sql += ` WHERE descripcion LIKE ?`;
      params.push(`%${textoBusqueda}%`);
    }

    sql += ` ORDER BY CAST(codigo AS SIGNED), etiqueta LIMIT ?`;
    params.push(limiteFinal);

    const [rows] = await pool.query<RowDataPacket[]>(sql, params);
    return rows
      .filter((row) => row.valor !== null && row.valor !== undefined)
      .map((row) => ({
        valor: String(row.valor),
        etiqueta: String(row.etiqueta),
      }));
  }

  if (dimensionId === "DIAGNOSTICO_INGRESO") {
    const textoBusqueda = busqueda?.trim();
    return consultarValoresCie(
      `
        SELECT DISTINCT TRIM(C_INGRESO_CIE_1) AS codigo
        FROM EHO_BDT_EGR_GENERAL
        WHERE NULLIF(TRIM(C_INGRESO_CIE_1), '') IS NOT NULL

        UNION

        SELECT DISTINCT TRIM(C_INGRESO_CIE_2) AS codigo
        FROM EHO_BDT_EGR_GENERAL
        WHERE NULLIF(TRIM(C_INGRESO_CIE_2), '') IS NOT NULL
      `,
      textoBusqueda
    );
  }

  if (dimensionId === "DIAGNOSTICO_EGRESO_PRINCIPAL") {
    const textoBusqueda = busqueda?.trim();
    return consultarValoresCie(
      `
        SELECT DISTINCT TRIM(C_CIE) AS codigo
        FROM EHO_BDT_EGR_DIAGNOSTICOS
        WHERE C_CORRELATIVO = 1
          AND NULLIF(TRIM(C_CIE), '') IS NOT NULL
      `,
      textoBusqueda
    );
  }

  if (dimensionId === "DIAGNOSTICO") {
    let sql = `
      SELECT
        CASE
          WHEN NULLIF(TRIM(cie.D_CIE), '') IS NULL THEN codigos.codigo
          ELSE CONCAT(codigos.codigo, ' ', TRIM(cie.D_CIE))
        END AS valor,
        CASE
          WHEN NULLIF(TRIM(cie.D_CIE), '') IS NULL THEN codigos.codigo
          ELSE CONCAT(codigos.codigo, ' ', TRIM(cie.D_CIE))
        END AS etiqueta
      FROM (
        SELECT DISTINCT TRIM(COALESCE(NULLIF(TRIM(causas.C_CIE1), ''), NULLIF(TRIM(g.C_INGRESO_CIE_1), ''))) AS codigo
        FROM EHO_BDT_EGR_GENERAL g
        LEFT JOIN EHO_TABLA_TODAS_CAUSAS causas
          ON causas.C_US = g.C_US
         AND causas.N_ANIO = g.N_ANIO
         AND causas.N_MES = g.N_MES
         AND causas.N_PAGINA = g.N_PAGINA
        WHERE NULLIF(TRIM(COALESCE(NULLIF(TRIM(causas.C_CIE1), ''), NULLIF(TRIM(g.C_INGRESO_CIE_1), ''))), '') IS NOT NULL
      ) codigos
      LEFT JOIN EHO_BDR_CIE cie
        ON cie.C_CIE = codigos.codigo
    `;
    const params: Array<string | number> = [];
    const condiciones: string[] = [];
    const textoBusqueda = busqueda?.trim();

    if (textoBusqueda) {
      condiciones.push(`(codigos.codigo LIKE ? OR cie.D_CIE LIKE ?)`);
      params.push(`${textoBusqueda}%`, `%${textoBusqueda}%`);
    }

    const cascada = construirCondicionCascadaCie("codigos.codigo");
    if (cascada.condition) {
      condiciones.push(cascada.condition);
      params.push(...cascada.params);
    }

    if (condiciones.length) {
      sql += ` WHERE ${condiciones.join(" AND ")}`;
    }

    sql += ` ORDER BY codigos.codigo LIMIT ?`;
    params.push(limiteFinal);

    const [rows] = await pool.query<RowDataPacket[]>(sql, params);
    return rows
      .filter((row) => row.valor !== null && row.valor !== undefined)
      .map((row) => ({
        valor: String(row.valor),
        etiqueta: String(row.etiqueta),
      }));
  }

  if (dimensionId === "DIAGNOSTICOS_EGRESO") {
    let sql = `
      SELECT valor, etiqueta
      FROM (
        SELECT
          categorias.categoria AS valor,
          CONCAT(categorias.categoria, ' Todos los subcodigos') AS etiqueta,
          categorias.categoria AS orden,
          0 AS tipo_orden
        FROM (
          SELECT DISTINCT TRIM(C_CIE_CATEGORIA) AS categoria
          FROM EHO_BDR_CIE
          WHERE NULLIF(TRIM(C_CIE_CATEGORIA), '') IS NOT NULL
        ) categorias
        WHERE REPLACE(REPLACE(UPPER(categorias.categoria), '.', ''), '*', '') REGEXP '^[A-Z][0-9][0-9]$'

        UNION ALL

        SELECT
          codigos.codigo AS valor,
          CASE
            WHEN NULLIF(TRIM(cie.D_CIE), '') IS NULL THEN codigos.codigo
            ELSE CONCAT(codigos.codigo, ' ', TRIM(cie.D_CIE))
          END AS etiqueta,
          REPLACE(REPLACE(UPPER(codigos.codigo), '.', ''), '*', '') AS orden,
          1 AS tipo_orden
        FROM (
          SELECT DISTINCT TRIM(C_CIE) AS codigo
          FROM EHO_BDT_EGR_DIAGNOSTICOS
          WHERE NULLIF(TRIM(C_CIE), '') IS NOT NULL
        ) codigos
        LEFT JOIN EHO_BDR_CIE cie
          ON cie.C_CIE = codigos.codigo
      ) opciones
    `;
    const params: Array<string | number> = [];
    const whereParts: string[] = [];

    const textoBusqueda = busqueda?.trim();
    if (textoBusqueda) {
      whereParts.push(`(valor LIKE ? OR etiqueta LIKE ?)`);
      params.push(`${textoBusqueda}%`, `%${textoBusqueda}%`);
    }

    const cascada = construirCondicionCascadaCie("opciones.valor");
    if (cascada.condition) {
      whereParts.push(cascada.condition);
      params.push(...cascada.params);
    }

    if (whereParts.length) {
      sql += ` WHERE ${whereParts.join(" AND ")}`;
    }

    sql += ` ORDER BY orden, tipo_orden, valor LIMIT ?`;
    params.push(limiteFinal);

    const [rows] = await pool.query<RowDataPacket[]>(sql, params);
    return rows
      .filter((row) => row.valor !== null && row.valor !== undefined)
      .map((row) => {
        const valor = row.valor as string | number;
        const etiqueta = String(row.etiqueta ?? formatearDimension(dimension, valor));
        return { valor, etiqueta };
      });
  }

  if (dimensionId === "CIE_CATEGORIA") {
    const textoBusqueda = busqueda?.trim();
    const params: Array<string | number> = [];
    const condiciones: string[] = [];
    let sql = `
      SELECT
        cat.C_CIE_CATEGORIA AS valor,
        CONCAT(cat.C_CIE_CATEGORIA, ' ', TRIM(cat.D_CIE_CATEGORIA)) AS etiqueta
      FROM EHO_BDR_CIE_CATEGORIAS cat
    `;

    if (textoBusqueda) {
      condiciones.push(`(cat.C_CIE_CATEGORIA LIKE ? OR cat.D_CIE_CATEGORIA LIKE ?)`);
      params.push(`${textoBusqueda.toUpperCase()}%`, `%${textoBusqueda}%`);
    }

    if (filtrosCie.capitulos?.length) {
      condiciones.push(`cat.C_CIE_CAPITULO IN (${filtrosCie.capitulos.map(() => "?").join(",")})`);
      params.push(...filtrosCie.capitulos);
    }

    const grupos = (filtrosCie.grupos ?? []).flatMap((valor) => {
      const match = valor.match(/^(\d+):(\d+)$/);
      return match ? [{ capitulo: Number(match[1]), grupo: Number(match[2]) }] : [];
    });
    if (grupos.length) {
      condiciones.push(`(${grupos.map(() => `(cat.C_CIE_CAPITULO = ? AND cat.C_CIE_GRUPO = ?)`).join(" OR ")})`);
      grupos.forEach(({ capitulo, grupo }) => params.push(capitulo, grupo));
    }

    if (condiciones.length) {
      sql += ` WHERE ${condiciones.join(" AND ")}`;
    }

    sql += ` ORDER BY cat.C_CIE_CATEGORIA LIMIT ?`;
    params.push(limiteFinal);

    const [rows] = await pool.query<RowDataPacket[]>(sql, params);
    return rows.map((row) => ({
      valor: String(row.valor),
      etiqueta: String(row.etiqueta ?? row.valor),
    }));
  }

  if (dimensionId === "CIE_CAPITULO") {
    const textoBusqueda = busqueda?.trim();
    const params: Array<string | number> = [];
    let sql = `
      SELECT
        cap.C_CIE_CAPITULO AS valor,
        CONCAT(cap.C_CIE_CAPITULO, ' ', TRIM(cap.D_CIE_CAPITULO)) AS etiqueta
      FROM EHO_BDR_CIE_CAPITULOS cap
    `;

    if (textoBusqueda) {
      sql += ` WHERE CAST(cap.C_CIE_CAPITULO AS CHAR) LIKE ? OR cap.D_CIE_CAPITULO LIKE ?`;
      params.push(`${textoBusqueda}%`, `%${textoBusqueda}%`);
    }

    sql += ` ORDER BY cap.C_CIE_CAPITULO LIMIT ?`;
    params.push(limiteFinal);

    const [rows] = await pool.query<RowDataPacket[]>(sql, params);
    return rows.map((row) => ({
      valor: Number(row.valor),
      etiqueta: String(row.etiqueta),
    }));
  }

  if (dimensionId === "CIE_GRUPO") {
    const textoBusqueda = busqueda?.trim();
    const params: Array<string | number> = [];
    const condiciones: string[] = [];
    let sql = `
      SELECT
        CONCAT(grp.C_CIE_CAPITULO, ':', grp.C_CIE_GRUPO) AS valor,
        CONCAT('Capítulo ', grp.C_CIE_CAPITULO, ' — ', grp.C_CIE_GRUPO, ' ', TRIM(grp.D_CIE_GRUPO)) AS etiqueta
      FROM EHO_BDR_CIE_GRUPOS grp
    `;

    if (textoBusqueda) {
      condiciones.push(`(CAST(grp.C_CIE_GRUPO AS CHAR) LIKE ? OR grp.D_CIE_GRUPO LIKE ?)`);
      params.push(`${textoBusqueda}%`, `%${textoBusqueda}%`);
    }

    if (filtrosCie.capitulos?.length) {
      condiciones.push(`grp.C_CIE_CAPITULO IN (${filtrosCie.capitulos.map(() => "?").join(",")})`);
      params.push(...filtrosCie.capitulos);
    }

    if (condiciones.length) {
      sql += ` WHERE ${condiciones.join(" AND ")}`;
    }

    sql += ` ORDER BY grp.C_CIE_CAPITULO, grp.C_CIE_GRUPO LIMIT ?`;
    params.push(limiteFinal);

    const [rows] = await pool.query<RowDataPacket[]>(sql, params);
    return rows.map((row) => ({
      valor: String(row.valor),
      etiqueta: String(row.etiqueta),
    }));
  }

  if (dimensionId === "CODIGO_ORDEN_AFECCION") {
    const textoBusqueda = busqueda?.trim();
    const params: Array<string | number> = [];
    let sql = `
      SELECT C_CORRELATIVO AS valor, CAST(C_CORRELATIVO AS CHAR) AS etiqueta
      FROM EHO_BDT_EGR_DIAGNOSTICOS
      WHERE C_CORRELATIVO IS NOT NULL
    `;

    if (textoBusqueda) {
      sql += ` AND CAST(C_CORRELATIVO AS CHAR) LIKE ?`;
      params.push(`${textoBusqueda}%`);
    }

    sql += ` GROUP BY C_CORRELATIVO ORDER BY C_CORRELATIVO LIMIT ?`;
    params.push(limiteFinal);

    const [rows] = await pool.query<RowDataPacket[]>(sql, params);
    return rows
      .filter((row) => row.valor !== null && row.valor !== undefined)
      .map((row) => ({
        valor: Number(row.valor),
        etiqueta: String(row.etiqueta),
      }));
  }

  if (dimensionId === "OPERACION_PRINCIPAL" || dimensionId === "OPERACIONES_EGRESO") {
    const textoBusqueda = busqueda?.trim();
    const params: Array<string | number> = [];
    let sql = `
      SELECT
        codigo AS valor,
        codigo AS etiqueta
      FROM (
        SELECT DISTINCT NULLIF(TRIM(C_OPERACION), '') AS codigo
        FROM EHO_BDT_EGR_OPERACIONES
        WHERE NULLIF(TRIM(C_OPERACION), '') IS NOT NULL
          ${dimensionId === "OPERACION_PRINCIPAL" ? "AND C_CORRELATIVO = 1" : ""}
      ) operaciones
    `;

    if (textoBusqueda) {
      sql += ` WHERE codigo LIKE ?`;
      params.push(`${textoBusqueda}%`);
    }

    sql += ` ORDER BY codigo LIMIT ?`;
    params.push(limiteFinal);

    const [rows] = await pool.query<RowDataPacket[]>(sql, params);
    return rows
      .filter((row) => row.valor !== null && row.valor !== undefined)
      .map((row) => ({
        valor: String(row.valor),
        etiqueta: String(row.etiqueta),
      }));
  }

  if (dimensionId === "CODIGO_ORDEN_OPERACION") {
    const textoBusqueda = busqueda?.trim();
    const params: Array<string | number> = [];
    let sql = `
      SELECT C_CORRELATIVO AS valor, CAST(C_CORRELATIVO AS CHAR) AS etiqueta
      FROM EHO_BDT_EGR_OPERACIONES
      WHERE C_CORRELATIVO IS NOT NULL
    `;

    if (textoBusqueda) {
      sql += ` AND CAST(C_CORRELATIVO AS CHAR) LIKE ?`;
      params.push(`${textoBusqueda}%`);
    }

    sql += ` GROUP BY C_CORRELATIVO ORDER BY C_CORRELATIVO LIMIT ?`;
    params.push(limiteFinal);

    const [rows] = await pool.query<RowDataPacket[]>(sql, params);
    return rows
      .filter((row) => row.valor !== null && row.valor !== undefined)
      .map((row) => ({
        valor: Number(row.valor),
        etiqueta: String(row.etiqueta),
      }));
  }

  if (dimensionId === "FECHA_EGRESO") {
    const textoBusqueda = busqueda?.trim();
    const params: Array<string | number> = [];
    let sql = `
      SELECT
        DATE_FORMAT(DATE(g.F_EGRESO), '%Y-%m-%d') AS valor,
        DATE_FORMAT(DATE(g.F_EGRESO), '%Y-%m-%d') AS etiqueta
      FROM EHO_BDT_EGR_GENERAL g
      WHERE g.F_EGRESO IS NOT NULL
    `;

    if (regionIds?.length) {
      sql += `
        AND EXISTS (
          SELECT 1
          FROM BAS_BDR_US us_fecha
          WHERE us_fecha.C_US = g.C_US
            AND us_fecha.C_REGION IN (${regionIds.map(() => "?").join(",")})
        )
      `;
      params.push(...regionIds);
    }

    if (textoBusqueda) {
      sql += ` AND DATE_FORMAT(DATE(g.F_EGRESO), '%Y-%m-%d') LIKE ?`;
      params.push(`%${textoBusqueda}%`);
    }

    sql += ` GROUP BY valor ORDER BY valor LIMIT ?`;
    params.push(limiteFinal);

    const [rows] = await pool.query<RowDataPacket[]>(sql, params);
    return rows
      .filter((row) => row.valor !== null && row.valor !== undefined)
      .map((row) => ({
        valor: String(row.valor),
        etiqueta: String(row.etiqueta),
      }));
  }

  if (dimensionId === "SEXO" || dimensionId === "TIPO_EDAD") {
    const textoBusqueda = busqueda?.trim().toLowerCase();
    const valores = dimensionId === "SEXO"
      ? Object.entries(SEXO_LABELS).map(([codigo, etiqueta]) => ({ valor: Number(codigo), etiqueta }))
      : Object.entries(TIPO_EDAD_LABELS).map(([codigo, etiqueta]) => ({ valor: Number(codigo), etiqueta }));

    return valores
      .filter((item) =>
        !textoBusqueda ||
        String(item.valor).includes(textoBusqueda) ||
        item.etiqueta.toLowerCase().includes(textoBusqueda)
      )
      .slice(0, limiteFinal);
  }

  const grupoEdadColumnas: Record<string, string> = {
    GRUPO_EDAD: "GRUPO_EDAD_Quinquenal",
    GE_QUINQUENAL: "GRUPO_EDAD_Quinquenal",
    GRUPO_EDAD_PMA: "GRUPO_EDAD_PMA",
    GE_VIH: "GRUPO_EDAD_SIDA_COMISCA",
  };

  if (grupoEdadColumnas[dimensionId]) {
    const columna = grupoEdadColumnas[dimensionId];
    const textoBusqueda = busqueda?.trim();
    const params: Array<string | number> = [];
    let sql = `
      SELECT grupo AS valor, grupo AS etiqueta
      FROM (
        SELECT
          NULLIF(TRIM(${columna}), '') AS grupo,
          MIN((CAST(C_EDAD AS SIGNED) * 1000) + CAST(N_EDAD AS SIGNED)) AS orden
        FROM EHO_CAT_GRUPOS_EDAD
        GROUP BY NULLIF(TRIM(${columna}), '')
      ) grupos
      WHERE grupo IS NOT NULL
    `;

    if (textoBusqueda) {
      sql += ` AND grupo LIKE ?`;
      params.push(`%${textoBusqueda}%`);
    }

    sql += ` ORDER BY orden, grupo LIMIT ?`;
    params.push(limiteFinal);

    const [rows] = await pool.query<RowDataPacket[]>(sql, params);
    return rows.map((row) => ({
      valor: String(row.valor),
      etiqueta: String(row.etiqueta),
    }));
  }

  if (dimensionId === "GE_ASI") {
    const valores = [
      "< 1 Mes",
      "1-11 Meses",
      "1- 4 Años",
      "5- 9 Años",
      "10- 14 Años",
      "15- 19 Años",
      "20- 49 Años",
      "50- 59 Años",
      "60 y mas Años",
      "Sin grupo",
    ];
    const textoBusqueda = busqueda?.trim().toLowerCase();
    return valores
      .filter((valor) => !textoBusqueda || valor.toLowerCase().includes(textoBusqueda))
      .slice(0, limiteFinal)
      .map((valor) => ({ valor, etiqueta: valor }));
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
    sql += ` LIMIT ${limiteFinal}`;
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

export const obtenerValoresDimensionEgresos = async (
  dimensionId: string,
  busqueda?: string,
  limite?: number,
  regionIds?: number[] | null,
  filtrosCie: FiltrosCieValoresDimension = {}
): Promise<Array<{ valor: number | string; etiqueta: string }>> => {
  if (DIMENSIONES_EGRESOS_SIN_CACHE.has(dimensionId)) {
    return obtenerValoresDimensionEgresosSinCache(dimensionId, busqueda, limite, regionIds, filtrosCie);
  }

  return cache.getOrSet(
    construirClaveValoresDimensionEgresos(dimensionId, busqueda, limite, regionIds, filtrosCie),
    () => obtenerValoresDimensionEgresosSinCache(dimensionId, busqueda, limite, regionIds, filtrosCie),
    CACHE_TTL.DIMENSION_DINAMICA
  );
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

const ordenarValoresClave = (values?: Array<string | number>) =>
  [...(values ?? [])].map((value) => String(value)).sort();

const generarClaveCacheEgresosPivot = (
  payload: EgresosPivotPayload,
  regionIds?: number[] | null
): string => {
  const aniosKey = payload.years?.length
    ? `ys:${[...payload.years].sort((a, b) => a - b).join(",")}`
    : `y:${payload.year ?? "all"}`;
  const regionKey = regionIds?.length
    ? [...regionIds].sort((a, b) => a - b).join(",")
    : "all";

  const partes = [
    aniosKey,
    `scope:${regionKey}`,
    `r:${[...(payload.rows ?? [])].sort().join(",")}`,
    `c:${[...(payload.columns ?? [])].sort().join(",")}`,
    `v:${[...(payload.values ?? [])]
      .map((value) => `${value.field}:${value.aggregation ?? "default"}`)
      .sort()
      .join(",")}`,
    `f:${[...(payload.filters ?? [])]
      .map((filter) => `${filter.field}:${ordenarValoresClave(filter.values).join("|")}`)
      .sort()
      .join(",")}`,
    `l:${payload.limit ?? "default"}`,
    `t:${payload.includeTotals ?? true}`,
  ];

  return `egresos-pivot:query:${partes.join(":")}`;
};

const ejecutarConsultaEgresosSinCache = async (
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
  const desglosarDiagnosticoEgreso = usaDesgloseDiagnosticoEgreso(payload);
  const filaDims = (payload.rows ?? [])
    .map(obtenerDimension)
    .filter((dim): dim is DimensionDef => dim !== undefined)
    .map((dimension) => resolverDimensionConsulta(dimension, payload));
  const colDims = (payload.columns ?? [])
    .map(obtenerDimension)
    .filter((dim): dim is DimensionDef => dim !== undefined)
    .map((dimension) => resolverDimensionConsulta(dimension, payload));
  const allDims = [...filaDims, ...colDims];

  const medidasBase = payload.values
    .map((value) => obtenerMedida(value.field))
    .filter((measure): measure is MeasureDef => measure !== undefined);

  if (medidasBase.length === 0) {
    medidasBase.push(MEDIDAS[0]!);
  }

  const medidasSel = ajustarMedidasParaConsulta(optimizarMedidasConsulta(medidasBase), payload);
  const combinarOrdenConDiagnostico = tieneFiltroDimension(payload, "DIAGNOSTICOS_EGRESO");
  const combinarOrdenConOperacion = tieneFiltroDimension(payload, "OPERACIONES_EGRESO");

  const filterDims = (payload.filters ?? [])
    .filter((filter) => !(combinarOrdenConDiagnostico && filter.field === "CODIGO_ORDEN_AFECCION"))
    .filter((filter) => !(combinarOrdenConOperacion && filter.field === "CODIGO_ORDEN_OPERACION"))
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

  const { whereClause, whereParams } = construirWhere(
    payload,
    aniosConsultados,
    regionIds,
    desglosarDiagnosticoEgreso
  );
  const sqlParts = [`SELECT ${selectParts.join(", ")}`, fromClause, whereClause];

  if (allDims.length > 0) {
    sqlParts.push(` GROUP BY ${allDims.map(obtenerGroupByDimension).join(", ")}`);
    sqlParts.push(` ORDER BY ${allDims.map(obtenerOrderByDimension).join(", ")}`);
  }

  sqlParts.push(` LIMIT ${Math.min(Math.max(payload.limit ?? 5000, 1), 10000)}`);

  const [rows] = await pool.query<RowDataPacket[]>(sqlParts.join(""), whereParams);
  const datosPlano = rows.map((row) =>
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
      datosPlano.length < appliedLimit;

    if (puedeDerivarDesdeResultados) {
      totalGeneral = derivarTotalGeneralDesdeDatos(datosPlano, medidasSel);
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

  const resultadoPivot = pivotearColumnas(datosPlano, filaDims, colDims, medidasSel, totalGeneral);

  return {
    datos: resultadoPivot.datos,
    totalGeneral: resultadoPivot.totalGeneral,
    aniosConsultados,
    metadata: {
      dimensionesFilas: filaDims.map((dim) => dim.label),
      dimensionesColumnas: colDims.map((dim) => dim.label),
      dimensionesSeleccionadas: allDims.map((dim) => dim.label),
      medidasSeleccionadas: medidasSel.map((measure) => measure.label),
    },
  };
};

export const ejecutarConsultaEgresos = async (
  payload: EgresosPivotPayload,
  regionIds?: number[] | null
) =>
  cache.getOrSet(
    generarClaveCacheEgresosPivot(payload, regionIds),
    () => ejecutarConsultaEgresosSinCache(payload, regionIds),
    CACHE_TTL.CONSULTA_PIVOT
  );

const obtenerResumenEgresosSinCache = async (regionIds?: number[] | null) => {
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

export const obtenerResumenEgresos = async (regionIds?: number[] | null) => {
  const regionKey = regionIds?.length ? [...regionIds].sort((a, b) => a - b).join(",") : "all";
  return cache.getOrSet(
    `egresos-pivot:resumen:${regionKey}`,
    () => obtenerResumenEgresosSinCache(regionIds),
    CACHE_TTL.RESUMEN_TABLERO
  );
};
