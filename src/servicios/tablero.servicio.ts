import type { RowDataPacket } from "mysql2";

import { obtenerPoolActual } from "../base_datos/pool";
import { cache, CACHE_TTL, CACHE_KEYS } from "../utilidades/cache.utilidad";
import {
  construirFuenteDetalleAt2,
  construirFuenteDetalleAt2TodosLosAnios
} from "./at2-detalle-fuente.servicio";
import { CODIGO_CONCEPTO_TOTAL_PACIENTES_ATENDIDOS } from "../utilidades/at2-reglas.util";

const TABLA_GLOBAL_ANIO_RESUMEN = "tablero_global_anio_resumen";
const TABLA_REGION_ANIO_RESUMEN = "tablero_region_anio_resumen";
const TABLA_REGION_DEPARTAMENTO_RESUMEN = "tablero_region_departamento_resumen";
const TOTAL_ATENCIONES_EXPRESSION =
  "COALESCE(det.Q_AT_ENFERMERA_AUX, 0) + COALESCE(det.Q_AT_ENFERMERA_PRO, 0) + COALESCE(det.Q_AT_MEDICO_GEN, 0) + COALESCE(det.Q_AT_MEDICO_ESP, 0)";

export interface ResumenTablero {
  totalRegiones: number;
  totalMunicipios: number;
  totalUnidadesServicio: number;
  totalRegistrosDetalle: number;
  totalAtencionesEnfermeraAuxiliar: number;
  totalAtencionesEnfermeraProfesional: number;
  totalAtencionesMedicinaGeneral: number;
  totalAtencionesMedicosEspecialistas: number;
}

export interface DepartamentoDato {
  departamentoId: number;
  nombre: string;
  totalHistorico: number;
  total2025: number;
  total2024: number;
  total2023: number;
  totalUnidades: number;
}

const construirFiltroRegionesSql = (regionIds?: number[] | null, alias = "us") => {
  if (!regionIds?.length) {
    return {
      clause: "",
      values: [] as number[]
    };
  }

  return {
    clause: ` AND ${alias}.C_REGION IN (${regionIds.map(() => "?").join(", ")})`,
    values: [...regionIds]
  };
};

const esTablaResumenNoDisponible = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: string }).code === "ER_NO_SUCH_TABLE";

interface TotalesAtencionesConcepto19 {
  totalAtenciones: number;
  totalAtencionesEnfermeraAuxiliar: number;
  totalAtencionesEnfermeraProfesional: number;
  totalAtencionesMedicinaGeneral: number;
  totalAtencionesMedicosEspecialistas: number;
}

const obtenerTotalesAtencionesConcepto19 = async (
  anio?: number,
  regionIds?: number[] | null,
  departamentoId?: number | null
): Promise<TotalesAtencionesConcepto19> => {
  const pool = obtenerPoolActual();
  const fuenteDetalle = anio
    ? construirFuenteDetalleAt2([anio])
    : await construirFuenteDetalleAt2TodosLosAnios();
  const joins: string[] = [];
  const condiciones: string[] = [
    "det.C_CONCEPTO = ?"
  ];
  const valores: Array<number | string> = [CODIGO_CONCEPTO_TOTAL_PACIENTES_ATENDIDOS];

  if (anio) {
    condiciones.push("det.N_ANIO = ?");
    valores.push(anio);
  }

  if (regionIds?.length || departamentoId) {
    joins.push(
      `INNER JOIN BAS_BDR_US us
         ON us.C_US COLLATE utf8mb4_unicode_ci = det.C_US COLLATE utf8mb4_unicode_ci`
    );
  }

  if (regionIds?.length) {
    condiciones.push(`us.C_REGION IN (${regionIds.map(() => "?").join(", ")})`);
    valores.push(...regionIds);
  }

  if (departamentoId) {
    condiciones.push("us.C_DEPARTAMENTO = ?");
    valores.push(departamentoId);
  }

  const [resultado] = await pool.query<RowDataPacket[]>(
      `SELECT
        COALESCE(SUM(${TOTAL_ATENCIONES_EXPRESSION}), 0) AS totalAtenciones,
        COALESCE(SUM(det.Q_AT_ENFERMERA_AUX), 0) AS totalAtencionesEnfermeraAuxiliar,
        COALESCE(SUM(det.Q_AT_ENFERMERA_PRO), 0) AS totalAtencionesEnfermeraProfesional,
        COALESCE(SUM(det.Q_AT_MEDICO_GEN), 0) AS totalAtencionesMedicinaGeneral,
        COALESCE(SUM(det.Q_AT_MEDICO_ESP), 0) AS totalAtencionesMedicosEspecialistas
       FROM ${fuenteDetalle}
       ${joins.join("\n")}
      WHERE ${condiciones.join(" AND ")}`,
    valores
  );

  return {
    totalAtenciones: Number(resultado?.[0]?.totalAtenciones ?? 0),
    totalAtencionesEnfermeraAuxiliar: Number(resultado?.[0]?.totalAtencionesEnfermeraAuxiliar ?? 0),
    totalAtencionesEnfermeraProfesional: Number(resultado?.[0]?.totalAtencionesEnfermeraProfesional ?? 0),
    totalAtencionesMedicinaGeneral: Number(resultado?.[0]?.totalAtencionesMedicinaGeneral ?? 0),
    totalAtencionesMedicosEspecialistas: Number(resultado?.[0]?.totalAtencionesMedicosEspecialistas ?? 0)
  };
};

const obtenerResumenDepartamentoDesdeDetalle = async (
  departamentoId: number,
  anio?: number,
  regionIds?: number[] | null
): Promise<ResumenTablero> => {
  const pool = obtenerPoolActual();
  const condicionesUs = ["us.C_DEPARTAMENTO = ?"];
  const valoresUs: Array<number | string> = [departamentoId];

  if (regionIds?.length) {
    condicionesUs.push(`us.C_REGION IN (${regionIds.map(() => "?").join(", ")})`);
    valoresUs.push(...regionIds);
  }

  const [catalogos] = await pool.query<RowDataPacket[]>(
    `SELECT
        COUNT(DISTINCT us.C_REGION) AS totalRegiones,
        COUNT(DISTINCT CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO)) AS totalMunicipios,
        COUNT(DISTINCT us.C_US) AS totalUnidadesServicio
       FROM BAS_BDR_US us
      WHERE ${condicionesUs.join(" AND ")}`,
    valoresUs
  );

  const totalesAtenciones = await obtenerTotalesAtencionesConcepto19(anio, regionIds, departamentoId);

  return {
    totalRegiones: Number(catalogos?.[0]?.totalRegiones ?? 0),
    totalMunicipios: Number(catalogos?.[0]?.totalMunicipios ?? 0),
    totalUnidadesServicio: Number(catalogos?.[0]?.totalUnidadesServicio ?? 0),
    totalRegistrosDetalle: totalesAtenciones.totalAtenciones,
    totalAtencionesEnfermeraAuxiliar: totalesAtenciones.totalAtencionesEnfermeraAuxiliar,
    totalAtencionesEnfermeraProfesional: totalesAtenciones.totalAtencionesEnfermeraProfesional,
    totalAtencionesMedicinaGeneral: totalesAtenciones.totalAtencionesMedicinaGeneral,
    totalAtencionesMedicosEspecialistas: totalesAtenciones.totalAtencionesMedicosEspecialistas
  };
};

const obtenerResumenGlobalDesdeResumen = async (
  anio?: number
): Promise<ResumenTablero> => {
  const pool = obtenerPoolActual();

  if (anio) {
    const [resultado] = await pool.query<RowDataPacket[]>(
      `SELECT
        total_unidades AS totalUnidadesServicio
       FROM ${TABLA_GLOBAL_ANIO_RESUMEN}
       WHERE anio = ?`,
      [anio]
    );

    const [catalogos] = await pool.query<RowDataPacket[]>(
      `SELECT
          (SELECT COUNT(*) FROM BAS_BDR_REGIONES) AS totalRegiones,
          (SELECT COUNT(*) FROM BAS_BDR_MUNICIPIOS) AS totalMunicipios`
    );

    return {
      totalRegiones: Number(catalogos?.[0]?.totalRegiones ?? 0),
      totalMunicipios: Number(catalogos?.[0]?.totalMunicipios ?? 0),
      totalUnidadesServicio: Number(resultado?.[0]?.totalUnidadesServicio ?? 0),
      totalRegistrosDetalle: 0,
      totalAtencionesEnfermeraAuxiliar: 0,
      totalAtencionesEnfermeraProfesional: 0,
      totalAtencionesMedicinaGeneral: 0,
      totalAtencionesMedicosEspecialistas: 0
    };
  }

  const [catalogoUS] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS totalUnidadesServicio FROM BAS_BDR_US`
  );

  const [catalogos] = await pool.query<RowDataPacket[]>(
    `SELECT
        (SELECT COUNT(*) FROM BAS_BDR_REGIONES) AS totalRegiones,
        (SELECT COUNT(*) FROM BAS_BDR_MUNICIPIOS) AS totalMunicipios`
  );

  return {
    totalRegiones: Number(catalogos?.[0]?.totalRegiones ?? 0),
    totalMunicipios: Number(catalogos?.[0]?.totalMunicipios ?? 0),
    totalUnidadesServicio: Number(catalogoUS?.[0]?.totalUnidadesServicio ?? 0),
    totalRegistrosDetalle: 0,
    totalAtencionesEnfermeraAuxiliar: 0,
    totalAtencionesEnfermeraProfesional: 0,
    totalAtencionesMedicinaGeneral: 0,
    totalAtencionesMedicosEspecialistas: 0
  };
};

const obtenerResumenRegionalDesdeResumen = async (
  regionIds: number[],
  anio?: number
): Promise<ResumenTablero> => {
  const pool = obtenerPoolActual();
  const placeholders = regionIds.map(() => "?").join(", ");

  let totalUnidadesServicio = 0;

  if (anio) {
    const [resultado] = await pool.query<RowDataPacket[]>(
      `SELECT
        COALESCE(SUM(total_unidades), 0) AS totalUnidadesServicio
       FROM ${TABLA_REGION_ANIO_RESUMEN}
       WHERE region_id IN (${placeholders}) AND anio = ?`,
      [...regionIds, anio]
    );
    totalUnidadesServicio = Number(resultado?.[0]?.totalUnidadesServicio ?? 0);
  } else {
    const [catalogoUS] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT us.C_US) AS totalUnidadesServicio
       FROM BAS_BDR_US us
       WHERE us.C_REGION IN (${placeholders})`,
      [...regionIds]
    );
    totalUnidadesServicio = Number(catalogoUS?.[0]?.totalUnidadesServicio ?? 0);
  }

  const [catalogos] = await pool.query<RowDataPacket[]>(
    `SELECT
        COUNT(DISTINCT us.C_REGION) AS totalRegiones,
        COUNT(DISTINCT CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO)) AS totalMunicipios
     FROM BAS_BDR_US us
     WHERE us.C_REGION IN (${placeholders})`,
    [...regionIds]
  );

  return {
    totalRegiones: Number(catalogos?.[0]?.totalRegiones ?? 0),
    totalMunicipios: Number(catalogos?.[0]?.totalMunicipios ?? 0),
    totalUnidadesServicio,
    totalRegistrosDetalle: 0,
    totalAtencionesEnfermeraAuxiliar: 0,
    totalAtencionesEnfermeraProfesional: 0,
    totalAtencionesMedicinaGeneral: 0,
    totalAtencionesMedicosEspecialistas: 0
  };
};

const obtenerMapaRegionalDesdeResumen = async (regionIds: number[]): Promise<DepartamentoDato[]> => {
  const pool = obtenerPoolActual();
  const fuenteDetalle = await construirFuenteDetalleAt2TodosLosAnios();
  const placeholders = regionIds.map(() => "?").join(", ");
  const [filas] = await pool.query<RowDataPacket[]>(
    `SELECT
        us.C_DEPARTAMENTO AS departamentoId,
        dep.D_DEPARTAMENTO AS nombre,
        COALESCE(SUM(${TOTAL_ATENCIONES_EXPRESSION}), 0) AS totalHistorico,
        COALESCE(SUM(CASE WHEN det.N_ANIO = 2025 THEN ${TOTAL_ATENCIONES_EXPRESSION} ELSE 0 END), 0) AS total2025,
        COALESCE(SUM(CASE WHEN det.N_ANIO = 2024 THEN ${TOTAL_ATENCIONES_EXPRESSION} ELSE 0 END), 0) AS total2024,
        COALESCE(SUM(CASE WHEN det.N_ANIO = 2023 THEN ${TOTAL_ATENCIONES_EXPRESSION} ELSE 0 END), 0) AS total2023,
        COUNT(DISTINCT det.C_US) AS totalUnidades
      FROM ${fuenteDetalle}
      INNER JOIN BAS_BDR_US us
        ON us.C_US COLLATE utf8mb4_unicode_ci = det.C_US COLLATE utf8mb4_unicode_ci
      INNER JOIN BAS_BDR_DEPARTAMENTOS dep
        ON dep.C_DEPARTAMENTO = us.C_DEPARTAMENTO
      WHERE det.C_CONCEPTO = ? AND us.C_REGION IN (${placeholders})
      GROUP BY us.C_DEPARTAMENTO, dep.D_DEPARTAMENTO
      ORDER BY us.C_DEPARTAMENTO`,
    [CODIGO_CONCEPTO_TOTAL_PACIENTES_ATENDIDOS, ...regionIds]
  );

  return filas.map((fila) => ({
    departamentoId: Number(fila.departamentoId),
    nombre: String(fila.nombre),
    totalHistorico: Number(fila.totalHistorico ?? 0),
    total2025: Number(fila.total2025 ?? 0),
    total2024: Number(fila.total2024 ?? 0),
    total2023: Number(fila.total2023 ?? 0),
    totalUnidades: Number(fila.totalUnidades ?? 0)
  }));
};

const obtenerMapaGlobalDesdeDetalle = async (): Promise<DepartamentoDato[]> => {
  const pool = obtenerPoolActual();
  const fuenteDetalle = await construirFuenteDetalleAt2TodosLosAnios();
  const [filas] = await pool.query<RowDataPacket[]>(
    `SELECT
        us.C_DEPARTAMENTO AS departamentoId,
        dep.D_DEPARTAMENTO AS nombre,
        COALESCE(SUM(${TOTAL_ATENCIONES_EXPRESSION}), 0) AS totalHistorico,
        COALESCE(SUM(CASE WHEN det.N_ANIO = 2025 THEN ${TOTAL_ATENCIONES_EXPRESSION} ELSE 0 END), 0) AS total2025,
        COALESCE(SUM(CASE WHEN det.N_ANIO = 2024 THEN ${TOTAL_ATENCIONES_EXPRESSION} ELSE 0 END), 0) AS total2024,
        COALESCE(SUM(CASE WHEN det.N_ANIO = 2023 THEN ${TOTAL_ATENCIONES_EXPRESSION} ELSE 0 END), 0) AS total2023,
        COUNT(DISTINCT det.C_US) AS totalUnidades
      FROM ${fuenteDetalle}
      INNER JOIN BAS_BDR_US us
        ON us.C_US COLLATE utf8mb4_unicode_ci = det.C_US COLLATE utf8mb4_unicode_ci
      INNER JOIN BAS_BDR_DEPARTAMENTOS dep
        ON dep.C_DEPARTAMENTO = us.C_DEPARTAMENTO
      WHERE det.C_CONCEPTO = ?
      GROUP BY us.C_DEPARTAMENTO, dep.D_DEPARTAMENTO
      ORDER BY us.C_DEPARTAMENTO`,
    [CODIGO_CONCEPTO_TOTAL_PACIENTES_ATENDIDOS]
  );

  return filas.map((fila) => ({
    departamentoId: Number(fila.departamentoId),
    nombre: String(fila.nombre),
    totalHistorico: Number(fila.totalHistorico ?? 0),
    total2025: Number(fila.total2025 ?? 0),
    total2024: Number(fila.total2024 ?? 0),
    total2023: Number(fila.total2023 ?? 0),
    totalUnidades: Number(fila.totalUnidades ?? 0)
  }));
};

export const obtenerResumenTablero = async (
  anio?: number,
  regionIds?: number[] | null,
  departamentoId?: number | null
): Promise<ResumenTablero> => {
  const regionKey = regionIds?.length ? `r:${[...regionIds].sort((a, b) => a - b).join(",")}` : "r:all";
  const departamentoKey = departamentoId ? `d:${departamentoId}` : "d:all";
  const cacheKey = `${CACHE_KEYS.RESUMEN_TABLERO(anio)}:${regionKey}:${departamentoKey}`;
  
  return cache.getOrSet(
    cacheKey,
    async () => {
      if (departamentoId) {
        return obtenerResumenDepartamentoDesdeDetalle(departamentoId, anio, regionIds);
      }

      let resumen: ResumenTablero;

      try {
        if (regionIds?.length) {
          resumen = await obtenerResumenRegionalDesdeResumen(regionIds, anio);
        } else {
          resumen = await obtenerResumenGlobalDesdeResumen(anio);
        }
      } catch (error) {
        if (!esTablaResumenNoDisponible(error)) {
          throw error;
        }

        const pool = obtenerPoolActual();
        const filtroRegiones = construirFiltroRegionesSql(regionIds);
        
        let totalUnidadesServicio = 0;
        let totalRegistrosDetalle = 0;
        let totalRegiones = 0;
        let totalMunicipios = 0;

        if (regionIds?.length) {
          if (anio) {
            const fuenteDetalle = construirFuenteDetalleAt2([anio]);
            const [resultado] = await pool.query<RowDataPacket[]>(
              `SELECT
                COUNT(*) AS total,
                COUNT(DISTINCT det.C_US) AS totalUnidades
	               FROM ${fuenteDetalle}
	               INNER JOIN BAS_BDR_US us
                 ON us.C_US COLLATE utf8mb4_unicode_ci = det.C_US COLLATE utf8mb4_unicode_ci
               WHERE det.N_ANIO = ?${filtroRegiones.clause}`,
              [anio, ...filtroRegiones.values]
            );
            totalRegistrosDetalle = Number(resultado?.[0]?.total ?? 0);
            totalUnidadesServicio = Number(resultado?.[0]?.totalUnidades ?? 0);
          } else {
            const fuenteDetalle = await construirFuenteDetalleAt2TodosLosAnios();
            const [tablas] = await pool.query<RowDataPacket[]>(
              `SELECT COUNT(*) AS total
	               FROM ${fuenteDetalle}
	               INNER JOIN BAS_BDR_US us
                 ON us.C_US COLLATE utf8mb4_unicode_ci = det.C_US COLLATE utf8mb4_unicode_ci
               WHERE 1=1${filtroRegiones.clause}`,
              [...filtroRegiones.values]
            );
            totalRegistrosDetalle = Number(tablas?.[0]?.total ?? 0);

            const [catalogoUS] = await pool.query<RowDataPacket[]>(
              `SELECT COUNT(DISTINCT us.C_US) AS total
               FROM BAS_BDR_US us
               WHERE 1=1${filtroRegiones.clause}`,
              [...filtroRegiones.values]
            );
            totalUnidadesServicio = Number(catalogoUS?.[0]?.total ?? 0);
          }

          const [catalogos] = await pool.query<RowDataPacket[]>(
            `SELECT
                COUNT(DISTINCT us.C_REGION) AS totalRegiones,
                COUNT(DISTINCT CONCAT(us.C_DEPARTAMENTO, '-', us.C_MUNICIPIO)) AS totalMunicipios
             FROM BAS_BDR_US us
             WHERE 1=1${filtroRegiones.clause}`,
            [...filtroRegiones.values]
          );

          totalRegiones = Number(catalogos?.[0]?.totalRegiones ?? 0);
          totalMunicipios = Number(catalogos?.[0]?.totalMunicipios ?? 0);
        } else {
          if (anio) {
            const fuenteDetalle = construirFuenteDetalleAt2([anio]);
            const [resultado] = await pool.query<RowDataPacket[]>(
              `SELECT
                COUNT(*) AS total,
                COUNT(DISTINCT C_US) AS totalUnidades
	               FROM ${fuenteDetalle}
	               WHERE N_ANIO = ?`,
              [anio]
            );
            totalRegistrosDetalle = Number(resultado?.[0]?.total ?? 0);
            totalUnidadesServicio = Number(resultado?.[0]?.totalUnidades ?? 0);
          } else {
            const fuenteDetalle = await construirFuenteDetalleAt2TodosLosAnios();
            const [tablas] = await pool.query<RowDataPacket[]>(
              `SELECT COUNT(*) AS total FROM ${fuenteDetalle}`
            );
            totalRegistrosDetalle = Number(tablas?.[0]?.total ?? 0);

            const [catalogoUS] = await pool.query<RowDataPacket[]>(
              `SELECT COUNT(*) AS total FROM BAS_BDR_US`
            );
            totalUnidadesServicio = Number(catalogoUS?.[0]?.total ?? 0);
          }

          const [catalogos] = await pool.query<RowDataPacket[]>(
            `SELECT
                (SELECT COUNT(*) FROM BAS_BDR_REGIONES) AS totalRegiones,
                (SELECT COUNT(*) FROM BAS_BDR_MUNICIPIOS) AS totalMunicipios`
          );

          totalRegiones = Number(catalogos?.[0]?.totalRegiones ?? 0);
          totalMunicipios = Number(catalogos?.[0]?.totalMunicipios ?? 0);
        }

        resumen = {
          totalRegiones,
          totalMunicipios,
          totalUnidadesServicio,
          totalRegistrosDetalle,
          totalAtencionesEnfermeraAuxiliar: 0,
          totalAtencionesEnfermeraProfesional: 0,
          totalAtencionesMedicinaGeneral: 0,
          totalAtencionesMedicosEspecialistas: 0
        };
      }

      const totalesAtenciones = await obtenerTotalesAtencionesConcepto19(anio, regionIds);

      return {
        ...resumen,
        totalRegistrosDetalle: totalesAtenciones.totalAtenciones,
        totalAtencionesEnfermeraAuxiliar: totalesAtenciones.totalAtencionesEnfermeraAuxiliar,
        totalAtencionesEnfermeraProfesional: totalesAtenciones.totalAtencionesEnfermeraProfesional,
        totalAtencionesMedicinaGeneral: totalesAtenciones.totalAtencionesMedicinaGeneral,
        totalAtencionesMedicosEspecialistas: totalesAtenciones.totalAtencionesMedicosEspecialistas
      };
    },
    CACHE_TTL.RESUMEN_TABLERO
  );
};

export const obtenerDatosMapaHonduras = async (regionIds?: number[] | null): Promise<DepartamentoDato[]> => {
  if (regionIds?.length) {
    const regionKey = [...regionIds].sort((a, b) => a - b).join(",");
    return cache.getOrSet(
      `${CACHE_KEYS.DATOS_MAPA}:regional:${regionKey}`,
      () => obtenerMapaRegionalDesdeResumen(regionIds),
      CACHE_TTL.DATOS_MAPA
    );
  }

  return cache.getOrSet(
    CACHE_KEYS.DATOS_MAPA,
    obtenerMapaGlobalDesdeDetalle,
    CACHE_TTL.DATOS_MAPA
  );
};
