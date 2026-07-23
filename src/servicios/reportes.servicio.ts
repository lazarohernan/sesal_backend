import type { RowDataPacket } from "mysql2/promise";
import { obtenerPoolActual } from "../base_datos/pool";
import { cache, CACHE_TTL } from "../utilidades/cache.utilidad";
import {
  construirFuenteDetalleAt2,
  construirFuenteDetalleAt2TodosLosAnios
} from "./at2-detalle-fuente.servicio";
import { REGION_CODE_TO_NAME } from "../utilidades/alcance-regional.util";
import { seguimientoServicio, type EstadoSeguimiento } from "./seguimiento.servicio";
import { CODIGO_CONCEPTO_TOTAL_PACIENTES_ATENDIDOS } from "../utilidades/at2-reglas.util";
import { construirCatalogoAt2NuevoSql } from "../utilidades/at2-catalogo.util";

const TOTAL_ATENCIONES_EXPRESSION =
  "COALESCE(det.Q_AT_ENFERMERA_AUX, 0) + COALESCE(det.Q_AT_ENFERMERA_PRO, 0) + COALESCE(det.Q_AT_MEDICO_GEN, 0) + COALESCE(det.Q_AT_MEDICO_ESP, 0)";

export interface IndicadoresMunicipalesParams {
  anio?: number;
  departamentoId: number;
  limite: number;
  regionIds?: number[];
}

export interface IndicadoresMunicipalesTotales {
  totalConsultas: number;
  enfermeraAuxiliar: number;
  enfermeraProfesional: number;
  medicinaGeneral: number;
  medicosEspecialistas: number;
  totalUnidades: number;
}

export interface ResumenMaestroAt2Fila {
  numero: number;
  concepto: string;
  enfermeraAuxiliar: number;
  enfermeraProfesional: number;
  medicoGeneral: number;
  medicoEspecialista: number;
  total: number;
}

export interface ResumenMaestroAt2Resultado {
  nivel: string;
  anio: number;
  mesInicio: number;
  mesFin: number;
  versionFormulario: "1" | "2";
  filas: ResumenMaestroAt2Fila[];
}

export interface ControlEnviosAt2Fila {
  regionCodigo: number;
  regionNombre: string;
  departamentoMunicipio: string;
  codigo: string;
  unidadSalud: string;
  meses: Record<number, EstadoSeguimiento>;
}

export interface ControlEnviosAt2Resultado {
  nivel: string;
  anio: number;
  filas: ControlEnviosAt2Fila[];
}

const MESES_VALIDOS = Array.from({ length: 12 }, (_, index) => index + 1);

const normalizarNivelReporte = (regionIds?: number[] | null) => {
  if (!regionIds?.length) return "Nivel Central";
  if (regionIds.length === 1) return REGION_CODE_TO_NAME[regionIds[0]] ?? `Region ${regionIds[0]}`;
  return "Nivel Central";
};

const construirRegionKey = (regionIds?: number[] | null) =>
  regionIds?.length ? [...regionIds].sort((a, b) => a - b).join(",") : "central";

const condicionRegiones = (regionIds?: number[] | null, alias = "us") => {
  if (!regionIds?.length) return { sql: "", params: [] as number[] };
  return {
    sql: `AND ${alias}.C_REGION IN (${regionIds.map(() => "?").join(", ")})`,
    params: regionIds
  };
};

const limpiarTextoReporte = (valor: unknown, respaldo = "") =>
  String(valor ?? respaldo)
    .trim()
    .replace(/^["“”]+|["“”]+$/g, "");

export const obtenerIndicadoresMunicipales = async (
  params: IndicadoresMunicipalesParams
): Promise<IndicadoresMunicipalesTotales> => {
  const { anio, departamentoId, regionIds } = params;
  const cacheKey = `reportes:indicadores-municipales:${anio ?? "todos"}:${departamentoId}:${construirRegionKey(regionIds)}`;

  return cache.getOrSet(cacheKey, async () => {
  const pool = obtenerPoolActual();
  const fuenteDetalle = anio
    ? construirFuenteDetalleAt2([anio])
    : await construirFuenteDetalleAt2TodosLosAnios();
  let condicionRegion = "";
  const parametros: any[] = [departamentoId];

  if (regionIds?.length) {
    condicionRegion = `AND C_REGION IN (${regionIds.map(() => "?").join(", ")})`;
    parametros.push(...regionIds);
  } else {
    const esCortes = departamentoId === 5;
    if (esCortes) {
      condicionRegion = "AND C_REGION IN (5, 20)";
    }
  }

  const condicionAnio = anio ? "det.N_ANIO = ? AND" : "";
  const query = `
    SELECT
      COALESCE(SUM(${TOTAL_ATENCIONES_EXPRESSION}), 0) AS totalConsultas,
      COALESCE(SUM(det.Q_AT_ENFERMERA_AUX), 0) AS enfermeraAuxiliar,
      COALESCE(SUM(det.Q_AT_ENFERMERA_PRO), 0) AS enfermeraProfesional,
      COALESCE(SUM(det.Q_AT_MEDICO_GEN), 0) AS medicinaGeneral,
      COALESCE(SUM(det.Q_AT_MEDICO_ESP), 0) AS medicosEspecialistas,
      COUNT(DISTINCT det.C_US) AS totalUnidades
      FROM (
        SELECT DISTINCT CAST(C_US AS CHAR) COLLATE utf8mb4_unicode_ci AS C_US
        FROM BAS_BDR_US
      WHERE C_DEPARTAMENTO = ?
      ${condicionRegion}
    ) us
    STRAIGHT_JOIN ${fuenteDetalle}
      ON det.C_US COLLATE utf8mb4_unicode_ci = us.C_US
    WHERE ${condicionAnio} det.C_CONCEPTO = ?`;

  if (anio) {
    parametros.push(anio);
  }
  parametros.push(CODIGO_CONCEPTO_TOTAL_PACIENTES_ATENDIDOS);
  const [filas] = await pool.query<RowDataPacket[]>(query, parametros);
  const fila = filas?.[0] ?? {};

  return {
    totalConsultas: Number(fila.totalConsultas ?? 0),
    enfermeraAuxiliar: Number(fila.enfermeraAuxiliar ?? 0),
    enfermeraProfesional: Number(fila.enfermeraProfesional ?? 0),
    medicinaGeneral: Number(fila.medicinaGeneral ?? 0),
    medicosEspecialistas: Number(fila.medicosEspecialistas ?? 0),
    totalUnidades: Number(fila.totalUnidades ?? 0)
  };
  }, CACHE_TTL.REPORTES_OFICIALES);
};

export const obtenerResumenMaestroAt2 = async (params: {
  anio: number;
  mesInicio: number;
  mesFin: number;
  regionIds?: number[] | null;
}): Promise<ResumenMaestroAt2Resultado> => {
  const { anio, mesInicio, mesFin, regionIds } = params;
  const cacheKey = `reportes:resumen-maestro-at2:${anio}:${mesInicio}-${mesFin}:${construirRegionKey(regionIds)}`;

  return cache.getOrSet(cacheKey, async () => {
  const pool = obtenerPoolActual();
  const fuenteDetalle = construirFuenteDetalleAt2([anio]);
  const filtroRegion = condicionRegiones(regionIds);
  const [versionesRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT det.V_FORMULARIO
       FROM ${fuenteDetalle}
       INNER JOIN BAS_BDR_US us
         ON CAST(us.C_US AS CHAR) COLLATE utf8mb4_unicode_ci = det.C_US COLLATE utf8mb4_unicode_ci
      WHERE det.N_ANIO = ?
        AND det.N_MES BETWEEN ? AND ?
        ${filtroRegion.sql}`,
    [anio, mesInicio, mesFin, ...filtroRegion.params]
  );
  const versionesPresentes = new Set(
    versionesRows.map((fila) => String(fila.V_FORMULARIO ?? ""))
  );
  if (versionesPresentes.has("3") && versionesPresentes.has("4")) {
    throw new Error(
      "El período seleccionado contiene formularios AT2-R históricos y nuevos; deben reportarse por versión para no mezclar conceptos distintos."
    );
  }
  const versionFormulario: "1" | "2" =
    versionesPresentes.has("3") && !versionesPresentes.has("4") ? "1" : "2";
  const maxConcepto = versionFormulario === "1" ? 53 : 92;
  const catalogoConceptos = versionFormulario === "2"
    ? `
        SELECT numero, descripcion
        FROM (${construirCatalogoAt2NuevoSql()}) catalogo_nuevo
        WHERE numero BETWEEN 1 AND ?
      `
    : `
        SELECT
          CAST(TRIM(LEADING '0' FROM TRIM(C_CONCEPTO)) AS UNSIGNED) AS numero,
          MAX(TRIM(D_CONCEPTO)) AS descripcion
        FROM AT2_BDR_CONCEPTOS_GE
        WHERE CAST(TRIM(LEADING '0' FROM TRIM(C_CONCEPTO)) AS UNSIGNED) BETWEEN 1 AND ?
          AND (V_FORMULARIO = '3' OR (V_FORMULARIO IS NULL AND CAST(C_CONCEPTO AS UNSIGNED) = 53))
        GROUP BY CAST(TRIM(LEADING '0' FROM TRIM(C_CONCEPTO)) AS UNSIGNED)
      `;

  const [rows] = await pool.query<RowDataPacket[]>(
    `
      SELECT
        conceptos.numero,
        conceptos.descripcion AS concepto,
        COALESCE(agg.enfermera_auxiliar, 0) AS enfermera_auxiliar,
        COALESCE(agg.enfermera_profesional, 0) AS enfermera_profesional,
        COALESCE(agg.medico_general, 0) AS medico_general,
        COALESCE(agg.medico_especialista, 0) AS medico_especialista
      FROM (${catalogoConceptos}) conceptos
      LEFT JOIN (
        SELECT
          CAST(TRIM(LEADING '0' FROM TRIM(det.C_CONCEPTO)) AS UNSIGNED) AS numero,
          SUM(COALESCE(det.Q_AT_ENFERMERA_AUX, 0)) AS enfermera_auxiliar,
          SUM(COALESCE(det.Q_AT_ENFERMERA_PRO, 0)) AS enfermera_profesional,
          SUM(COALESCE(det.Q_AT_MEDICO_GEN, 0)) AS medico_general,
          SUM(COALESCE(det.Q_AT_MEDICO_ESP, 0)) AS medico_especialista
        FROM ${fuenteDetalle}
        INNER JOIN BAS_BDR_US us
          ON CAST(us.C_US AS CHAR) COLLATE utf8mb4_unicode_ci = det.C_US COLLATE utf8mb4_unicode_ci
        WHERE det.N_ANIO = ?
          AND det.N_MES BETWEEN ? AND ?
          AND CAST(TRIM(LEADING '0' FROM TRIM(det.C_CONCEPTO)) AS UNSIGNED) BETWEEN 1 AND ?
          ${filtroRegion.sql}
        GROUP BY CAST(TRIM(LEADING '0' FROM TRIM(det.C_CONCEPTO)) AS UNSIGNED)
      ) agg ON agg.numero = conceptos.numero
      ORDER BY conceptos.numero
    `,
    [maxConcepto, anio, mesInicio, mesFin, maxConcepto, ...filtroRegion.params]
  );

  const filasConsultadas = rows.map((row) => {
    const enfermeraAuxiliar = Number(row.enfermera_auxiliar ?? 0);
    const enfermeraProfesional = Number(row.enfermera_profesional ?? 0);
    const medicoGeneral = Number(row.medico_general ?? 0);
    const medicoEspecialista = Number(row.medico_especialista ?? 0);
    return {
      numero: Number(row.numero),
      concepto: limpiarTextoReporte(row.concepto, `Concepto ${row.numero}`),
      enfermeraAuxiliar,
      enfermeraProfesional,
      medicoGeneral,
      medicoEspecialista,
      total: enfermeraAuxiliar + enfermeraProfesional + medicoGeneral + medicoEspecialista
    };
  });
  const filasPorNumero = new Map(filasConsultadas.map((fila) => [fila.numero, fila]));
  const filas = Array.from({ length: maxConcepto }, (_, index) => {
    const numero = index + 1;
    return filasPorNumero.get(numero) ?? {
      numero,
      concepto: `Concepto ${numero}`,
      enfermeraAuxiliar: 0,
      enfermeraProfesional: 0,
      medicoGeneral: 0,
      medicoEspecialista: 0,
      total: 0
    };
  });

  return {
    nivel: normalizarNivelReporte(regionIds),
    anio,
    mesInicio,
    mesFin,
    versionFormulario,
    filas
  };
  }, CACHE_TTL.REPORTES_OFICIALES);
};

export const obtenerControlEnviosAt2 = async (params: {
  anio: number;
  regionIds?: number[] | null;
}, opciones: {
  sincronizar?: boolean;
} = {}): Promise<ControlEnviosAt2Resultado> => {
  const { anio, regionIds } = params;
  const cacheKey = `reportes:control-envios-at2:${anio}:${construirRegionKey(regionIds)}`;

  const consultar = async () => {
  if (opciones.sincronizar !== false) {
    await seguimientoServicio.asegurarTabla();
    await seguimientoServicio.sincronizarEnviosDesdeDetalleAnual(anio);
  }
  const pool = obtenerPoolActual();
  const filtroRegion = regionIds?.length
    ? {
        sql: `AND base.region_codigo IN (${regionIds.map(() => "?").join(", ")})`,
        params: regionIds
      }
    : { sql: "", params: [] as number[] };

  const [rows] = await pool.query<RowDataPacket[]>(
    `
      WITH base_unidades AS (
        SELECT
          us.C_REGION AS region_codigo,
          COALESCE(CAST(dep.D_DEPARTAMENTO AS CHAR), CAST(us.C_DEPARTAMENTO AS CHAR)) COLLATE utf8mb4_unicode_ci AS departamento_nombre,
          COALESCE(CAST(muni.D_MUNICIPIO AS CHAR), CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO)) COLLATE utf8mb4_unicode_ci AS municipio_nombre,
          CAST(us.C_US AS CHAR) COLLATE utf8mb4_unicode_ci AS establecimiento_rups,
          TRIM(CAST(us.D_US AS CHAR)) COLLATE utf8mb4_unicode_ci AS establecimiento_nombre,
          COALESCE(CAST(nivel.D_NIVEL_US_SIGLA AS CHAR), CAST(us.C_NIVEL_US AS CHAR), 'S/N') COLLATE utf8mb4_unicode_ci AS nivel_sigla,
          us.C_NIVEL_US
        FROM BAS_BDR_US us
        LEFT JOIN BAS_BDR_DEPARTAMENTOS dep
          ON dep.C_DEPARTAMENTO = us.C_DEPARTAMENTO
        LEFT JOIN BAS_BDR_MUNICIPIOS muni
          ON muni.C_DEPARTAMENTO = us.C_DEPARTAMENTO
          AND muni.C_MUNICIPIO = us.C_MUNICIPIO
        LEFT JOIN BAS_BDR_NIVELES_US nivel
          ON nivel.C_NIVEL_US = us.C_NIVEL_US
        WHERE us.C_REGION BETWEEN 1 AND 20
      ),
      base_servicios AS (
        SELECT
          region_codigo,
          departamento_nombre,
          municipio_nombre,
          establecimiento_rups,
          establecimiento_nombre,
          nivel_sigla,
          'general' COLLATE utf8mb4_unicode_ci AS servicio,
          establecimiento_nombre COLLATE utf8mb4_unicode_ci AS unidad_reporte
        FROM base_unidades
        WHERE C_NIVEL_US NOT IN (1, 2, 3) OR C_NIVEL_US IS NULL

        UNION ALL

        SELECT
          region_codigo,
          departamento_nombre,
          municipio_nombre,
          establecimiento_rups,
          establecimiento_nombre,
          nivel_sigla,
          'consulta_externa' COLLATE utf8mb4_unicode_ci AS servicio,
          CONCAT(establecimiento_nombre, ' - Consulta externa') COLLATE utf8mb4_unicode_ci AS unidad_reporte
        FROM base_unidades
        WHERE C_NIVEL_US IN (1, 2, 3)

        UNION ALL

        SELECT
          region_codigo,
          departamento_nombre,
          municipio_nombre,
          establecimiento_rups,
          establecimiento_nombre,
          nivel_sigla,
          'emergencia' COLLATE utf8mb4_unicode_ci AS servicio,
          CONCAT(establecimiento_nombre, ' - Emergencia') COLLATE utf8mb4_unicode_ci AS unidad_reporte
        FROM base_unidades
        WHERE C_NIVEL_US IN (1, 2, 3)
      )
      SELECT
        base.region_codigo,
        base.departamento_nombre,
        base.municipio_nombre,
        base.establecimiento_rups,
        base.nivel_sigla,
        base.unidad_reporte,
        ${MESES_VALIDOS.map((mes) => `MAX(CASE WHEN seg.mes = ${mes} THEN seg.estado ELSE NULL END) AS mes_${mes}`).join(",\n        ")}
      FROM base_servicios base
      LEFT JOIN AT2_SEGUIMIENTO_ENVIO seg
        ON seg.anio = ?
        AND seg.establecimiento_rups COLLATE utf8mb4_unicode_ci = base.establecimiento_rups COLLATE utf8mb4_unicode_ci
        AND seg.servicio COLLATE utf8mb4_unicode_ci = base.servicio COLLATE utf8mb4_unicode_ci
      WHERE 1 = 1
        ${filtroRegion.sql}
      GROUP BY
        base.region_codigo,
        base.departamento_nombre,
        base.municipio_nombre,
        base.establecimiento_rups,
        base.nivel_sigla,
        base.unidad_reporte
      ORDER BY
        base.region_codigo,
        base.departamento_nombre,
        base.municipio_nombre,
        CAST(base.establecimiento_rups AS UNSIGNED),
        base.unidad_reporte
    `,
    [anio, ...filtroRegion.params]
  );

  const normalizarMes = (valor: unknown): EstadoSeguimiento => {
    if (valor === "revisado") return "revisado";
    if (valor === "enviado") return "enviado";
    return "no_enviado";
  };

  return {
    nivel: normalizarNivelReporte(regionIds),
    anio,
    filas: rows.map((row) => {
      const meses = Object.fromEntries(
        MESES_VALIDOS.map((mes) => [mes, normalizarMes(row[`mes_${mes}`])])
      ) as Record<number, EstadoSeguimiento>;

      return {
        regionCodigo: Number(row.region_codigo),
        regionNombre: REGION_CODE_TO_NAME[Number(row.region_codigo)] ?? `Region ${row.region_codigo}`,
        departamentoMunicipio: `${limpiarTextoReporte(row.departamento_nombre)} / ${limpiarTextoReporte(row.municipio_nombre)}`,
        codigo: limpiarTextoReporte(row.establecimiento_rups),
        unidadSalud: `(${limpiarTextoReporte(row.nivel_sigla, "S/N")}) ${limpiarTextoReporte(row.unidad_reporte)}`,
        meses
      };
    })
  };
  };

  if (opciones.sincronizar === false) {
    return consultar();
  }

  return cache.getOrSet(cacheKey, consultar, CACHE_TTL.REPORTES_OFICIALES);
};

export const obtenerEstadisticasCache = () => {
  const stats = cache.getStats({ includeKeys: false });
  return {
    totalEntradas: cache.countKeysByPrefix("reportes:"),
    cacheGlobal: {
      hits: stats.hits,
      misses: stats.misses,
      totalSize: stats.size,
      pending: stats.pending
    }
  };
};
