import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { obtenerPoolActual } from "../base_datos/pool";

export interface Establecimiento {
  id: number;
  codigoRup: string;
  nombre: string;
  estado: "activo" | "inactivo";
  nivelCodigo: number;
  nivelDescripcion: string;
  regionCodigo: number;
  regionNombre: string;
  municipioCodigo: number;
  municipioNombre: string;
}

export interface NivelEstablecimiento {
  codigo: number;
  descripcion: string;
}

export interface MunicipioOpcion {
  departamentoCodigo: number;
  municipioCodigo: number;
  nombre: string;
}

export interface CrearEstablecimientoInput {
  codigoRup: string;
  nombre: string;
  nivelCodigo: number;
  regionCodigo: number;
  municipioCodigo: number;
}

export interface ActualizarEstablecimientoInput {
  id: number;
  nombre: string;
  nivelCodigo: number;
  regionCodigo: number;
  municipioCodigo: number;
}

export interface CambiarEstadoEstablecimientoInput {
  id: number;
  estado: "activo" | "inactivo";
}

interface EstablecimientoRow extends RowDataPacket {
  C_US: number;
  D_US: string;
  B_ACTIVA: string;
  C_NIVEL_US: number;
  nivel_descripcion: string;
  C_REGION: number;
  D_REGION: string;
  C_DEPARTAMENTO: number;
  C_MUNICIPIO: number;
  D_MUNICIPIO: string;
}

interface NivelRow extends RowDataPacket {
  codigo: number;
  descripcion: string;
}

interface MunicipioRow extends RowDataPacket {
  C_DEPARTAMENTO: number;
  C_MUNICIPIO: number;
  D_MUNICIPIO: string;
}

const mapearEstablecimiento = (row: EstablecimientoRow): Establecimiento => ({
  id: row.C_US,
  codigoRup: String(row.C_US),
  nombre: row.D_US,
  estado: row.B_ACTIVA === "S" ? "activo" : "inactivo",
  nivelCodigo: row.C_NIVEL_US,
  nivelDescripcion: row.nivel_descripcion ?? "Sin nivel",
  regionCodigo: row.C_REGION,
  regionNombre: row.D_REGION ?? "Sin región",
  municipioCodigo: row.C_MUNICIPIO,
  municipioNombre: row.D_MUNICIPIO ?? "Sin municipio",
});

const BASE_QUERY = `
  SELECT
    u.C_US,
    u.D_US,
    u.B_ACTIVA,
    u.C_NIVEL_US,
    u.C_REGION,
    u.C_DEPARTAMENTO,
    u.C_MUNICIPIO,
    COALESCE(n.descripcion, 'Sin nivel') AS nivel_descripcion,
    COALESCE(r.D_REGION, 'Sin región')  AS D_REGION,
    COALESCE(m.D_MUNICIPIO, 'Sin municipio') AS D_MUNICIPIO
  FROM BAS_BDR_US u
  LEFT JOIN cat_nivel_establecimiento n ON u.C_NIVEL_US = CAST(n.codigo AS SIGNED)
  LEFT JOIN BAS_BDR_REGIONES r ON u.C_REGION = r.C_REGION
  LEFT JOIN BAS_BDR_MUNICIPIOS m ON u.C_MUNICIPIO = m.C_MUNICIPIO AND u.C_DEPARTAMENTO = m.C_DEPARTAMENTO
`;

export const establecimientosServicio = {
  async listar(): Promise<Establecimiento[]> {
    const pool = obtenerPoolActual();
    const [rows] = await pool.query<EstablecimientoRow[]>(
      `${BASE_QUERY} ORDER BY u.D_US ASC`
    );
    return rows.map(mapearEstablecimiento);
  },

  async obtenerPorId(id: number): Promise<Establecimiento | null> {
    const pool = obtenerPoolActual();
    const [rows] = await pool.query<EstablecimientoRow[]>(
      `${BASE_QUERY} WHERE u.C_US = ? LIMIT 1`,
      [id]
    );
    return rows[0] ? mapearEstablecimiento(rows[0]) : null;
  },

  async listarNiveles(): Promise<NivelEstablecimiento[]> {
    const pool = obtenerPoolActual();
    const [rows] = await pool.query<NivelRow[]>(
      `SELECT CAST(codigo AS SIGNED) AS codigo, descripcion
       FROM cat_nivel_establecimiento
       ORDER BY CAST(codigo AS SIGNED) ASC`
    );
    return rows.map((r) => ({ codigo: r.codigo, descripcion: r.descripcion }));
  },

  async listarMunicipiosPorRegion(regionCodigo: number): Promise<MunicipioOpcion[]> {
    const pool = obtenerPoolActual();
    const [rows] = await pool.query<MunicipioRow[]>(
      `SELECT DISTINCT u.C_DEPARTAMENTO, u.C_MUNICIPIO, m.D_MUNICIPIO
       FROM BAS_BDR_US u
       JOIN BAS_BDR_MUNICIPIOS m
         ON u.C_MUNICIPIO = m.C_MUNICIPIO
        AND u.C_DEPARTAMENTO = m.C_DEPARTAMENTO
       WHERE u.C_REGION = ?
       ORDER BY m.D_MUNICIPIO ASC`,
      [regionCodigo]
    );
    return rows.map((r) => ({
      departamentoCodigo: r.C_DEPARTAMENTO,
      municipioCodigo: r.C_MUNICIPIO,
      nombre: r.D_MUNICIPIO,
    }));
  },

  async cambiarEstado(input: CambiarEstadoEstablecimientoInput): Promise<Establecimiento> {
    const pool = obtenerPoolActual();
    const bActiva = input.estado === "activo" ? "S" : "N";
    await pool.query<ResultSetHeader>(
      `UPDATE BAS_BDR_US SET B_ACTIVA = ? WHERE C_US = ?`,
      [bActiva, input.id]
    );
    const actualizado = await this.obtenerPorId(input.id);
    if (!actualizado) throw new Error("Establecimiento no encontrado.");
    return actualizado;
  },

  async crear(input: CrearEstablecimientoInput): Promise<Establecimiento> {
    const pool = obtenerPoolActual();

    const [existing] = await pool.query<RowDataPacket[]>(
      `SELECT C_US FROM BAS_BDR_US WHERE C_US = ? LIMIT 1`,
      [Number(input.codigoRup)]
    );
    if (existing.length > 0) {
      throw new Error(`Ya existe un establecimiento con el código RUP ${input.codigoRup}.`);
    }

    const [deptoRows] = await pool.query<RowDataPacket[]>(
      `SELECT C_DEPARTAMENTO FROM BAS_BDR_MUNICIPIOS WHERE C_MUNICIPIO = ?
       AND C_DEPARTAMENTO IN (
         SELECT DISTINCT C_DEPARTAMENTO FROM BAS_BDR_US WHERE C_REGION = ?
       ) LIMIT 1`,
      [input.municipioCodigo, input.regionCodigo]
    );
    const departamento = deptoRows[0]?.C_DEPARTAMENTO ?? 0;

    await pool.query<ResultSetHeader>(
      `INSERT INTO BAS_BDR_US
         (C_US, V_US, D_US, B_ACTIVA, C_NIVEL_US, C_REGION, C_DEPARTAMENTO, C_MUNICIPIO, C_ALDEA, B_CENTINELA, F_ALTA)
       VALUES (?, 1, ?, 'S', ?, ?, ?, ?, 0, 'N', NOW())`,
      [
        Number(input.codigoRup),
        input.nombre.trim(),
        input.nivelCodigo,
        input.regionCodigo,
        departamento,
        input.municipioCodigo,
      ]
    );

    const creado = await this.obtenerPorId(Number(input.codigoRup));
    if (!creado) throw new Error("No se pudo recuperar el establecimiento creado.");
    return creado;
  },

  async actualizar(input: ActualizarEstablecimientoInput): Promise<Establecimiento> {
    const pool = obtenerPoolActual();

    const [deptoRows] = await pool.query<RowDataPacket[]>(
      `SELECT C_DEPARTAMENTO FROM BAS_BDR_MUNICIPIOS WHERE C_MUNICIPIO = ?
       AND C_DEPARTAMENTO IN (
         SELECT DISTINCT C_DEPARTAMENTO FROM BAS_BDR_US WHERE C_REGION = ?
       ) LIMIT 1`,
      [input.municipioCodigo, input.regionCodigo]
    );
    const departamento = deptoRows[0]?.C_DEPARTAMENTO ?? 0;

    await pool.query<ResultSetHeader>(
      `UPDATE BAS_BDR_US
       SET D_US = ?, C_NIVEL_US = ?, C_REGION = ?, C_DEPARTAMENTO = ?, C_MUNICIPIO = ?
       WHERE C_US = ?`,
      [
        input.nombre.trim(),
        input.nivelCodigo,
        input.regionCodigo,
        departamento,
        input.municipioCodigo,
        input.id,
      ]
    );

    const actualizado = await this.obtenerPorId(input.id);
    if (!actualizado) throw new Error("Establecimiento no encontrado.");
    return actualizado;
  },
};
