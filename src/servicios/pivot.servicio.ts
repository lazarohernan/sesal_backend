import type { RowDataPacket } from "mysql2";
import type { Pool } from "mysql2/promise";

import { obtenerPoolActual } from "../base_datos/pool";

const tomarPool = () => obtenerPoolActual();

const DETALLE_PREFIX = "AT2_BDT_MENSUAL_DETALLE_";

type JoinKey =
  | "us"
  | "cat_concepto"
  | "cat_concepto_ordenado"
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

const JOIN_DEFINITIONS: Record<JoinKey, string> = {
  us: "LEFT JOIN BAS_BDR_US us ON us.C_US = det.C_US",
  cat_concepto:
    "LEFT JOIN cat_conceptos cat_concepto ON cat_concepto.codigo COLLATE utf8mb4_unicode_ci = det.C_CONCEPTO COLLATE utf8mb4_unicode_ci",
  cat_concepto_ordenado:
    "LEFT JOIN cat_concepto_ordenado cat_concepto_ordenado ON cat_concepto_ordenado.codigo COLLATE utf8mb4_unicode_ci = det.C_CONCEPTO COLLATE utf8mb4_unicode_ci",
  cat_establecimiento:
    "LEFT JOIN cat_establecimientos cat_establecimiento ON cat_establecimiento.codigo COLLATE utf8mb4_unicode_ci = CAST(det.C_US AS CHAR) COLLATE utf8mb4_unicode_ci",
  cat_region:
    "LEFT JOIN cat_regiones cat_region ON cat_region.codigo COLLATE utf8mb4_unicode_ci = CAST(us.C_REGION AS CHAR) COLLATE utf8mb4_unicode_ci",
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
    "LEFT JOIN AT2_BDR_CONCEPTOS_GE concepto_ge ON concepto_ge.C_CONCEPTO = det.C_CONCEPTO AND concepto_ge.V_FORMULARIO = det.V_FORMULARIO"
};

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
    select: "COALESCE(cat_concepto.descripcion, det.C_CONCEPTO)",
    groupBy: "COALESCE(cat_concepto.descripcion, det.C_CONCEPTO)",
    valueExpr: "det.C_CONCEPTO",
    joins: ["cat_concepto"],
    orderBy: "COALESCE(cat_concepto.descripcion, det.C_CONCEPTO)",
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
    select: "COALESCE(cat_concepto_ordenado.descripcion, det.C_CONCEPTO)",
    groupBy: "cat_concepto_ordenado.codigo, cat_concepto_ordenado.descripcion, det.C_CONCEPTO",
    valueExpr: "det.C_CONCEPTO",
    joins: ["cat_concepto_ordenado"],
    orderBy: "LPAD(cat_concepto_ordenado.codigo, 2, '0')",
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
    select: "COALESCE(cat_establecimiento.nombre, det.C_US)",
    groupBy: "COALESCE(cat_establecimiento.nombre, det.C_US)",
    valueExpr: "det.C_US",
    joins: ["cat_establecimiento"],
    orderBy: "COALESCE(cat_establecimiento.nombre, det.C_US)",
    catalog: {
      table: "cat_establecimientos",
      valueColumn: "codigo",
      labelColumn: "nombre",
      orderBy: "nombre",
      preload: false,
      defaultLimit: 2000  // Aumentado para incluir todos los establecimientos (hay ~1753)
    }
  },
  REGION: {
    id: "REGION",
    label: "Región",
    alias: "region",
    type: "string",
    select: "COALESCE(cat_region.descripcion, CAST(us.C_REGION AS CHAR))",
    groupBy: "COALESCE(cat_region.descripcion, CAST(us.C_REGION AS CHAR))",
    valueExpr: "us.C_REGION",
    joins: ["us", "cat_region"],
    orderBy: "COALESCE(cat_region.descripcion, CAST(us.C_REGION AS CHAR))",
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
    select: "COALESCE(municipios.D_MUNICIPIO, CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO))",
    groupBy: "COALESCE(municipios.D_MUNICIPIO, CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO))",
    valueExpr: "CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO)",
    joins: ["us", "municipios"],
    orderBy: "COALESCE(municipios.D_MUNICIPIO, CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO))",
    catalog: {
      table: "BAS_BDR_MUNICIPIOS",
      valueColumn: "CONCAT(C_DEPARTAMENTO, '-', C_MUNICIPIO)",
      labelColumn: "D_MUNICIPIO",
      orderBy: "C_DEPARTAMENTO, C_MUNICIPIO",
      preload: false,
      defaultLimit: 100
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

// Límite por defecto reducido para evitar sobrecarga
// En producción, consultas grandes deben usar límites explícitos
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10000; // Máximo absoluto para prevenir consultas excesivamente grandes

const obtenerTablasDetalleDisponibles = async (): Promise<number[]> => {
  const pool = tomarPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE '${DETALLE_PREFIX}%'`
  );
  return rows
    .map((row) => {
      const tableName = String(row.TABLE_NAME ?? "");
      const yearPart = tableName.replace(DETALLE_PREFIX, "");
      const year = Number.parseInt(yearPart, 10);
      return Number.isFinite(year) ? year : undefined;
    })
    .filter((year): year is number => typeof year === "number")
    .sort((a, b) => a - b);
};

const asegurarJoins = (joinsNecesarios: Set<JoinKey>): string => {
  return Array.from(joinsNecesarios)
    .map((clave) => JOIN_DEFINITIONS[clave])
    .filter(Boolean)
    .join("\n");
};

const obtenerPeriodosDisponibles = async (): Promise<Array<{ anio: number; meses: number[] }>> => {
  const pool = tomarPool();

  const [filas] = await pool.query<RowDataPacket[]>(
    `SELECT
        CAST(RIGHT(TABLE_NAME, 4) AS UNSIGNED) AS anio,
        MAX(CASE WHEN TABLE_ROWS > 0 THEN 1 ELSE 0 END) AS tieneDatos
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME LIKE 'AT2_BDT_MENSUAL_DETALLE_%'
     GROUP BY anio
     HAVING anio IS NOT NULL
     ORDER BY anio DESC`
  );

  const periodos: Array<{ anio: number; meses: number[] }> = [];

  for (const fila of filas) {
    const anio = Number(fila.anio);
    if (!Number.isFinite(anio)) continue;

    periodos.push({
      anio,
      meses: [] // No consultamos meses para agilizar la carga del catálogo
    });
  }

  return periodos;
};

export const obtenerCatalogoPivot = async (): Promise<PivotCatalogo> => {
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
};

export const obtenerAniosDisponibles = async (): Promise<number[]> => {
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
};

export const obtenerValoresDimension = async (
  dimensionId: string,
  busqueda?: string,
  limite?: number,
  filtroRegion?: string,
  filtroMunicipio?: string
): Promise<Array<{ valor: string | number; etiqueta: string }>> => {
  // Si no se especifica límite, usar el defaultLimit de la dimensión o 2000 para ESTABLECIMIENTO
  const dimension = DIMENSIONES[dimensionId];
  if (!dimension || !dimension.catalog) {
    throw new Error("La dimensión indicada no permite carga dinámica de valores");
  }
  
  const limiteFinal = limite ?? (dimensionId === "ESTABLECIMIENTO" ? 2000 : (dimension.catalog.defaultLimit ?? 200));
  const pool = tomarPool();

  // Caso especial: MUNICIPIO con filtro de región
  if (dimensionId === "MUNICIPIO" && filtroRegion) {
    return await obtenerMunicipiosPorRegion(pool, filtroRegion, busqueda, limiteFinal);
  }

  // Caso especial: ESTABLECIMIENTO con filtros
  if (dimensionId === "ESTABLECIMIENTO") {
    // Prioridad: Municipio > Región > Sin filtro
    if (filtroMunicipio) {
      return await obtenerEstablecimientosPorMunicipio(pool, filtroMunicipio, busqueda, limiteFinal);
    } else if (filtroRegion) {
      return await obtenerEstablecimientosPorRegion(pool, filtroRegion, busqueda, limiteFinal);
    }
  }

  const tabla = dimension.catalog.table;
  const valueColumn = dimension.catalog.valueColumn;
  const labelColumn = dimension.catalog.labelColumn;
  const orderBy = dimension.catalog.orderBy ?? labelColumn;

  const condiciones: string[] = [];
  const parametros: Array<string | number> = [];

  if (busqueda) {
    // Para ESTABLECIMIENTO, buscar tanto en código como en nombre
    if (dimensionId === "ESTABLECIMIENTO") {
      // Si la búsqueda es solo números, buscar coincidencia exacta en código O coincidencia parcial en nombre
      const esSoloNumeros = /^\d+$/.test(busqueda.trim());
      if (esSoloNumeros) {
        // Búsqueda exacta en código O parcial en nombre
        condiciones.push(`(${valueColumn} = ? OR ${labelColumn} LIKE ?)`);
        parametros.push(busqueda.trim(), `%${busqueda}%`);
      } else {
        // Búsqueda parcial en ambos campos
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
};

// Función especial para obtener municipios filtrados por región
const obtenerMunicipiosPorRegion = async (
  pool: Pool,
  filtroRegion: string,
  busqueda?: string,
  limite?: number
): Promise<Array<{ valor: string | number; etiqueta: string }>> => {
  const condiciones: string[] = [];
  const parametros: Array<string | number> = [];

  // Filtrar por región
  condiciones.push("us.C_REGION = ?");
  parametros.push(filtroRegion);

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
  limite?: number
): Promise<Array<{ valor: string | number; etiqueta: string }>> => {
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
      COALESCE(cat.nombre, CAST(us.C_US AS CHAR)) AS etiqueta
    FROM cat_establecimientos cat
    INNER JOIN BAS_BDR_US us 
      ON cat.codigo COLLATE utf8mb4_unicode_ci = CAST(us.C_US AS CHAR) COLLATE utf8mb4_unicode_ci
    ${whereClause}
    ORDER BY etiqueta
    LIMIT ?
  `;
  parametros.push(limiteFinal);

  const [rows] = await pool.query<RowDataPacket[]>(sql, parametros);
  return rows.map((row: RowDataPacket) => ({ valor: row.valor, etiqueta: row.etiqueta }));
};

// Función especial para obtener establecimientos filtrados por región
const obtenerEstablecimientosPorRegion = async (
  pool: Pool,
  filtroRegion: string,
  busqueda?: string,
  limite?: number
): Promise<Array<{ valor: string | number; etiqueta: string }>> => {
  const condiciones: string[] = [];
  const parametros: Array<string | number> = [];

  // Filtrar por región
  condiciones.push("us.C_REGION = ?");
  parametros.push(filtroRegion);

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
      COALESCE(cat.nombre, CAST(us.C_US AS CHAR)) AS etiqueta
    FROM cat_establecimientos cat
    INNER JOIN BAS_BDR_US us 
      ON cat.codigo COLLATE utf8mb4_unicode_ci = CAST(us.C_US AS CHAR) COLLATE utf8mb4_unicode_ci
    ${whereClause}
    ORDER BY etiqueta
    LIMIT ?
  `;
  parametros.push(limiteFinal);

  const [rows] = await pool.query<RowDataPacket[]>(sql, parametros);
  return rows.map((row: RowDataPacket) => ({ valor: row.valor, etiqueta: row.etiqueta }));
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

const construirUnionAnios = (anios: number[]): string => {
  const partes = anios
    .map((anio) => `${DETALLE_PREFIX}${anio}`)
    .map((tabla) => `SELECT * FROM ${tabla}`);
  return `(${partes.join(" UNION ALL ")}) det`;
};

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

    // Caso especial: ESTABLECIMIENTO usa det.C_US que es INT, pero los valores vienen como strings
    // Necesitamos convertir a números para la comparación
    if (filtro.field === "ESTABLECIMIENTO") {
      const valoresNumericos = valores.map((valor) => {
        const numero = typeof valor === "number" ? valor : Number.parseInt(String(valor), 10);
        return Number.isFinite(numero) ? numero : null;
      }).filter((valor): valor is number => valor !== null);
      
      if (valoresNumericos.length > 0) {
        const placeholders = valoresNumericos.map(() => "?").join(", ");
        condiciones.push(`${dimension.valueExpr} IN (${placeholders})`);
        parametros.push(...valoresNumericos);
        dimensionesSeleccionadas.add(dimension.id);
      }
    } else {
      const placeholders = valores.map(() => "?").join(", ");
      condiciones.push(`${dimension.valueExpr} IN (${placeholders})`);
      parametros.push(...valores);
      dimensionesSeleccionadas.add(dimension.id);
    }
  }
};

const obtenerYearsDesdeFiltros = (filtros?: PivotFilter[]): number[] => {
  if (!filtros) return [];
  const filtroAnio = filtros.find((filtro) => filtro.field === "ANIO");
  if (!filtroAnio) return [];
  const valores = normalizarValoresFiltro(DIMENSIONES.ANIO, filtroAnio.values);
  return valores.map((valor) => Number(valor)).filter((valor) => Number.isFinite(valor));
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
  
  datos.forEach(fila => {
    // Crear clave única para la fila basada en dimensiones de fila
    const claveFila = dimensionesFilas.map(dim => String(fila[dim] ?? '')).join('|');
    
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
          filaPivot[claveCelda] = typeof valorCrudo === "number" ? valorCrudo : 0;
        });
      }
    });
  });

  // Convertir mapa a array de filas preservando el orden original de los datos
  // Extraer el orden de las claves según aparecen en los datos originales
  const ordenClaves: string[] = [];
  const clavesVistas = new Set<string>();
  
  datos.forEach(fila => {
    const claveFila = dimensionesFilas.map(dim => String(fila[dim] ?? '')).join('|');
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
      COALESCE(cat.descripcion, agg.C_CONCEPTO) AS CONCEPTO,
      SUM(agg.TOTAL_ATENCIONES) AS \`Total de Atenciones\`
    FROM AGG_INDICADORES_CONCEPTO agg
    LEFT JOIN cat_conceptos cat ON cat.codigo COLLATE utf8mb4_unicode_ci = agg.C_CONCEPTO COLLATE utf8mb4_unicode_ci
    ${whereClause.replace('C_REGION', 'agg.C_REGION').replace('N_ANIO', 'agg.N_ANIO')}
    GROUP BY cat.descripcion, agg.C_CONCEPTO
    ORDER BY SUM(agg.TOTAL_ATENCIONES) DESC
    LIMIT ?
  `;
  
  params.push(limite);
  
  const pool = tomarPool();
  const [rows] = await pool.query<RowDataPacket[]>(query, params);
  const datos = rows as any[];
  
  // Calcular total general
  const totalGeneral = datos.reduce((sum: number, row: any) => sum + (row['Total de Atenciones'] || 0), 0);
  
  return {
    datos,
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

export async function ejecutarConsultaPivot(payload: PivotQueryPayload): Promise<PivotQueryResult> {
  // Intentar usar tabla de agregación optimizada primero
  const resultadoAgregado = await ejecutarConsultaAgregada(payload);
  if (resultadoAgregado) {
    return resultadoAgregado;
  }
  
  // Si no se puede usar agregación, usar método normal
  const filas = payload.rows ?? [];
  const columnas = payload.columns ?? [];
  const valoresSolicitud = payload.values ?? [];
  const limite = payload.limit ?? 1000;
  const dimensionesSolicitadas = [...filas, ...columnas];

  const { selects, groupBy, joins, orderBy } = construirSelectDimensiones(dimensionesSolicitadas);
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

  if (payload.year !== undefined) {
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

  const anioConsulta = aniosConsulta[0];

  const fromUnion = construirUnionAnios(aniosConsulta);
  const joinsSql = asegurarJoins(joins);
  const whereClause = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const groupByClause = groupBy.length ? `GROUP BY ${groupBy.join(", ")}` : "";
  const orderByClause = orderBy.length ? `ORDER BY ${orderBy.join(", ")}` : "";
  const limit = Math.min(payload.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const selectClause = [
    ...selects,
    ...medidas.map((medida) => medida.expresion)
  ].join(",\n  ");

  let sql = `SELECT\n  ${selectClause}\nFROM ${fromUnion}\n${joinsSql ? joinsSql + "\n" : ""}${whereClause}\n${groupByClause}\n${orderByClause}`;
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
    const totalSql = `SELECT ${totalSelect} FROM ${fromUnion}\n${joinsSql ? joinsSql + "\n" : ""}${whereClause}`;
    const [totalRows] = await pool.query<RowDataPacket[]>(totalSql, parametros);
    
    // Convertir aliases de medidas a etiquetas legibles
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

  // Transformar datos a estructura pivotada si hay dimensiones de columna
  let datosTransformados: Array<Record<string, unknown>> = rows.map((row: RowDataPacket) => ({ ...row }));
  
  // Primero, normalizar los datos para usar IDs de dimensiones y etiquetas de medidas
  const datosNormalizados = rows.map((row: RowDataPacket) => {
    const objeto: Record<string, unknown> = { ...row };
    
    // Reemplazar aliases con IDs de dimensiones
    dimensionesSolicitadas.forEach(dimId => {
      const dimension = DIMENSIONES[dimId];
      if (dimension && objeto[dimension.alias] !== undefined) {
        objeto[dimId] = objeto[dimension.alias];
        delete objeto[dimension.alias];
      }
    });
    
    // Reemplazar aliases de medidas con etiquetas legibles
    medidas.forEach(medida => {
      if (objeto[medida.alias] !== undefined) {
        objeto[medida.etiqueta] = objeto[medida.alias];
        delete objeto[medida.alias];
      }
    });
    
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
    
    // Convertir estructura pivotada a formato compatible con el frontend
    datosTransformados = pivotResult.filas.map((fila, index) => {
      const objeto: Record<string, unknown> = {};
      pivotResult.cabeceras.forEach((cabecera, colIndex) => {
        objeto[cabecera] = fila[colIndex];
      });
      return objeto;
    });
    
    // Guardar totales pivotados para usar en lugar de totalGeneral
    totalesPivotados = pivotResult.totales;
  } else {
    // Para consultas sin columnas, usar datos normalizados
    datosTransformados = datosNormalizados;
  }

  // Usar totales pivotados si hay columnas, sino usar totalGeneral
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
    datos: datosTransformados,
    totalGeneral: totalGeneralFinal,
    aniosConsultados: aniosConsulta,
    metadata: {
      dimensionesSeleccionadas: dimensionesSolicitadas,
      dimensionesFilas: payload.rows ?? [],
      dimensionesColumnas: payload.columns ?? [],
      medidasSeleccionadas: valoresSolicitud.map((valor) => valor.field)
    }
  };
};
