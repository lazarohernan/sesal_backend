import type { RowDataPacket } from "mysql2";

import { obtenerPoolActual } from "../base_datos/pool";
import { cache, CACHE_TTL, CACHE_KEYS } from "../utilidades/cache.utilidad";

const DETALLE_PREFIX = "AT2_BDT_MENSUAL_DETALLE_";
const ANIO_MIN_DETALLE = 2008;
const ANIO_MAX_DETALLE = 2099;

const validarAnioDetalle = (anio: number): number => {
  if (!Number.isInteger(anio) || anio < ANIO_MIN_DETALLE || anio > ANIO_MAX_DETALLE) {
    throw new Error(`Año AT2 inválido: ${anio}`);
  }
  return anio;
};

export const obtenerTablaDetalleAt2 = (anio: number): string =>
  `${DETALLE_PREFIX}${validarAnioDetalle(anio)}`;

export const obtenerAniosDetalleAt2Disponibles = async (): Promise<number[]> =>
  cache.getOrSet(
    CACHE_KEYS.TABLAS_DETALLE,
    async () => {
      const pool = obtenerPoolActual();
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = DATABASE()
            AND table_name REGEXP '^AT2_BDT_MENSUAL_DETALLE_[0-9]{4}$'
          ORDER BY table_name`
      );

      return rows
        .map((row) => String(row.table_name ?? row.TABLE_NAME ?? ""))
        .map((tableName) => Number(tableName.replace(DETALLE_PREFIX, "")))
        .filter((anio) => Number.isInteger(anio))
        .sort((a, b) => a - b);
    },
    CACHE_TTL.ANIOS_DISPONIBLES
  );

export const construirFuenteDetalleAt2 = (anios: number[], alias = "det"): string => {
  const aniosUnicos = Array.from(new Set(anios.map(validarAnioDetalle))).sort((a, b) => a - b);
  if (!aniosUnicos.length) {
    throw new Error("No se indicaron años AT2 para construir la fuente de detalle");
  }

  if (aniosUnicos.length === 1) {
    return `${obtenerTablaDetalleAt2(aniosUnicos[0])} ${alias}`;
  }

  const union = aniosUnicos
    .map((anio) => `SELECT * FROM ${obtenerTablaDetalleAt2(anio)}`)
    .join("\nUNION ALL\n");

  return `(${union}) ${alias}`;
};

export const construirFuenteDetalleAt2TodosLosAnios = async (alias = "det"): Promise<string> => {
  const anios = await obtenerAniosDetalleAt2Disponibles();
  return construirFuenteDetalleAt2(anios, alias);
};
