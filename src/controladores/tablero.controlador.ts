import type { Request, Response, NextFunction } from "express";
import type { RowDataPacket } from "mysql2";

import {
  obtenerDatosMapaHonduras,
  obtenerResumenTablero
} from "../servicios/tablero.servicio";
import { obtenerPoolActual } from "../base_datos/pool";
import { logger } from "../utilidades/registro.utilidad";

export const obtenerResumenControlador = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { anio } = req.query;
    const anioNumero = anio ? Number(anio) : undefined;

    if (anio && (!Number.isFinite(anioNumero) || anioNumero! < 2008 || anioNumero! > 2030)) {
      return res.status(400).json({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "El parámetro 'anio' debe ser un número válido entre 2008 y 2030",
        campos: { anio }
      });
    }

    const resumen = await obtenerResumenTablero(anioNumero);

    return res.status(200).json({
      datos: resumen,
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    logger.error("Error al obtener resumen del tablero", error);
    return next(error);
  }
};

export const obtenerMapaHondurasControlador = async (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const datos = await obtenerDatosMapaHonduras();

    return res.status(200).json({
      datos,
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    logger.error("Error al obtener datos del mapa Honduras", error);
    return next(error);
  }
};

export const obtenerAniosDisponiblesControlador = async (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const pool = obtenerPoolActual();
    const [tablas] = await pool.query<RowDataPacket[]>(
      `SELECT TABLE_NAME
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME LIKE 'AT2_BDT_MENSUAL_DETALLE_%'
       ORDER BY TABLE_NAME DESC`,
      [process.env.MYSQL_DATABASE || 'sesal_historico']
    );

    const anios = tablas
      .map(tabla => {
        const match = tabla.TABLE_NAME?.toString().match(/AT2_BDT_MENSUAL_DETALLE_(\d{4})/);
        return match ? Number(match[1]) : null;
      })
      .filter((anio): anio is number => anio !== null)
      .sort((a, b) => b - a); // Ordenar de mayor a menor (2025, 2024, ...)

    return res.status(200).json({
      datos: anios,
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    logger.error("Error al obtener años disponibles", error);
    return next(error);
  }
};
