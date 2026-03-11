import type { RowDataPacket } from "mysql2";
import { obtenerPoolActual } from "../base_datos/pool";

const tomarPool = () => obtenerPoolActual();

// ── Dimensiones para AT2_DETALLE ────────────────────────────────────

interface DimensionDef {
  id: string;
  label: string;
  column: string;
  type: "string" | "number";
}

interface MeasureDef {
  id: string;
  label: string;
  expression: string;
}

const DIMENSIONES: DimensionDef[] = [
  { id: "REGION", label: "Región", column: "region", type: "number" },
  { id: "MES", label: "Mes", column: "mes", type: "number" },
  { id: "CONCEPTO", label: "Concepto", column: "concepto", type: "number" },
];

const MEDIDAS: MeasureDef[] = [
  { id: "TOTAL", label: "Total de Atenciones", expression: "SUM(enfermera_aux + enfermera_pro + medico_gen + medico_esp)" },
  { id: "ENFERMERA_AUX", label: "Enfermera Auxiliar", expression: "SUM(enfermera_aux)" },
  { id: "ENFERMERA_PRO", label: "Enfermera Profesional", expression: "SUM(enfermera_pro)" },
  { id: "MEDICO_GEN", label: "Médico General", expression: "SUM(medico_gen)" },
  { id: "MEDICO_ESP", label: "Médico Especialista", expression: "SUM(medico_esp)" },
];

const REGIONES_LABELS: Record<number, string> = {
  1: "Departamental de Atlántida",
  2: "Departamental de Colón",
  3: "Departamental de Comayagua",
  4: "Departamental de Copán",
  5: "Departamental de Cortés",
  6: "Departamental de Choluteca",
  7: "Departamental de El Paraíso",
  8: "Departamental de Francisco Morazán",
  9: "Departamental de Gracias a Dios",
  10: "Departamental de Intibucá",
  11: "Departamental de Islas de la Bahía",
  12: "Departamental de La Paz",
  13: "Departamental de Lempira",
  14: "Departamental de Ocotepeque",
  15: "Departamental de Olancho",
  16: "Departamental de Santa Bárbara",
  17: "Departamental de Valle",
  18: "Departamental de Yoro",
  19: "Metropolitana del Distrito Central",
  20: "Metropolitana de San Pedro Sula",
};

const MESES_LABELS: Record<number, string> = {
  1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril",
  5: "Mayo", 6: "Junio", 7: "Julio", 8: "Agosto",
  9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre",
};

const CONCEPTOS_LABELS: Record<number, string> = {
  1: "Menores de 1 Mes 1a. Vez",
  2: "Menores de 1 Mes Subsiguiente",
  3: "1 Mes a 1 Año 1a. Vez",
  4: "1 Mes a 1 Año Subsiguiente",
  5: "1 - 4 Años 1a. Vez",
  6: "1 - 4 Años Subsiguiente",
  7: "5 - 9 Años 1a. Vez",
  8: "5 - 9 Años Subsiguiente",
  9: "10 - 14 Años 1a. Vez",
  10: "10 - 14 Años Subsiguiente",
  11: "15 - 19 Años 1a. Vez",
  12: "15 - 19 Años Subsiguiente",
  13: "20 - 49 Años 1a. Vez",
  14: "20 - 49 Años Subsiguiente",
  15: "50 - 59 Años 1a. Vez",
  16: "50 - 59 Años Subsiguiente",
  17: "60 y + Años 1a. Vez",
  18: "60 y + Años Subsiguiente",
  19: "Total Pacientes Atendidos",
  20: "Número de Atenciones de Mujeres",
  21: "Número de Atenciones de Hombres",
  22: "Número de Atenciones Espontáneas",
  23: "Número de Atenciones Referidas",
  24: "Atenciones del Recién Nacido Control Temprano <5 días",
  25: "Menores de 5 años con Diarrea",
  26: "Menores de 5 años con Diarrea en Seguimiento",
  27: "Menores de 5 años con Deshidratación Rehidratados",
  28: "Menores de 5 años con Neumonía nuevos",
  29: "Menores de 5 años con Neumonía en Seguimiento",
  30: "Menores de 5 años con Síndrome Anémico",
  31: "Menores de 5 años con crecimiento adecuado",
  32: "Menores de 5 años sin desnutrición crónica",
  33: "Menores de 5 años con baja talla y baja talla severa",
  34: "Menores de 5 años sin desnutrición aguda ni sobrepeso",
  35: "Menores de 5 años emaciados y severamente emaciados",
  36: "Menores de 5 años con sobrepeso y obesidad",
  37: "Menores de 5 años con crecimiento inadecuado persistente",
  38: "Menores de 5 años con Discapacidad Nuevos",
  39: "Menores de 5 años con Probable Alteración del Desarrollo",
  40: "Total de menores de 5 años Atendidos",
  41: "Anticonceptivo Oral Combinado",
  42: "Anticonceptivos Orales con Progestina sola",
  43: "Inyectables trimestral",
  44: "Autoinyectables trimestral",
  45: "DIU con cobre insertados",
  46: "DIU con levonorgestrel insertados",
  47: "Implante con levonorgestrel 5 años",
  48: "Implante con Etonogestrel 3 años",
  49: "Retiro de implante",
  50: "Retiro de DIU",
  51: "Detección de Cáncer Cérvico Uterino",
  52: "Consejerías de planificación familiar",
  53: "AQV Ambulatoria Mujeres",
  54: "AQV Ambulatoria Hombres",
  55: "PAE brindado",
  56: "Entrega de condones",
  57: "Atención por aborto ambulatorio",
  58: "Atención Prenatal Nueva 10-19 años",
  59: "Atención Prenatal Nueva ≤12 Semanas",
  60: "Atención Prenatal Nueva >12 Semanas",
  61: "Atenciones prenatales subsiguientes",
  62: "Atenciones puerperales 3-7 días",
  63: "Atenciones puerperales >7 días",
  64: "Total de Controles Puerperales",
  65: "Atenciones por Violencia Sexual",
  66: "Atención adolescentes 10-19 años mujeres",
  67: "Atención adolescentes 10-19 años varones",
  68: "Detección Casos presuntivos de Tuberculosis",
  69: "Diabetes Mellitus Nuevas",
  70: "Diabetes Mellitus Subsiguientes",
  71: "HTA Nuevas",
  72: "HTA Subsiguientes",
  73: "Enfermedad Renal Crónica Nuevas",
  74: "Enfermedad Renal Crónica Subsiguientes",
  75: "Cáncer Cérvico Uterino Nuevas",
  76: "Cáncer Cérvico Uterino Subsiguientes",
  77: "Cáncer Priorizados Nuevas",
  78: "Cáncer Priorizados Subsiguientes",
  79: "Atenciones psicología-psiquiatría",
  80: "Atenciones a Migrantes Irregulares",
  81: "Atenciones a Migrantes hondureños retornados",
  82: "Maya Chortí",
  83: "Lenca",
  84: "Misquito",
  85: "Nahua",
  86: "Pech (Paya)",
  87: "Tolupán",
  88: "Tawaka (Sumo)",
  89: "Garífuna",
  90: "Negro Inglés",
  91: "Otro",
  92: "No Sabe / Ninguno",
};

// ── Catálogo ──────────────────────────────────────────────────────────────

export const obtenerCatalogoEgresos = () => {
  return {
    dimensiones: DIMENSIONES.map(d => ({
      id: d.id,
      etiqueta: d.label,
      tipo: d.type,
      admiteFiltrado: true,
      endpointValores: `/api/egresos-pivot/dimensiones/${d.id}/valores`,
    })),
    medidas: MEDIDAS.map(m => ({
      id: m.id,
      etiqueta: m.label,
      descripcion: m.label,
      tipoValor: "number" as const,
      agregacionDefault: "SUM" as const,
    })),
    aniosDisponibles: [2026],
  };
};

// ── Valores de dimensión ──────────────────────────────────────────────────

export const obtenerValoresDimensionEgresos = async (
  dimensionId: string,
  busqueda?: string,
  limite?: number
): Promise<Array<{ valor: number; etiqueta: string }>> => {
  const dim = DIMENSIONES.find(d => d.id === dimensionId);
  if (!dim) return [];

  if (dimensionId === "REGION") {
    let valores = Object.entries(REGIONES_LABELS).map(([k, v]) => ({
      valor: Number(k),
      etiqueta: `${k}. ${v}`,
    }));
    if (busqueda) {
      const b = busqueda.toLowerCase();
      valores = valores.filter(v => v.etiqueta.toLowerCase().includes(b));
    }
    return valores;
  }

  if (dimensionId === "MES") {
    let valores = Object.entries(MESES_LABELS).map(([k, v]) => ({
      valor: Number(k),
      etiqueta: v,
    }));
    if (busqueda) {
      const b = busqueda.toLowerCase();
      valores = valores.filter(v => v.etiqueta.toLowerCase().includes(b));
    }
    return valores;
  }

  if (dimensionId === "CONCEPTO") {
    const pool = tomarPool();
    let sql = `SELECT DISTINCT concepto as valor FROM AT2_DETALLE ORDER BY concepto`;
    if (limite) sql += ` LIMIT ${Math.min(limite, 200)}`;
    const [rows] = await pool.query<RowDataPacket[]>(sql);
    let valores = rows.map(r => {
      const num = r.valor as number;
      return {
        valor: num,
        etiqueta: CONCEPTOS_LABELS[num] ?? `Concepto ${num}`,
      };
    });
    if (busqueda) {
      const b = busqueda.toLowerCase();
      valores = valores.filter(v => v.etiqueta.toLowerCase().includes(b));
    }
    return valores;
  }

  return [];
};

// ── Consulta pivot ────────────────────────────────────────────────────────

export interface EgresosPivotPayload {
  filters?: Array<{ field: string; values?: Array<string | number> }>;
  rows?: string[];
  columns?: string[];
  values: Array<{ field: string; aggregation?: string }>;
  limit?: number;
}

export const ejecutarConsultaEgresos = async (
  payload: EgresosPivotPayload
): Promise<{
  datos: Array<Record<string, unknown>>;
  metadata: {
    dimensionesFilas: string[];
    dimensionesColumnas: string[];
    medidasSeleccionadas: string[];
  };
}> => {
  const pool = tomarPool();

  // Resolver dimensiones de filas y columnas
  const filaDims = (payload.rows ?? [])
    .map(id => DIMENSIONES.find(d => d.id === id))
    .filter((d): d is DimensionDef => d !== undefined);

  const colDims = (payload.columns ?? [])
    .map(id => DIMENSIONES.find(d => d.id === id))
    .filter((d): d is DimensionDef => d !== undefined);

  const allDims = [...filaDims, ...colDims];

  // Resolver medidas
  const medidasSel = payload.values
    .map(v => {
      const m = MEDIDAS.find(med => med.id === v.field);
      return m ? { ...m, agg: v.aggregation ?? "SUM" } : null;
    })
    .filter((m): m is MeasureDef & { agg: string } => m !== null);

  if (medidasSel.length === 0) {
    medidasSel.push({ ...MEDIDAS[0], agg: "SUM" });
  }

  // SELECT
  const selectParts: string[] = [];
  for (const dim of allDims) {
    selectParts.push(`${dim.column} AS \`${dim.label}\``);
  }
  for (const med of medidasSel) {
    selectParts.push(`${med.expression} AS \`${med.label}\``);
  }

  if (selectParts.length === 0) {
    for (const med of medidasSel) {
      selectParts.push(`${med.expression} AS \`${med.label}\``);
    }
  }

  // WHERE
  const whereParts: string[] = ["anio = 2026"];
  const whereParams: Array<string | number> = [];

  if (payload.filters) {
    for (const filter of payload.filters) {
      const dim = DIMENSIONES.find(d => d.id === filter.field);
      if (dim && filter.values && filter.values.length > 0) {
        const placeholders = filter.values.map(() => "?").join(",");
        whereParts.push(`${dim.column} IN (${placeholders})`);
        whereParams.push(...filter.values);
      }
    }
  }

  // GROUP BY
  const groupByParts = allDims.map(d => d.column);

  // ORDER BY
  const orderByParts = allDims.map(d => d.column);

  // BUILD SQL
  let sql = `SELECT ${selectParts.join(", ")} FROM AT2_DETALLE`;
  sql += ` WHERE ${whereParts.join(" AND ")}`;
  if (groupByParts.length > 0) {
    sql += ` GROUP BY ${groupByParts.join(", ")}`;
    sql += ` ORDER BY ${orderByParts.join(", ")}`;
  }

  const limit = Math.min(payload.limit ?? 5000, 10000);
  sql += ` LIMIT ${limit}`;

  const [rows] = await pool.query<RowDataPacket[]>(sql, whereParams);

  // Enriquecer con etiquetas
  const datos = (rows as Array<Record<string, unknown>>).map(row => {
    const enriched = { ...row };
    if ("Región" in enriched) {
      const regId = enriched["Región"] as number;
      enriched["Región"] = REGIONES_LABELS[regId]
        ? `${regId}. ${REGIONES_LABELS[regId]}`
        : `Región ${regId}`;
    }
    if ("Mes" in enriched) {
      const mesId = enriched["Mes"] as number;
      enriched["Mes"] = MESES_LABELS[mesId] ?? `Mes ${mesId}`;
    }
    if ("Concepto" in enriched) {
      const concId = enriched["Concepto"] as number;
      enriched["Concepto"] = CONCEPTOS_LABELS[concId] ?? `Concepto ${concId}`;
    }
    return enriched;
  });

  return {
    datos,
    metadata: {
      dimensionesFilas: filaDims.map(d => d.label),
      dimensionesColumnas: colDims.map(d => d.label),
      medidasSeleccionadas: medidasSel.map(m => m.label),
    },
  };
};

// ── Resumen para dashboard ────────────────────────────────────────────────

export const obtenerResumenEgresos = async () => {
  const pool = tomarPool();

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       region,
       SUM(enfermera_aux + enfermera_pro + medico_gen + medico_esp) as total,
       COUNT(DISTINCT mes) as meses_reportados,
       COUNT(DISTINCT concepto) as conceptos
     FROM AT2_DETALLE
     WHERE anio = 2026
     GROUP BY region
     ORDER BY region`
  );

  return rows;
};
