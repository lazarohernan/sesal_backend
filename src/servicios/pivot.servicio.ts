import type { RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";

import { obtenerPoolActual } from "../base_datos/pool";
import { cache, CACHE_TTL, CACHE_KEYS } from "../utilidades/cache.utilidad";

const tomarPool = () => obtenerPoolActual();

const TABLA_DETALLE = "AT2_DETALLE";

type JoinKey =
  | "us"
  | "cat_concepto"
  | "cat_concepto_ordenado"
  | "concepto_ge_codigo"
  | "cat_establecimiento"
  | "cat_region"
  | "deptos"
  | "municipios"
  | "cat_nivel_establecimiento"
  | "cat_nivel_operativo"
  | "cat_formularios"
  | "concepto_ge";

type DimensionType = "string" | "number";

interface DimensionDefinition {
  id: string;
  label: string;
  alias: string;
  type: DimensionType;
  select: string;
  groupBy: string;
  valueExpr: string;
  joins?: JoinKey[];
  orderBy?: string;
  catalog?: {
    table: string;
    valueColumn: string;
    labelColumn: string;
    orderBy?: string;
    preload?: boolean;
    defaultLimit?: number;
  };
}

type AggregationType = "SUM" | "AVG" | "COUNT" | "MAX" | "MIN";

interface MeasureDefinition {
  id: string;
  label: string;
  description: string;
  expression: string;
  defaultAggregation: AggregationType;
  valueType: "number";
}

interface PivotFilter {
  field: string;
  values?: Array<string | number>;
}

interface PivotValueRequest {
  field: string;
  aggregation?: AggregationType;
}

export interface PivotQueryPayload {
  year?: number;
  years?: number[];
  filters?: PivotFilter[];
  rows?: string[];
  columns?: string[];
  values: PivotValueRequest[];
  limit?: number;
  includeTotals?: boolean;
}

export interface PivotQueryResult {
  datos: Array<Record<string, unknown>>;
  totalGeneral: Record<string, unknown> | null;
  aniosConsultados: number[];
  metadata: {
    dimensionesSeleccionadas: string[];
    dimensionesFilas: string[];
    dimensionesColumnas: string[];
    medidasSeleccionadas: string[];
  };
}

export interface PivotCatalogoDimension {
  id: string;
  etiqueta: string;
  tipo: DimensionType;
  admiteFiltrado: boolean;
  valores?: Array<{ valor: string | number; etiqueta: string }>; // previsualización opcional
  totalValores?: number;
  endpointValores?: string;
}

export interface PivotCatalogoMedida {
  id: string;
  etiqueta: string;
  descripcion: string;
  agregacionPorDefecto: AggregationType;
}

export interface PivotCatalogo {
  dimensiones: PivotCatalogoDimension[];
  medidas: PivotCatalogoMedida[];
  actualizadoEn: string;
}

// JOINs con COLLATE explícito para evitar errores de mezcla de collations
// CAST AS CHAR produce utf8mb4_0900_ai_ci, pero las tablas cat_* usan utf8mb4_unicode_ci
const JOIN_DEFINITIONS: Record<JoinKey, string> = {
  us: "LEFT JOIN BAS_BDR_US us ON det.C_US COLLATE utf8mb4_unicode_ci = CAST(us.C_US AS CHAR) COLLATE utf8mb4_unicode_ci",
  cat_concepto:
    "LEFT JOIN cat_conceptos cat_concepto ON (TRIM(cat_concepto.codigo) COLLATE utf8mb4_unicode_ci = TRIM(det.C_CONCEPTO) COLLATE utf8mb4_unicode_ci OR TRIM(LEADING '0' FROM TRIM(cat_concepto.codigo)) COLLATE utf8mb4_unicode_ci = TRIM(LEADING '0' FROM TRIM(det.C_CONCEPTO)) COLLATE utf8mb4_unicode_ci)",
  cat_concepto_ordenado:
    "LEFT JOIN cat_concepto_ordenado cat_concepto_ordenado ON (TRIM(cat_concepto_ordenado.codigo) COLLATE utf8mb4_unicode_ci = TRIM(det.C_CONCEPTO) COLLATE utf8mb4_unicode_ci OR TRIM(LEADING '0' FROM TRIM(cat_concepto_ordenado.codigo)) COLLATE utf8mb4_unicode_ci = TRIM(LEADING '0' FROM TRIM(det.C_CONCEPTO)) COLLATE utf8mb4_unicode_ci)",
  concepto_ge_codigo:
    "LEFT JOIN (SELECT TRIM(LEADING '0' FROM TRIM(C_CONCEPTO)) AS codigo_normalizado, MAX(D_CONCEPTO) AS D_CONCEPTO FROM AT2_BDR_CONCEPTOS_GE GROUP BY TRIM(LEADING '0' FROM TRIM(C_CONCEPTO))) concepto_ge_codigo ON concepto_ge_codigo.codigo_normalizado COLLATE utf8mb4_unicode_ci = TRIM(LEADING '0' FROM TRIM(det.C_CONCEPTO)) COLLATE utf8mb4_unicode_ci",
  cat_establecimiento:
    "LEFT JOIN cat_establecimientos cat_establecimiento ON cat_establecimiento.codigo COLLATE utf8mb4_unicode_ci = det.C_US COLLATE utf8mb4_unicode_ci",
  cat_region:
    "LEFT JOIN cat_regiones cat_region ON cat_region.codigo COLLATE utf8mb4_unicode_ci = CAST(COALESCE(us.C_REGION, det.C_US) AS CHAR) COLLATE utf8mb4_unicode_ci",
  deptos:
    "LEFT JOIN BAS_BDR_DEPARTAMENTOS deptos ON deptos.C_DEPARTAMENTO = us.C_DEPARTAMENTO",
  municipios:
    "LEFT JOIN BAS_BDR_MUNICIPIOS municipios ON municipios.C_DEPARTAMENTO = us.C_DEPARTAMENTO AND municipios.C_MUNICIPIO = us.C_MUNICIPIO",
  cat_nivel_establecimiento:
    "LEFT JOIN cat_nivel_establecimiento cat_nivel_establecimiento ON cat_nivel_establecimiento.codigo COLLATE utf8mb4_unicode_ci = CAST(us.C_NIVEL_US AS CHAR) COLLATE utf8mb4_unicode_ci",
  cat_nivel_operativo:
    "LEFT JOIN cat_nivel_operativo cat_nivel_operativo ON cat_nivel_operativo.codigo COLLATE utf8mb4_unicode_ci = CAST(us.C_NIVEL_US AS CHAR) COLLATE utf8mb4_unicode_ci",
  cat_formularios:
    "LEFT JOIN cat_formularios cat_formularios ON cat_formularios.codigo COLLATE utf8mb4_unicode_ci = det.V_FORMULARIO COLLATE utf8mb4_unicode_ci",
  concepto_ge:
    "LEFT JOIN AT2_BDR_CONCEPTOS_GE concepto_ge ON concepto_ge.C_CONCEPTO COLLATE utf8mb4_unicode_ci = det.C_CONCEPTO COLLATE utf8mb4_unicode_ci AND concepto_ge.V_FORMULARIO COLLATE utf8mb4_unicode_ci = det.V_FORMULARIO COLLATE utf8mb4_unicode_ci"
};

const ETIQUETA_ESTABLECIMIENTO_SQL = `
  CONCAT(
    COALESCE(cat_establecimiento.nombre, CAST(det.C_US AS CHAR)),
    ' (RUPS: ',
    CAST(det.C_US AS CHAR),
    ')',
    CASE
      WHEN cat_nivel_establecimiento.descripcion IS NOT NULL
        THEN CONCAT(' - ', cat_nivel_establecimiento.descripcion)
      ELSE ''
    END,
    CASE
      WHEN municipios.D_MUNICIPIO IS NOT NULL
        THEN CONCAT(' - ', municipios.D_MUNICIPIO)
      ELSE ''
    END
  )
`;

const DIMENSIONES: Record<string, DimensionDefinition> = {
  ANIO: {
    id: "ANIO",
    label: "Año",
    alias: "anio",
    type: "number",
    select: "det.N_ANIO",
    groupBy: "det.N_ANIO",
    valueExpr: "det.N_ANIO",
    orderBy: "det.N_ANIO"
  },
  MES: {
    id: "MES",
    label: "Mes",
    alias: "mes",
    type: "string",
    select: `CASE det.N_MES
               WHEN 1 THEN 'Enero'
               WHEN 2 THEN 'Febrero'
               WHEN 3 THEN 'Marzo'
               WHEN 4 THEN 'Abril'
               WHEN 5 THEN 'Mayo'
               WHEN 6 THEN 'Junio'
               WHEN 7 THEN 'Julio'
               WHEN 8 THEN 'Agosto'
               WHEN 9 THEN 'Septiembre'
               WHEN 10 THEN 'Octubre'
               WHEN 11 THEN 'Noviembre'
               WHEN 12 THEN 'Diciembre'
               ELSE CONCAT('Mes ', det.N_MES)
             END`,
    groupBy: "det.N_MES",
    valueExpr: "det.N_MES",
    orderBy: "det.N_MES"
  },
  CONCEPTO: {
    id: "CONCEPTO",
    label: "Concepto",
    alias: "concepto",
    type: "string",
    select:
      "COALESCE(cat_concepto.descripcion, concepto_ge.D_CONCEPTO, concepto_ge_codigo.D_CONCEPTO, CONCAT('Concepto ', det.C_CONCEPTO, ' (sin catálogo)'))",
    groupBy:
      "COALESCE(cat_concepto.descripcion, concepto_ge.D_CONCEPTO, concepto_ge_codigo.D_CONCEPTO, CONCAT('Concepto ', det.C_CONCEPTO, ' (sin catálogo)'))",
    valueExpr: "det.C_CONCEPTO",
    joins: ["cat_concepto", "concepto_ge", "concepto_ge_codigo"],
    orderBy:
      "COALESCE(cat_concepto.descripcion, concepto_ge.D_CONCEPTO, concepto_ge_codigo.D_CONCEPTO, CONCAT('Concepto ', det.C_CONCEPTO, ' (sin catálogo)'))",
    catalog: {
      table: "cat_conceptos",
      valueColumn: "codigo",
      labelColumn: "descripcion",
      orderBy: "codigo",
      preload: false,
      defaultLimit: 100
    }
  },
  CONCEPTO_ORDENADO: {
    id: "CONCEPTO_ORDENADO",
    label: "Concepto Ordenado",
    alias: "concepto_ordenado",
    type: "string",
    // Fallback a cat_conceptos y conceptos_ge cuando cat_concepto_ordenado está incompleto.
    select:
      "COALESCE(cat_concepto_ordenado.descripcion, cat_concepto.descripcion, concepto_ge.D_CONCEPTO, concepto_ge_codigo.D_CONCEPTO, CONCAT('Concepto ', det.C_CONCEPTO, ' (sin catálogo)'))",
    groupBy:
      "COALESCE(cat_concepto_ordenado.descripcion, cat_concepto.descripcion, concepto_ge.D_CONCEPTO, concepto_ge_codigo.D_CONCEPTO, CONCAT('Concepto ', det.C_CONCEPTO, ' (sin catálogo)')), cat_concepto_ordenado.codigo, cat_concepto.codigo, det.C_CONCEPTO",
    valueExpr: "det.C_CONCEPTO",
    joins: ["cat_concepto_ordenado", "cat_concepto", "concepto_ge", "concepto_ge_codigo"],
    orderBy: "LPAD(COALESCE(cat_concepto_ordenado.codigo, cat_concepto.codigo, det.C_CONCEPTO), 2, '0')",
    catalog: {
      table: "cat_concepto_ordenado",
      valueColumn: "codigo",
      labelColumn: "descripcion",
      orderBy: "LPAD(codigo, 2, '0')",
      preload: false,
      defaultLimit: 100
    }
  },
  GRUPO_ESPECIAL: {
    id: "GRUPO_ESPECIAL",
    label: "Grupo Especial",
    alias: "grupo_especial",
    type: "string",
    select: "concepto_ge.GRUPO_ESPECIAL",
    groupBy: "concepto_ge.GRUPO_ESPECIAL",
    valueExpr: "concepto_ge.GRUPO_ESPECIAL",
    joins: ["concepto_ge"],
    orderBy: "concepto_ge.GRUPO_ESPECIAL"
  },
  ESTABLECIMIENTO: {
    id: "ESTABLECIMIENTO",
    label: "Establecimiento de Salud",
    alias: "establecimiento",
    type: "string",
    select: ETIQUETA_ESTABLECIMIENTO_SQL,
    groupBy: "det.C_US, cat_establecimiento.nombre, cat_nivel_establecimiento.descripcion, municipios.D_MUNICIPIO",
    valueExpr: "det.C_US",
    joins: ["us", "cat_establecimiento", "cat_nivel_establecimiento", "municipios"],
    orderBy: "cat_establecimiento.nombre",
    catalog: {
      table: "cat_establecimientos",
      valueColumn: "codigo",
      labelColumn: "nombre",
      orderBy: "nombre",
      preload: false,
      defaultLimit: 2500
    }
  },
  REGION: {
    id: "REGION",
    label: "Región",
    alias: "region",
    type: "string",
    select: "COALESCE(cat_region.descripcion, CAST(COALESCE(us.C_REGION, det.C_US) AS CHAR))",
    groupBy: "COALESCE(cat_region.descripcion, CAST(COALESCE(us.C_REGION, det.C_US) AS CHAR))",
    valueExpr: "COALESCE(us.C_REGION, det.C_US)",
    joins: ["us", "cat_region"],
    orderBy: "COALESCE(cat_region.descripcion, CAST(COALESCE(us.C_REGION, det.C_US) AS CHAR))",
    catalog: {
      table: "cat_regiones",
      valueColumn: "codigo",
      labelColumn: "descripcion",
      orderBy: "CAST(codigo AS UNSIGNED)",
      preload: true
    }
  },
  MUNICIPIO: {
    id: "MUNICIPIO",
    label: "Municipio",
    alias: "municipio",
    type: "string",
    // Mostrar solo el nombre del municipio (sin departamento) cuando hay filtro de región
    select: "COALESCE(municipios.D_MUNICIPIO, CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO))",
    // Agrupar por código único (departamento-municipio) para evitar combinar municipios con el mismo nombre
    groupBy: "us.C_DEPARTAMENTO, us.C_MUNICIPIO, municipios.D_MUNICIPIO",
    valueExpr: "CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO)",
    joins: ["us", "municipios"],
    orderBy: "municipios.D_MUNICIPIO",
    catalog: {
      table: "BAS_BDR_MUNICIPIOS",
      valueColumn: "CONCAT(C_DEPARTAMENTO, '-', C_MUNICIPIO)",
      labelColumn: "D_MUNICIPIO",
      orderBy: "C_DEPARTAMENTO, C_MUNICIPIO",
      preload: false,
      defaultLimit: 300
    }
  },
  NIVEL_ESTABLECIMIENTO: {
    id: "NIVEL_ESTABLECIMIENTO",
    label: "Nivel de Establecimiento de Salud",
    alias: "nivel_establecimiento",
    type: "string",
    select: "cat_nivel_establecimiento.descripcion",
    groupBy: "cat_nivel_establecimiento.descripcion",
    valueExpr: "CAST(us.C_NIVEL_US AS CHAR)",
    joins: ["us", "cat_nivel_establecimiento"],
    orderBy: "cat_nivel_establecimiento.descripcion",
    catalog: {
      table: "cat_nivel_establecimiento",
      valueColumn: "codigo",
      labelColumn: "descripcion",
      orderBy: "CAST(codigo AS UNSIGNED)",
      preload: true
    }
  },
  NIVEL_OPERATIVO: {
    id: "NIVEL_OPERATIVO",
    label: "Nivel Operativo",
    alias: "nivel_operativo",
    type: "string",
    select: "cat_nivel_operativo.descripcion",
    groupBy: "cat_nivel_operativo.codigo",
    valueExpr: "cat_nivel_operativo.codigo",
    joins: ["us", "cat_nivel_operativo"],
    orderBy: "cat_nivel_operativo.codigo",
    catalog: {
      table: "cat_nivel_operativo",
      valueColumn: "codigo",
      labelColumn: "descripcion",
      orderBy: "codigo",
      preload: true
    }
  },
  FORMULARIO: {
    id: "FORMULARIO",
    label: "Formulario",
    alias: "formulario",
    type: "string",
    select: "COALESCE(cat_formularios.descripcion, det.V_FORMULARIO)",
    groupBy: "COALESCE(cat_formularios.descripcion, det.V_FORMULARIO)",
    valueExpr: "det.V_FORMULARIO",
    joins: ["cat_formularios"],
    orderBy: "COALESCE(cat_formularios.descripcion, det.V_FORMULARIO)",
    catalog: {
      table: "cat_formularios",
      valueColumn: "codigo",
      labelColumn: "descripcion",
      orderBy: "codigo",
      preload: true
    }
  },
  BLOQUE: {
    id: "BLOQUE",
    label: "Bloque",
    alias: "bloque",
    type: "string",
    select: `CASE concepto_ge.C_FORM_BLOQUE 
               WHEN '1' THEN 'Atención en Grupo de Edad'
               WHEN '2' THEN 'Atención Integral a la Mujer'
               WHEN '3' THEN 'Atención Integral al Niño'
               WHEN '4' THEN 'Datos Generales'
               WHEN '0' THEN '[Ninguno]'
               WHEN NULL THEN '[Ninguno]'
               ELSE '[Ninguno]'
             END`,
    groupBy: "concepto_ge.C_FORM_BLOQUE",
    valueExpr: "concepto_ge.C_FORM_BLOQUE",
    joins: ["concepto_ge"],
    orderBy: "concepto_ge.C_FORM_BLOQUE",
    catalog: {
      table: "(SELECT '1' AS valor, 'Atención en Grupo de Edad' AS etiqueta UNION ALL " +
             "SELECT '2' AS valor, 'Atención Integral a la Mujer' AS etiqueta UNION ALL " +
             "SELECT '3' AS valor, 'Atención Integral al Niño' AS etiqueta UNION ALL " +
             "SELECT '4' AS valor, 'Datos Generales' AS etiqueta UNION ALL " +
             "SELECT '0' AS valor, '[Ninguno]' AS etiqueta) bloques",
      valueColumn: "valor",
      labelColumn: "etiqueta",
      preload: true
    }
  },
  SERVICIO: {
    id: "SERVICIO",
    label: "Servicio",
    alias: "servicio",
    type: "string",
    select: `CASE det.C_SERVICIO 
               WHEN '1' THEN 'Consultas Externas'
               WHEN '2' THEN 'Emergencias'
               ELSE det.C_SERVICIO
             END`,
    groupBy: "det.C_SERVICIO",
    valueExpr: "det.C_SERVICIO",
    orderBy: "det.C_SERVICIO",
    catalog: {
      table: "(SELECT '1' AS valor, 'Consultas Externas' AS etiqueta UNION ALL " +
             "SELECT '2' AS valor, 'Emergencias' AS etiqueta) servicios",
      valueColumn: "valor",
      labelColumn: "etiqueta",
      preload: true
    }
  }
};

const TOTAL_EXPRESSION =
  "COALESCE(det.Q_AT_ENFERMERA_AUX, 0) + COALESCE(det.Q_AT_ENFERMERA_PRO, 0) + COALESCE(det.Q_AT_MEDICO_GEN, 0) + COALESCE(det.Q_AT_MEDICO_ESP, 0)";

const MEDIDAS: Record<string, MeasureDefinition> = {
  TOTAL: {
    id: "TOTAL",
    label: "Total de Atenciones",
    description: "Suma de todas las atenciones registradas",
    expression: TOTAL_EXPRESSION,
    defaultAggregation: "SUM",
    valueType: "number"
  },
  Q_AT_ENFERMERA_AUX: {
    id: "Q_AT_ENFERMERA_AUX",
    label: "Enfermeras Auxiliares",
    description: "Atenciones realizadas por enfermera auxiliar",
    expression: "COALESCE(det.Q_AT_ENFERMERA_AUX, 0)",
    defaultAggregation: "SUM",
    valueType: "number"
  },
  Q_AT_ENFERMERA_PRO: {
    id: "Q_AT_ENFERMERA_PRO",
    label: "Enfermeras Profesionales",
    description: "Atenciones realizadas por enfermera profesional",
    expression: "COALESCE(det.Q_AT_ENFERMERA_PRO, 0)",
    defaultAggregation: "SUM",
    valueType: "number"
  },
  Q_AT_MEDICO_GEN: {
    id: "Q_AT_MEDICO_GEN",
    label: "Médicos Generales",
    description: "Consultas medicina general",
    expression: "COALESCE(det.Q_AT_MEDICO_GEN, 0)",
    defaultAggregation: "SUM",
    valueType: "number"
  },
  Q_AT_MEDICO_ESP: {
    id: "Q_AT_MEDICO_ESP",
    label: "Médicos Especialistas",
    description: "Consultas medicina especializada",
    expression: "COALESCE(det.Q_AT_MEDICO_ESP, 0)",
    defaultAggregation: "SUM",
    valueType: "number"
  },
  MES: {
    id: "MES",
    label: "Mes",
    description: "Mes del registro",
    expression: "COALESCE(det.N_MES, 0)",
    defaultAggregation: "SUM",
    valueType: "number"
  }
};

// Límite por defecto para consultas sin columnas pivot
const DEFAULT_LIMIT = 10000;
// Límite aumentado para consultas con columnas pivot (necesitan más filas para el pivoteo)
const DEFAULT_LIMIT_PIVOT = 100000;
// Máximo absoluto para consultas muy grandes
const MAX_LIMIT = 500000;

const obtenerTablasDetalleDisponibles = async (): Promise<number[]> => {
  return cache.getOrSet(
    CACHE_KEYS.TABLAS_DETALLE,
    async () => {
      const pool = tomarPool();
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT DISTINCT N_ANIO AS anio FROM ${TABLA_DETALLE} ORDER BY N_ANIO`
      );
      return rows
        .map((row) => Number(row.anio))
        .filter((year) => Number.isFinite(year))
        .sort((a, b) => a - b);
    },
    CACHE_TTL.ANIOS_DISPONIBLES
  );
};

const asegurarJoins = (joinsNecesarios: Set<JoinKey>): string => {
  return Array.from(joinsNecesarios)
    .map((clave) => JOIN_DEFINITIONS[clave])
    .filter(Boolean)
    .join("\n");
};

const obtenerPeriodosDisponibles = async (): Promise<Array<{ anio: number; meses: number[] }>> => {
  return cache.getOrSet(
    CACHE_KEYS.PERIODOS_DISPONIBLES,
    async () => {
      const pool = tomarPool();

      const [filas] = await pool.query<RowDataPacket[]>(
        `SELECT DISTINCT N_ANIO AS anio
         FROM ${TABLA_DETALLE}
         ORDER BY N_ANIO DESC`
      );

      const periodos: Array<{ anio: number; meses: number[] }> = [];

      for (const fila of filas) {
        const anio = Number(fila.anio);
        if (!Number.isFinite(anio)) continue;

        periodos.push({
          anio,
          meses: []
        });
      }

      return periodos;
    },
    CACHE_TTL.ANIOS_DISPONIBLES
  );
};

export const obtenerCatalogoPivot = async (): Promise<PivotCatalogo> => {
  return cache.getOrSet(
    CACHE_KEYS.CATALOGO_PIVOT,
    async () => {
      const pool = tomarPool();

      const periodos = await obtenerPeriodosDisponibles();
      let aniosDisponibles = periodos.map((p) => p.anio).sort((a, b) => a - b);

      if (!aniosDisponibles.length) {
        aniosDisponibles = await obtenerTablasDetalleDisponibles();
      }

      const dimensiones: PivotCatalogoDimension[] = [];

      for (const dimension of Object.values(DIMENSIONES)) {
        const base: PivotCatalogoDimension = {
          id: dimension.id,
          etiqueta: dimension.label,
          tipo: dimension.type,
          admiteFiltrado: true
        };

        // La dimensión ANIO está comentada, ya no se usa
        if (dimension.id === "MES") {
          const nombresMeses = [
            "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
            "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
          ];
          base.valores = Array.from({ length: 12 }, (_, idx) => {
            const mes = idx + 1;
            return { valor: mes, etiqueta: nombresMeses[idx] };
          });
          base.totalValores = 12;
        } else if (dimension.catalog?.preload) {
          const limit = dimension.catalog.defaultLimit ?? 200;
          const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT ${dimension.catalog.valueColumn} AS valor, ${dimension.catalog.labelColumn} AS etiqueta FROM ${dimension.catalog.table} ORDER BY ${dimension.catalog.orderBy ?? dimension.catalog.labelColumn} LIMIT ?`,
            [limit]
          );
          base.valores = rows.map((row) => ({ valor: row.valor, etiqueta: row.etiqueta }));
          base.totalValores = rows.length;
        } else if (dimension.catalog) {
          const [rows] = await pool.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS total FROM ${dimension.catalog.table}`
          );
          base.totalValores = Number(rows[0]?.total ?? 0);
          base.endpointValores = `/api/pivot/dimensiones/${dimension.id}/valores`;
        }

        dimensiones.push(base);
      }

      const medidas: PivotCatalogoMedida[] = Object.values(MEDIDAS).map((medida) => ({
        id: medida.id,
        etiqueta: medida.label,
        descripcion: medida.description,
        agregacionPorDefecto: medida.defaultAggregation
      }));

      return {
        dimensiones,
        medidas,
        actualizadoEn: new Date().toISOString()
      };
    },
    CACHE_TTL.CATALOGO_PIVOT
  );
};

export const obtenerAniosDisponibles = async (): Promise<number[]> => {
  return cache.getOrSet(
    CACHE_KEYS.ANIOS_DISPONIBLES,
    async () => {
      try {
        const periodos = await obtenerPeriodosDisponibles();
        if (periodos.length > 0) {
          return periodos.map(p => p.anio).sort((a, b) => b - a); // Más reciente primero
        }
        
        // Fallback: obtener años de las tablas de detalle
        const anios = await obtenerTablasDetalleDisponibles();
        return anios.sort((a, b) => b - a);
      } catch (error) {
        console.error("Error obteniendo años disponibles:", error);
        return [2025]; // Fallback por defecto
      }
    },
    CACHE_TTL.ANIOS_DISPONIBLES
  );
};

export const obtenerMesesOcupados = async (anio: number): Promise<number[]> => {
  return cache.getOrSet(
    CACHE_KEYS.MESES_OCUPADOS(anio),
    async () => {
      const pool = tomarPool();
      try {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT DISTINCT N_MES AS mes FROM ${TABLA_DETALLE} WHERE N_ANIO = ? ORDER BY mes`,
          [anio]
        );
        return rows.map(r => Number(r.mes));
      } catch {
        return [];
      }
    },
    CACHE_TTL.ANIOS_DISPONIBLES
  );
};

const normalizarFiltroRegiones = (filtroRegion?: string | string[]) => {
  if (!filtroRegion) {
    return [] as string[];
  }

  const lista = Array.isArray(filtroRegion) ? filtroRegion : [filtroRegion];
  return Array.from(
    new Set(
      lista
        .map((region) => String(region).trim())
        .filter((region) => /^\d+$/.test(region))
    )
  );
};

export const obtenerValoresDimension = async (
  dimensionId: string,
  busqueda?: string,
  limite?: number,
  filtroRegion?: string | string[],
  filtroMunicipio?: string
): Promise<Array<{ valor: string | number; etiqueta: string }>> => {
  const dimension = DIMENSIONES[dimensionId];
  if (!dimension || !dimension.catalog) {
    throw new Error("La dimensión indicada no permite carga dinámica de valores");
  }
  const catalog = dimension.catalog;

  // Si no se especifica límite, usar el defaultLimit de la dimensión o 2000 para ESTABLECIMIENTO
  const limiteFinal = limite ?? (dimensionId === "ESTABLECIMIENTO" ? 2000 : (catalog.defaultLimit ?? 200));
  const regionesFiltro = normalizarFiltroRegiones(filtroRegion);
  const cacheTtl = catalog.preload || dimensionId === "REGION" || dimensionId === "DEPARTAMENTO" || dimensionId === "MUNICIPIO"
    ? CACHE_TTL.DIMENSION_ESTATICA
    : CACHE_TTL.DIMENSION_DINAMICA;
  const cacheKey = CACHE_KEYS.DIMENSION_VALORES(
    dimensionId,
    JSON.stringify({
      busqueda: busqueda?.trim() ?? "",
      limite: limiteFinal,
      filtroRegion: regionesFiltro.join(","),
      filtroMunicipio: filtroMunicipio ?? ""
    })
  );

  return cache.getOrSet(
    cacheKey,
    async () => {
      const pool = tomarPool();

      // Caso especial: MUNICIPIO con filtro de región
      if (dimensionId === "REGION" && regionesFiltro.length) {
        const placeholders = regionesFiltro.map(() => "?").join(", ");
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT codigo AS valor, descripcion AS etiqueta
           FROM cat_regiones
           WHERE codigo IN (${placeholders})
           ORDER BY descripcion`,
          [...regionesFiltro]
        );
        return rows.map((row) => ({ valor: row.valor, etiqueta: row.etiqueta }));
      }

      if (dimensionId === "DEPARTAMENTO" && regionesFiltro.length) {
        const placeholders = regionesFiltro.map(() => "?").join(", ");
        const parametros: Array<string | number> = [...regionesFiltro];
        let whereBusqueda = "";
        if (busqueda) {
          whereBusqueda = " AND dep.D_DEPARTAMENTO LIKE ?";
          parametros.push(`%${busqueda}%`);
        }
        const [rows] = await pool.query<RowDataPacket[]>(
          `
            SELECT DISTINCT
              dep.C_DEPARTAMENTO AS valor,
              dep.D_DEPARTAMENTO AS etiqueta
            FROM BAS_BDR_US us
            INNER JOIN BAS_BDR_DEPARTAMENTOS dep
              ON dep.C_DEPARTAMENTO = us.C_DEPARTAMENTO
            WHERE us.C_REGION IN (${placeholders})${whereBusqueda}
            ORDER BY dep.D_DEPARTAMENTO
            LIMIT ?
          `,
          [...parametros, limiteFinal]
        );
        return rows.map((row) => ({ valor: row.valor, etiqueta: row.etiqueta }));
      }

      if (dimensionId === "MUNICIPIO" && regionesFiltro.length) {
        return obtenerMunicipiosPorRegion(pool, regionesFiltro, busqueda, limiteFinal);
      }

      // Caso especial: ESTABLECIMIENTO con filtros
      if (dimensionId === "ESTABLECIMIENTO") {
        if (filtroMunicipio) {
          return obtenerEstablecimientosPorMunicipio(pool, filtroMunicipio, busqueda, limiteFinal, regionesFiltro);
        }
        if (regionesFiltro.length) {
          return obtenerEstablecimientosPorRegion(pool, regionesFiltro, busqueda, limiteFinal);
        }
      }

      const tabla = catalog.table;
      const valueColumn = catalog.valueColumn;
      const labelColumn = catalog.labelColumn;
      const orderBy = catalog.orderBy ?? labelColumn;

      const condiciones: string[] = [];
      const parametros: Array<string | number> = [];

      if (busqueda) {
        if (dimensionId === "ESTABLECIMIENTO") {
          const esSoloNumeros = /^\d+$/.test(busqueda.trim());
          if (esSoloNumeros) {
            condiciones.push(`(${valueColumn} = ? OR ${labelColumn} LIKE ?)`);
            parametros.push(busqueda.trim(), `%${busqueda}%`);
          } else {
            condiciones.push(`(${labelColumn} LIKE ? OR ${valueColumn} LIKE ?)`);
            parametros.push(`%${busqueda}%`, `%${busqueda}%`);
          }
        } else {
          condiciones.push(`${labelColumn} LIKE ?`);
          parametros.push(`%${busqueda}%`);
        }
      }

      const whereClause = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
      const sql = `SELECT ${valueColumn} AS valor, ${labelColumn} AS etiqueta FROM ${tabla} ${whereClause} ORDER BY ${orderBy} LIMIT ?`;
      parametros.push(limiteFinal);

      const [rows] = await pool.query<RowDataPacket[]>(sql, parametros);
      return rows.map((row) => ({ valor: row.valor, etiqueta: row.etiqueta }));
    },
    cacheTtl
  );
};

// Función especial para obtener municipios filtrados por región
const obtenerMunicipiosPorRegion = async (
  pool: Pool,
  filtroRegion: string[],
  busqueda?: string,
  limite?: number
): Promise<Array<{ valor: string | number; etiqueta: string }>> => {
  const condiciones: string[] = [];
  const parametros: Array<string | number> = [];

  // Filtrar por región
  condiciones.push(`us.C_REGION IN (${filtroRegion.map(() => "?").join(", ")})`);
  parametros.push(...filtroRegion);

  // Búsqueda opcional
  if (busqueda) {
    condiciones.push("m.D_MUNICIPIO LIKE ?");
    parametros.push(`%${busqueda}%`);
  }

  const whereClause = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const limiteFinal = limite ?? 200;

  const sql = `
    SELECT DISTINCT
      CONCAT(m.C_DEPARTAMENTO, '-', m.C_MUNICIPIO) AS valor,
      m.D_MUNICIPIO AS etiqueta
    FROM BAS_BDR_US us
    INNER JOIN BAS_BDR_MUNICIPIOS m 
      ON m.C_DEPARTAMENTO = us.C_DEPARTAMENTO 
      AND m.C_MUNICIPIO = us.C_MUNICIPIO
    ${whereClause}
    ORDER BY m.D_MUNICIPIO
    LIMIT ?
  `;
  parametros.push(limiteFinal);

  const [rows] = await pool.query<RowDataPacket[]>(sql, parametros);
  return rows.map((row: RowDataPacket) => ({ valor: row.valor, etiqueta: row.etiqueta }));
};

// Función especial para obtener establecimientos filtrados por municipio
const obtenerEstablecimientosPorMunicipio = async (
  pool: Pool,
  filtroMunicipio: string,
  busqueda?: string,
  limite?: number,
  filtroRegiones?: string[]
): Promise<Array<{
  valor: string | number;
  etiqueta: string;
  nombre?: string;
  rups?: string;
  nivel?: string | null;
  municipio?: string | null;
  regionCodigo?: number | null;
  regionNombre?: string | null;
  activo?: boolean;
}>> => {
  const condiciones: string[] = [];
  const parametros: Array<string | number> = [];

  // Parsear municipio (formato: "DEPARTAMENTO-MUNICIPIO")
  const partes = filtroMunicipio.split('-');
  if (partes.length !== 2) {
    throw new Error("Formato de municipio inválido. Debe ser 'DEPARTAMENTO-MUNICIPIO'");
  }

  const [departamento, municipio] = partes;

  // Filtrar por municipio
  condiciones.push("us.C_DEPARTAMENTO = ?");
  condiciones.push("us.C_MUNICIPIO = ?");
  parametros.push(Number(departamento), Number(municipio));

  if (filtroRegiones?.length) {
    condiciones.push(`us.C_REGION IN (${filtroRegiones.map(() => "?").join(", ")})`);
    parametros.push(...filtroRegiones);
  }

  // Búsqueda opcional
  if (busqueda) {
    const esSoloNumeros = /^\d+$/.test(busqueda.trim());
    if (esSoloNumeros) {
      // Búsqueda exacta en código O parcial en nombre
      condiciones.push("(cat.codigo = ? OR cat.nombre LIKE ?)");
      parametros.push(busqueda.trim(), `%${busqueda}%`);
    } else {
      // Búsqueda parcial en ambos campos
      condiciones.push("(cat.nombre LIKE ? OR cat.codigo LIKE ?)");
      parametros.push(`%${busqueda}%`, `%${busqueda}%`);
    }
  }

  const whereClause = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const limiteFinal = limite ?? 2000;

  const sql = `
    SELECT DISTINCT
      cat.codigo AS valor,
      CONCAT(
        COALESCE(cat.nombre, CAST(us.C_US AS CHAR)),
        ' (RUPS: ',
        CAST(us.C_US AS CHAR),
        ')',
        CASE
          WHEN nivel.D_NIVEL_US IS NOT NULL THEN CONCAT(' - ', nivel.D_NIVEL_US)
          ELSE ''
        END,
        CASE
          WHEN muni.D_MUNICIPIO IS NOT NULL THEN CONCAT(' - ', muni.D_MUNICIPIO)
          ELSE ''
        END
      ) AS etiqueta,
      COALESCE(cat.nombre, CAST(us.C_US AS CHAR)) AS nombre,
      CAST(us.C_US AS CHAR) AS rups,
      nivel.D_NIVEL_US AS nivel,
      muni.D_MUNICIPIO AS municipio,
      us.C_REGION AS regionCodigo,
      reg.descripcion AS regionNombre,
      CASE
        WHEN UPPER(COALESCE(us.B_ACTIVA, 'S')) IN ('S', '1', 'SI', 'TRUE', 'T', 'Y', 'YES')
          THEN 1
        ELSE 0
      END AS activo
    FROM cat_establecimientos cat
    INNER JOIN BAS_BDR_US us 
      ON cat.codigo COLLATE utf8mb4_unicode_ci = CAST(us.C_US AS CHAR) COLLATE utf8mb4_unicode_ci
    LEFT JOIN BAS_BDR_NIVELES_US nivel
      ON nivel.C_NIVEL_US = us.C_NIVEL_US
    LEFT JOIN BAS_BDR_MUNICIPIOS muni
      ON muni.C_DEPARTAMENTO = us.C_DEPARTAMENTO
     AND muni.C_MUNICIPIO = us.C_MUNICIPIO
    LEFT JOIN cat_regiones reg
      ON reg.codigo = us.C_REGION
    ${whereClause}
    ORDER BY etiqueta
    LIMIT ?
  `;
  parametros.push(limiteFinal);

  const [rows] = await pool.query<RowDataPacket[]>(sql, parametros);
  return rows.map((row: RowDataPacket) => ({
    valor: row.valor,
    etiqueta: row.etiqueta,
    nombre: row.nombre,
    rups: row.rups,
    nivel: row.nivel,
    municipio: row.municipio,
    regionCodigo: row.regionCodigo === null || row.regionCodigo === undefined ? null : Number(row.regionCodigo),
    regionNombre: row.regionNombre,
    activo: Boolean(Number(row.activo ?? 1))
  }));
};

// Función especial para obtener establecimientos filtrados por región
const obtenerEstablecimientosPorRegion = async (
  pool: Pool,
  filtroRegion: string[],
  busqueda?: string,
  limite?: number
): Promise<Array<{
  valor: string | number;
  etiqueta: string;
  nombre?: string;
  rups?: string;
  nivel?: string | null;
  municipio?: string | null;
  regionCodigo?: number | null;
  regionNombre?: string | null;
  activo?: boolean;
}>> => {
  const condiciones: string[] = [];
  const parametros: Array<string | number> = [];

  // Filtrar por región
  condiciones.push(`us.C_REGION IN (${filtroRegion.map(() => "?").join(", ")})`);
  parametros.push(...filtroRegion);

  // Búsqueda opcional
  if (busqueda) {
    const esSoloNumeros = /^\d+$/.test(busqueda.trim());
    if (esSoloNumeros) {
      // Búsqueda exacta en código O parcial en nombre
      condiciones.push("(cat.codigo = ? OR cat.nombre LIKE ?)");
      parametros.push(busqueda.trim(), `%${busqueda}%`);
    } else {
      // Búsqueda parcial en ambos campos
      condiciones.push("(cat.nombre LIKE ? OR cat.codigo LIKE ?)");
      parametros.push(`%${busqueda}%`, `%${busqueda}%`);
    }
  }

  const whereClause = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const limiteFinal = limite ?? 2000;

  const sql = `
    SELECT DISTINCT
      cat.codigo AS valor,
      CONCAT(
        COALESCE(cat.nombre, CAST(us.C_US AS CHAR)),
        ' (RUPS: ',
        CAST(us.C_US AS CHAR),
        ')',
        CASE
          WHEN nivel.D_NIVEL_US IS NOT NULL THEN CONCAT(' - ', nivel.D_NIVEL_US)
          ELSE ''
        END,
        CASE
          WHEN muni.D_MUNICIPIO IS NOT NULL THEN CONCAT(' - ', muni.D_MUNICIPIO)
          ELSE ''
        END
      ) AS etiqueta,
      COALESCE(cat.nombre, CAST(us.C_US AS CHAR)) AS nombre,
      CAST(us.C_US AS CHAR) AS rups,
      nivel.D_NIVEL_US AS nivel,
      muni.D_MUNICIPIO AS municipio,
      us.C_REGION AS regionCodigo,
      reg.descripcion AS regionNombre,
      CASE
        WHEN UPPER(COALESCE(us.B_ACTIVA, 'S')) IN ('S', '1', 'SI', 'TRUE', 'T', 'Y', 'YES')
          THEN 1
        ELSE 0
      END AS activo
    FROM cat_establecimientos cat
    INNER JOIN BAS_BDR_US us 
      ON cat.codigo COLLATE utf8mb4_unicode_ci = CAST(us.C_US AS CHAR) COLLATE utf8mb4_unicode_ci
    LEFT JOIN BAS_BDR_NIVELES_US nivel
      ON nivel.C_NIVEL_US = us.C_NIVEL_US
    LEFT JOIN BAS_BDR_MUNICIPIOS muni
      ON muni.C_DEPARTAMENTO = us.C_DEPARTAMENTO
     AND muni.C_MUNICIPIO = us.C_MUNICIPIO
    LEFT JOIN cat_regiones reg
      ON reg.codigo = us.C_REGION
    ${whereClause}
    ORDER BY etiqueta
    LIMIT ?
  `;
  parametros.push(limiteFinal);

  const [rows] = await pool.query<RowDataPacket[]>(sql, parametros);
  return rows.map((row: RowDataPacket) => ({
    valor: row.valor,
    etiqueta: row.etiqueta,
    nombre: row.nombre,
    rups: row.rups,
    nivel: row.nivel,
    municipio: row.municipio,
    regionCodigo: row.regionCodigo === null || row.regionCodigo === undefined ? null : Number(row.regionCodigo),
    regionNombre: row.regionNombre,
    activo: Boolean(Number(row.activo ?? 1))
  }));
};

const normalizarValoresFiltro = (dimension: DimensionDefinition, valores?: Array<string | number>) => {
  if (!valores || !valores.length) return [] as Array<string | number>;
  if (dimension.type === "number") {
    return valores
      .map((valor) => {
        const numero = typeof valor === "number" ? valor : Number.parseFloat(String(valor));
        return Number.isFinite(numero) ? numero : undefined;
      })
      .filter((valor): valor is number => typeof valor === "number");
  }
  return valores.map((valor) => String(valor));
};

// La tabla unificada AT2_DETALLE usa particiones por año.
// MySQL hace partition pruning automático con WHERE N_ANIO IN (...).

const construirSeleccionMedidas = (valores: PivotValueRequest[]) => {
  return valores.map((valor, indice) => {
    const medida = MEDIDAS[valor.field];
    if (!medida) {
      throw new Error(`La métrica ${valor.field} no está permitida`);
    }
    const agregacion = valor.aggregation ?? medida.defaultAggregation;
    return {
      id: medida.id,
      alias: `medida_${indice}_${medida.id}`,
      etiqueta: medida.label,
      expresion: `${agregacion}(${medida.expression}) AS medida_${indice}_${medida.id}`,
      expresionSinAlias: `${agregacion}(${medida.expression})`
    };
  });
};

const construirSelectDimensiones = (ids: string[]) => {
  const definiciones = ids.map((id) => {
    const dimension = DIMENSIONES[id];
    if (!dimension) {
      throw new Error(`La dimensión ${id} no está permitida`);
    }
    return dimension;
  });

  const selects = definiciones.map((dimension) => `${dimension.select} AS ${dimension.alias}`);
  const groupBy = definiciones.map((dimension) => dimension.groupBy);
  const joins = definiciones.flatMap((dimension) => dimension.joins ?? []);
  const orderBy = definiciones
    .map((dimension) => dimension.orderBy)
    .filter((valor): valor is string => typeof valor === "string");


  return { selects, groupBy, joins: new Set<JoinKey>(joins), orderBy, definiciones };
};

const agregarJoinsDeFiltros = (filtros: PivotFilter[]): Set<JoinKey> => {
  const joins = new Set<JoinKey>();
  filtros.forEach((filtro) => {
    const dimension = DIMENSIONES[filtro.field];
    if (dimension?.joins) {
      dimension.joins.forEach((join) => joins.add(join));
    }
  });
  return joins;
};

const aplicarFiltros = (
  filtros: PivotFilter[] | undefined,
  dimensionesSeleccionadas: Set<string>,
  condiciones: string[],
  parametros: Array<string | number>
) => {
  if (!filtros?.length) return;
  for (const filtro of filtros) {
    const dimension = DIMENSIONES[filtro.field];
    if (!dimension) {
      throw new Error(`No se reconoce la dimensión ${filtro.field} en el filtrado`);
    }
    const valores = normalizarValoresFiltro(dimension, filtro.values);
    if (!valores.length) continue;

    const placeholders = valores.map(() => "?").join(", ");
    condiciones.push(`${dimension.valueExpr} IN (${placeholders})`);
    parametros.push(...valores);
    dimensionesSeleccionadas.add(dimension.id);
  }
};

const obtenerYearsDesdeFiltros = (filtros?: PivotFilter[]): number[] => {
  if (!filtros) return [];
  const filtroAnio = filtros.find((filtro) => filtro.field === "ANIO");
  if (!filtroAnio) return [];
  const valores = normalizarValoresFiltro(DIMENSIONES.ANIO, filtroAnio.values);
  return valores.map((valor) => Number(valor)).filter((valor) => Number.isFinite(valor));
};

const limpiarTextoPresentacion = (valor: unknown): unknown => {
  if (typeof valor !== "string") return valor;
  const sinControl = valor.replace(/[\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
  if (!sinControl) return "";
  return sinControl.replace(/^"(.*)"$/, "$1").trim();
};

const limpiarFilaSalida = (fila: Record<string, unknown>): Record<string, unknown> => {
  const limpia: Record<string, unknown> = {};
  Object.entries(fila).forEach(([key, value]) => {
    limpia[key] = limpiarTextoPresentacion(value);
  });
  return limpia;
};

const limpiarFilasSalida = (filas: Array<Record<string, unknown>>): Array<Record<string, unknown>> => {
  return filas.map((fila) => limpiarFilaSalida(fila));
};

const transformarDatosPivot = (
  datos: Array<Record<string, unknown>>,
  dimensionesFilas: string[],
  dimensionesColumnas: string[],
  medidas: Array<{ alias: string; etiqueta: string; id: string }>
) => {
  if (!datos.length) {
    return {
      cabeceras: [],
      filas: [],
      totales: []
    };
  }

  // Construir encabezados: dimensiones de fila + columnas dinámicas
  const cabecerasFijas = dimensionesFilas;
  const valoresColumnas = new Set<string>();
  
  // Recopilar todos los valores únicos de las dimensiones de columna
  datos.forEach(fila => {
    dimensionesColumnas.forEach(dim => {
      const valor = String(fila[dim] ?? '');
      if (valor && valor !== 'null' && valor !== 'undefined') {
        valoresColumnas.add(valor);
      }
    });
  });

  // Si no hay valores de columna, usar estructura simple
  if (valoresColumnas.size === 0) {
    // Usar etiquetas legibles para las cabeceras, pero alias para acceder a los datos
    const cabecerasDisplay = [...dimensionesFilas, ...medidas.map(m => m.etiqueta)];
    const cabecerasData = [...dimensionesFilas, ...medidas.map(m => m.alias)];
    
    const filas = datos.map(fila => 
      cabecerasData.map(cabecera => fila[cabecera] ?? null)
    );
    
    return {
      cabeceras: cabecerasDisplay,
      filas,
      totales: []
    };
  }

  // Crear encabezados solo con los valores de las columnas (sin el nombre de la métrica)
  const cabecerasColumnas: string[] = [];
  valoresColumnas.forEach(valorColumna => {
    medidas.forEach(medida => {
      cabecerasColumnas.push(`${valorColumna}_${medida.id}`);
    });
  });

  const cabeceras = [...cabecerasFijas, ...cabecerasColumnas];
  // Crear mapa de datos pivotados
  const mapaPivot = new Map<string, Record<string, unknown>>();
  
  const valorClaveDimension = (fila: Record<string, unknown>, dimension: string): string => {
    if (dimension === "MUNICIPIO" && fila.MUNICIPIO_CODIGO != null) {
      return String(fila.MUNICIPIO_CODIGO);
    }
    return String(fila[dimension] ?? "");
  };

  datos.forEach(fila => {
    // Crear clave única para la fila basada en dimensiones de fila
    const claveFila = dimensionesFilas.map((dim) => valorClaveDimension(fila, dim)).join('|');
    
    if (!mapaPivot.has(claveFila)) {
      mapaPivot.set(claveFila, {});
    }
    
    const filaPivot = mapaPivot.get(claveFila)!;
    
    // Agregar valores de dimensiones de fila
    dimensionesFilas.forEach(dim => {
      filaPivot[dim] = fila[dim];
    });
    
    // Agregar valores de medidas para cada dimensión de columna
    dimensionesColumnas.forEach(dimColumna => {
      const valorColumna = String(fila[dimColumna] ?? '');
      if (valorColumna && valorColumna !== 'null' && valorColumna !== 'undefined') {
        medidas.forEach(medida => {
          const claveCelda = `${valorColumna}_${medida.id}`;
          const valorCrudo = fila[medida.etiqueta] ?? fila[medida.alias];
          // Convertir a número si es string numérico
          const valorNumerico = typeof valorCrudo === "number" 
            ? valorCrudo 
            : (typeof valorCrudo === "string" ? parseFloat(valorCrudo) || 0 : 0);
          filaPivot[claveCelda] = valorNumerico;
        });
      }
    });
  });

  // Convertir mapa a array de filas preservando el orden original de los datos
  // Extraer el orden de las claves según aparecen en los datos originales
  const ordenClaves: string[] = [];
  const clavesVistas = new Set<string>();
  
  datos.forEach(fila => {
    const claveFila = dimensionesFilas.map((dim) => valorClaveDimension(fila, dim)).join('|');
    if (!clavesVistas.has(claveFila)) {
      ordenClaves.push(claveFila);
      clavesVistas.add(claveFila);
    }
  });
  
  // Construir filas en el orden original
  const filas = ordenClaves.map(clave => {
    const fila = mapaPivot.get(clave)!;
    return cabeceras.map(cabecera => fila[cabecera] ?? null);
  });

  // Calcular totales por columna
  const totales = cabeceras.map((cabecera, index) => {
    if (index < dimensionesFilas.length) {
      return index === 0 ? 'Total' : null;
    }
    
    // Sumar valores numéricos de esta columna
    const suma = filas.reduce((acc, fila) => {
      const valor = fila[index];
      return acc + (typeof valor === 'number' ? valor : 0);
    }, 0);
    
    return suma;
  });

  return {
    cabeceras,
    filas,
    totales
  };
};

async function ejecutarConsultaAgregada(payload: PivotQueryPayload): Promise<PivotQueryResult | null> {
  // Solo usar agregación si:
  // 1. Rows = ['CONCEPTO']
  // 2. Values = [{ field: 'TOTAL', aggregation: 'SUM' }]
  // 3. Filters solo contiene ANIO (NO región, NO otros filtros)
  const filas = payload.rows ?? [];
  const valores = payload.values ?? [];
  const filtros = payload.filters ?? [];
  
  // Verificar que NO haya filtros de región/departamento
  const tieneFiltroRegion = filtros.some(f => 
    f.field === 'REGION' || 
    f.field === 'DEPARTAMENTO' || 
    f.field === 'MUNICIPIO' ||
    f.field === 'US'
  );
  
  const usaAgregacion = 
    filas.length === 1 && filas[0] === 'CONCEPTO' &&
    valores.length === 1 && valores[0].field === 'TOTAL' && valores[0].aggregation === 'SUM' &&
    !tieneFiltroRegion && // NO debe tener filtros geográficos
    filtros.every(f => f.field === 'ANIO' || f.field === 'CONCEPTO'); // Solo ANIO o CONCEPTO
  
  if (!usaAgregacion) return null;
  
  // Construir consulta optimizada
  const anios = filtros.find(f => f.field === 'ANIO')?.values ?? [];
  const limite = payload.limit ?? 20;
  
  let whereClause = 'WHERE C_REGION IS NULL';
  const params: any[] = [];
  
  if (anios.length > 0) {
    whereClause += ` AND N_ANIO IN (${anios.map(() => '?').join(',')})`;
    params.push(...anios);
  }
  
  const query = `
    SELECT 
      COALESCE(cat.descripcion, ord.descripcion, ge.D_CONCEPTO, CONCAT('Concepto ', agg.C_CONCEPTO, ' (sin catálogo)')) AS CONCEPTO,
      SUM(agg.TOTAL_ATENCIONES) AS \`Total de Atenciones\`
    FROM AGG_INDICADORES_CONCEPTO agg
    LEFT JOIN cat_conceptos cat ON (
      TRIM(cat.codigo) COLLATE utf8mb4_unicode_ci = TRIM(agg.C_CONCEPTO) COLLATE utf8mb4_unicode_ci
      OR TRIM(LEADING '0' FROM TRIM(cat.codigo)) COLLATE utf8mb4_unicode_ci = TRIM(LEADING '0' FROM TRIM(agg.C_CONCEPTO)) COLLATE utf8mb4_unicode_ci
    )
    LEFT JOIN cat_concepto_ordenado ord ON (
      TRIM(ord.codigo) COLLATE utf8mb4_unicode_ci = TRIM(agg.C_CONCEPTO) COLLATE utf8mb4_unicode_ci
      OR TRIM(LEADING '0' FROM TRIM(ord.codigo)) COLLATE utf8mb4_unicode_ci = TRIM(LEADING '0' FROM TRIM(agg.C_CONCEPTO)) COLLATE utf8mb4_unicode_ci
    )
    LEFT JOIN (
      SELECT
        TRIM(LEADING '0' FROM TRIM(C_CONCEPTO)) AS codigo_normalizado,
        MAX(D_CONCEPTO) AS D_CONCEPTO
      FROM AT2_BDR_CONCEPTOS_GE
      GROUP BY TRIM(LEADING '0' FROM TRIM(C_CONCEPTO))
    ) ge ON ge.codigo_normalizado COLLATE utf8mb4_unicode_ci = TRIM(LEADING '0' FROM TRIM(agg.C_CONCEPTO)) COLLATE utf8mb4_unicode_ci
    ${whereClause.replace('C_REGION', 'agg.C_REGION').replace('N_ANIO', 'agg.N_ANIO')}
    GROUP BY COALESCE(cat.descripcion, ord.descripcion, ge.D_CONCEPTO, CONCAT('Concepto ', agg.C_CONCEPTO, ' (sin catálogo)')), agg.C_CONCEPTO
    ORDER BY SUM(agg.TOTAL_ATENCIONES) DESC
    LIMIT ?
  `;
  
  params.push(limite);
  
  const pool = tomarPool();
  let datos: any[] = [];
  try {
    const [rows] = await pool.query<RowDataPacket[]>(query, params);
    datos = rows as any[];
  } catch (error: any) {
    // En algunos entornos la tabla AGG_* no existe; degradar al flujo normal sin romper la API.
    if (error?.code === "ER_NO_SUCH_TABLE") {
      return null;
    }
    throw error;
  }
  
  // Calcular total general
  const totalGeneral = datos.reduce((sum: number, row: any) => sum + (row['Total de Atenciones'] || 0), 0);
  
  return {
    datos: limpiarFilasSalida(datos),
    metadata: {
      dimensionesSeleccionadas: ['CONCEPTO'],
      dimensionesFilas: ['CONCEPTO'],
      dimensionesColumnas: [],
      medidasSeleccionadas: ['TOTAL']
    },
    aniosConsultados: anios as number[],
    totalGeneral: { 'Total de Atenciones': totalGeneral }
  };
}

// Genera una clave de caché única para una consulta pivot
const generarClaveCachePivot = (payload: PivotQueryPayload): string => {
  // Usar years si está definido, sino year, sino 'all'
  const aniosKey = payload.years?.length 
    ? `ys:${payload.years.sort((a,b) => a-b).join(',')}` 
    : `y:${payload.year ?? 'all'}`;
  
  const partes = [
    aniosKey,
    `r:${(payload.rows ?? []).sort().join(',')}`,
    `c:${(payload.columns ?? []).sort().join(',')}`,
    `v:${(payload.values ?? []).map(v => `${v.field}:${v.aggregation ?? 'default'}`).sort().join(',')}`,
    `f:${(payload.filters ?? []).map(f => `${f.field}:${(f.values ?? []).sort().join('|')}`).sort().join(',')}`,
    `l:${payload.limit ?? 'default'}`,
    `t:${payload.includeTotals ?? false}`
  ];
  return `pivot:query:${partes.join(':')}`;
};

export async function ejecutarConsultaPivot(payload: PivotQueryPayload): Promise<PivotQueryResult> {
  const claveCache = generarClaveCachePivot(payload);
  return cache.getOrSet(
    claveCache,
    async () => {
      const resultadoAgregado = await ejecutarConsultaAgregada(payload);
      if (resultadoAgregado) {
        return resultadoAgregado;
      }

      const filas = payload.rows ?? [];
      const columnas = payload.columns ?? [];
      const valoresSolicitud = payload.values ?? [];
      const dimensionesSolicitadas = [...filas, ...columnas];
      const incluirClaveMunicipio = dimensionesSolicitadas.includes("MUNICIPIO");

      const { selects, groupBy, joins, orderBy } = construirSelectDimensiones(dimensionesSolicitadas);
      if (incluirClaveMunicipio) {
        selects.push("CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO) AS municipio_codigo");
        joins.add("us");
      }
      if (!selects.length && !valoresSolicitud.length) {
        return {
          datos: [],
          metadata: {
            dimensionesSeleccionadas: dimensionesSolicitadas,
            dimensionesFilas: filas,
            dimensionesColumnas: columnas,
            medidasSeleccionadas: []
          },
          aniosConsultados: [],
          totalGeneral: null
        };
      }

      const joinsFiltros = agregarJoinsDeFiltros(payload.filters ?? []);
      joinsFiltros.forEach((join) => joins.add(join));

      const medidas = construirSeleccionMedidas(valoresSolicitud);
      const condiciones: string[] = [];
      const parametros: Array<string | number> = [];
      const setDimensiones = new Set<string>(dimensionesSolicitadas);

      aplicarFiltros(payload.filters, setDimensiones, condiciones, parametros);

      const aniosFiltro = obtenerYearsDesdeFiltros(payload.filters);
      const periodos = await obtenerPeriodosDisponibles();
      let aniosDisponibles = periodos.map((p) => p.anio).sort((a, b) => a - b);

      if (!aniosDisponibles.length) {
        aniosDisponibles = await obtenerTablasDetalleDisponibles();
      }

      const anioReciente = aniosDisponibles.length ? Math.max(...aniosDisponibles) : 2025;
      let aniosConsulta: number[] = [];

      if (payload.years !== undefined && payload.years.length > 0) {
        const aniosValidos = payload.years.filter(a => aniosDisponibles.includes(a));
        if (aniosValidos.length === 0) {
          throw new Error("Ninguno de los años solicitados está disponible en la base de datos");
        }
        aniosConsulta = aniosValidos.sort((a, b) => a - b);
      } else if (payload.year !== undefined) {
        if (!aniosDisponibles.includes(payload.year)) {
          throw new Error(`El año ${payload.year} no está disponible en la base de datos`);
        }
        aniosConsulta = [payload.year];
      } else if (aniosFiltro.length) {
        aniosConsulta = Array.from(new Set(aniosFiltro.filter((anio) => aniosDisponibles.includes(anio)))).sort(
          (a, b) => a - b
        );
        if (!aniosConsulta.length) {
          throw new Error("Los años solicitados por filtro no están disponibles en la base de datos");
        }
      } else if (aniosDisponibles.length) {
        aniosConsulta = [anioReciente];
      } else {
        aniosConsulta = [2025];
      }

      const fromDetalle = `${TABLA_DETALLE} det`;
      const anioPlaceholders = aniosConsulta.map(() => "?").join(", ");
      condiciones.unshift(`det.N_ANIO IN (${anioPlaceholders})`);
      parametros.unshift(...aniosConsulta);

      const joinsSql = asegurarJoins(joins);
      const whereClause = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
      const groupByClause = groupBy.length ? `GROUP BY ${groupBy.join(", ")}` : "";
      const orderByClause = orderBy.length ? `ORDER BY ${orderBy.join(", ")}` : "";

      const tieneColumnasPivot = columnas.length > 0;
      const defaultLimit = tieneColumnasPivot ? DEFAULT_LIMIT_PIVOT : DEFAULT_LIMIT;
      const limit = Math.min(payload.limit ?? defaultLimit, MAX_LIMIT);

      console.log(`[Pivot] Consultando ${aniosConsulta.length} año(s): ${aniosConsulta.join(', ')} | Límite: ${limit} filas`);

      const selectClause = [
        ...selects,
        ...medidas.map((medida) => medida.expresion)
      ].join(",\n  ");

      let sql = `SELECT\n  ${selectClause}\nFROM ${fromDetalle}\n${joinsSql ? joinsSql + "\n" : ""}${whereClause}\n${groupByClause}\n${orderByClause}`;
      if (groupBy.length) {
        sql += `\nLIMIT ${limit}`;
      }

      const pool = tomarPool();
      const [rows] = await pool.query<RowDataPacket[]>(sql, parametros);
      let totalGeneral: Record<string, unknown> | null = null;

      if (payload.includeTotals && medidas.length) {
        const totalSelect = medidas
          .map((medida) => `${medida.expresionSinAlias} AS ${medida.alias}`)
          .join(", ");
        const totalSql = `SELECT ${totalSelect} FROM ${fromDetalle}\n${joinsSql ? joinsSql + "\n" : ""}${whereClause}`;
        const [totalRows] = await pool.query<RowDataPacket[]>(totalSql, parametros);

        if (totalRows[0]) {
          const totalNormalizado: Record<string, unknown> = {};
          medidas.forEach(medida => {
            if (totalRows[0][medida.alias] !== undefined) {
              totalNormalizado[medida.etiqueta] = totalRows[0][medida.alias];
            }
          });
          totalGeneral = totalNormalizado;
        }
      }

      let datosTransformados: Array<Record<string, unknown>> = rows.map((row: RowDataPacket) => ({ ...row }));

      const datosNormalizados = rows.map((row: RowDataPacket) => {
        const objeto: Record<string, unknown> = { ...row };

        dimensionesSolicitadas.forEach(dimId => {
          const dimension = DIMENSIONES[dimId];
          if (dimension && objeto[dimension.alias] !== undefined) {
            objeto[dimId] = objeto[dimension.alias];
            delete objeto[dimension.alias];
          }
        });

        medidas.forEach(medida => {
          if (objeto[medida.alias] !== undefined) {
            objeto[medida.etiqueta] = objeto[medida.alias];
            delete objeto[medida.alias];
          }
        });

        if (incluirClaveMunicipio && objeto.municipio_codigo !== undefined) {
          objeto.MUNICIPIO_CODIGO = objeto.municipio_codigo;
          delete objeto.municipio_codigo;
        }

        return objeto;
      });

      let totalesPivotados: unknown[] = [];

      if (columnas.length > 0) {
        const pivotResult = transformarDatosPivot(
          datosNormalizados,
          filas,
          columnas,
          medidas
        );

        datosTransformados = pivotResult.filas.map((fila) => {
          const objeto: Record<string, unknown> = {};
          pivotResult.cabeceras.forEach((cabecera, colIndex) => {
            objeto[cabecera] = fila[colIndex];
          });
          return objeto;
        });

        totalesPivotados = pivotResult.totales;
      } else {
        datosTransformados = datosNormalizados;
      }

      const totalGeneralFinal = columnas.length > 0 && totalesPivotados.length > 0
        ? (() => {
            const objeto: Record<string, unknown> = {};
            if (datosTransformados.length > 0) {
              const cabeceras = Object.keys(datosTransformados[0]);
              cabeceras.forEach((cabecera, index) => {
                objeto[cabecera] = totalesPivotados[index] ?? null;
              });
            }
            return objeto;
          })()
        : totalGeneral;

      return {
        datos: limpiarFilasSalida(datosTransformados),
        totalGeneral: totalGeneralFinal ? limpiarFilaSalida(totalGeneralFinal) : null,
        aniosConsultados: aniosConsulta,
        metadata: {
          dimensionesSeleccionadas: dimensionesSolicitadas,
          dimensionesFilas: payload.rows ?? [],
          dimensionesColumnas: payload.columns ?? [],
          medidasSeleccionadas: valoresSolicitud.map((valor) => valor.field)
        }
      };
    },
    CACHE_TTL.CONSULTA_PIVOT
  );
};
