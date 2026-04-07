import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { obtenerPoolActual } from "../base_datos/pool";
import { hashPassword } from "../utilidades/auth.util";

const TABLA_USUARIOS = "app_usuarios";
const TABLA_SESIONES = "app_sesiones";

export interface UsuarioGestionado {
  id: number;
  nombre: string;
  username: string;
  email: string;
  rol: string;
  activo: boolean;
  estado: "activo" | "inactivo";
  regiones: string[];
  ultimoAcceso: string;
  creadoEn: string;
  actualizadoEn: string;
}

interface UsuarioGestionRow extends RowDataPacket {
  id: number;
  username: string;
  email: string | null;
  nombre_mostrar: string;
  rol: string;
  activo: number | boolean;
  regiones_json: string | string[] | null;
  ultimo_login_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface CrearUsuarioRegionalInput {
  nombre: string;
  username: string;
  email: string;
  passwordTemporal?: string;
  regiones: string[];
}

export interface CrearUsuarioRegionalResultado {
  usuario: UsuarioGestionado;
  passwordTemporal: string;
}

export interface ActualizarUsuarioRegionalInput {
  id: number;
  nombre: string;
  username: string;
  email: string;
  estado: "activo" | "inactivo";
  regiones: string[];
}

export interface CambiarEstadoUsuarioInput {
  id: number;
  estado: "activo" | "inactivo";
}

export interface ResetearPasswordUsuarioInput {
  id: number;
  passwordTemporal?: string;
}

export interface ResetearPasswordUsuarioResultado {
  usuario: UsuarioGestionado;
  passwordTemporal: string;
}

const generarPasswordTemporal = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";
  let password = "";

  for (let i = 0; i < 12; i += 1) {
    password += chars[Math.floor(Math.random() * chars.length)];
  }

  return password;
};

const normalizarRegiones = (raw: string | string[] | null) => {
  if (!raw) {
    return [];
  }

  if (Array.isArray(raw)) {
    return [...new Set(raw.map((item) => String(item).trim()).filter(Boolean))];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.map((item) => String(item).trim()).filter(Boolean))];
    }
  } catch (_error) {
    // Si el valor no es JSON valido, devolvemos vacio.
  }

  return [];
};

const normalizarFecha = (valor: Date | string | null) => {
  if (!valor) {
    return "";
  }

  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? "" : fecha.toISOString();
};

const mapearUsuario = (row: UsuarioGestionRow): UsuarioGestionado => ({
  id: row.id,
  nombre: row.nombre_mostrar,
  username: row.username,
  email: row.email ?? "",
  rol: row.rol,
  activo: Boolean(row.activo),
  estado: Boolean(row.activo) ? "activo" : "inactivo",
  regiones: normalizarRegiones(row.regiones_json),
  ultimoAcceso: normalizarFecha(row.ultimo_login_at) || "Sin ingreso",
  creadoEn: normalizarFecha(row.created_at),
  actualizadoEn: normalizarFecha(row.updated_at)
});

const esErrorDuplicado = (error: unknown) =>
  Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ER_DUP_ENTRY");

export class UsuariosServicio {
  private async obtenerUsuarioPorId(id: number): Promise<UsuarioGestionado | null> {
    const pool = obtenerPoolActual();

    const [rows] = await pool.query<UsuarioGestionRow[]>(
      `
        SELECT
          id,
          username,
          email,
          nombre_mostrar,
          rol,
          activo,
          regiones_json,
          ultimo_login_at,
          created_at,
          updated_at
        FROM ${TABLA_USUARIOS}
        WHERE id = ?
        LIMIT 1
      `,
      [id]
    );

    const usuario = rows[0];
    return usuario ? mapearUsuario(usuario) : null;
  }

  async listarUsuarios(): Promise<UsuarioGestionado[]> {
    const pool = obtenerPoolActual();

    const [rows] = await pool.query<UsuarioGestionRow[]>(
      `
        SELECT
          id,
          username,
          email,
          nombre_mostrar,
          rol,
          activo,
          regiones_json,
          ultimo_login_at,
          created_at,
          updated_at
        FROM ${TABLA_USUARIOS}
        ORDER BY created_at DESC, id DESC
      `
    );

    return rows.map(mapearUsuario);
  }

  async crearUsuarioRegional(payload: CrearUsuarioRegionalInput): Promise<CrearUsuarioRegionalResultado> {
    const nombre = payload.nombre.trim();
    const username = payload.username.trim().toLowerCase();
    const email = payload.email.trim().toLowerCase();
    const regiones = [...new Set(payload.regiones.map((region) => region.trim()).filter(Boolean))];
    const passwordTemporal = payload.passwordTemporal?.trim() || generarPasswordTemporal();

    if (!nombre || !username || !email) {
      throw new Error("Los datos basicos del usuario son obligatorios.");
    }

    if (regiones.length === 0) {
      throw new Error("Debe asignar al menos una region.");
    }

    if (passwordTemporal.length < 8) {
      throw new Error("La contrasena temporal debe tener al menos 8 caracteres.");
    }

    const pool = obtenerPoolActual();
    const passwordHash = await hashPassword(passwordTemporal);

    try {
      const [resultado] = await pool.query<ResultSetHeader>(
        `
          INSERT INTO ${TABLA_USUARIOS}
            (username, email, password_hash, nombre_mostrar, rol, regiones_json, activo, requiere_cambio_password)
          VALUES (?, ?, ?, ?, 'regional', ?, 1, 1)
        `,
        [
          username,
          email,
          passwordHash,
          nombre,
          JSON.stringify(regiones)
        ]
      );

      const [rows] = await pool.query<UsuarioGestionRow[]>(
        `
          SELECT
            id,
            username,
            email,
            nombre_mostrar,
            rol,
            activo,
            regiones_json,
            ultimo_login_at,
            created_at,
            updated_at
          FROM ${TABLA_USUARIOS}
          WHERE id = ?
          LIMIT 1
        `,
        [resultado.insertId]
      );

      const usuario = rows[0];
      if (!usuario) {
        throw new Error("No fue posible recuperar el usuario creado.");
      }

      return {
        usuario: mapearUsuario(usuario),
        passwordTemporal
      };
    } catch (error) {
      if (esErrorDuplicado(error)) {
        throw new Error("El usuario o el correo ya existe.");
      }

      throw error;
    }
  }

  async actualizarUsuarioRegional(payload: ActualizarUsuarioRegionalInput): Promise<UsuarioGestionado> {
    const id = Number(payload.id);
    const nombre = payload.nombre.trim();
    const username = payload.username.trim().toLowerCase();
    const email = payload.email.trim().toLowerCase();
    const regiones = [...new Set(payload.regiones.map((region) => region.trim()).filter(Boolean))];
    const activo = payload.estado === "activo" ? 1 : 0;

    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("El identificador del usuario no es valido.");
    }

    if (!nombre || !username || !email) {
      throw new Error("Los datos basicos del usuario son obligatorios.");
    }

    if (regiones.length === 0) {
      throw new Error("Debe asignar al menos una region.");
    }

    const pool = obtenerPoolActual();
    const usuarioActual = await this.obtenerUsuarioPorId(id);

    if (!usuarioActual) {
      throw new Error("El usuario seleccionado no existe.");
    }

    if (usuarioActual.rol !== "regional") {
      throw new Error("Solo se pueden editar usuarios regionales desde esta seccion.");
    }

    try {
      const [resultado] = await pool.query<ResultSetHeader>(
        `
          UPDATE ${TABLA_USUARIOS}
          SET
            username = ?,
            email = ?,
            nombre_mostrar = ?,
            regiones_json = ?,
            activo = ?
          WHERE id = ?
          LIMIT 1
        `,
        [
          username,
          email,
          nombre,
          JSON.stringify(regiones),
          activo,
          id
        ]
      );

      if (resultado.affectedRows === 0) {
        throw new Error("No fue posible actualizar el usuario.");
      }

      const usuarioActualizado = await this.obtenerUsuarioPorId(id);
      if (!usuarioActualizado) {
        throw new Error("No fue posible recuperar el usuario actualizado.");
      }

      return usuarioActualizado;
    } catch (error) {
      if (esErrorDuplicado(error)) {
        throw new Error("El usuario o el correo ya existe.");
      }

      throw error;
    }
  }

  async cambiarEstadoUsuarioRegional(payload: CambiarEstadoUsuarioInput): Promise<UsuarioGestionado> {
    const id = Number(payload.id);
    const activo = payload.estado === "activo" ? 1 : 0;
    const pool = obtenerPoolActual();

    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("El identificador del usuario no es valido.");
    }

    const usuarioActual = await this.obtenerUsuarioPorId(id);
    if (!usuarioActual) {
      throw new Error("El usuario seleccionado no existe.");
    }

    if (usuarioActual.rol !== "regional") {
      throw new Error("Solo se pueden administrar usuarios regionales desde esta seccion.");
    }

    await pool.query(
      `
        UPDATE ${TABLA_USUARIOS}
        SET activo = ?
        WHERE id = ?
        LIMIT 1
      `,
      [activo, id]
    );

    if (!activo) {
      await pool.query(
        `UPDATE ${TABLA_SESIONES} SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL`,
        [id]
      );
    }

    const usuarioActualizado = await this.obtenerUsuarioPorId(id);
    if (!usuarioActualizado) {
      throw new Error("No fue posible recuperar el usuario actualizado.");
    }

    return usuarioActualizado;
  }

  async eliminarUsuarioRegional(id: number): Promise<void> {
    const userId = Number(id);
    const pool = obtenerPoolActual();

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error("El identificador del usuario no es valido.");
    }

    const usuarioActual = await this.obtenerUsuarioPorId(userId);
    if (!usuarioActual) {
      throw new Error("El usuario seleccionado no existe.");
    }

    if (usuarioActual.rol !== "regional") {
      throw new Error("Solo se pueden eliminar usuarios regionales desde esta seccion.");
    }

    const [resultado] = await pool.query<ResultSetHeader>(
      `
        DELETE FROM ${TABLA_USUARIOS}
        WHERE id = ?
        LIMIT 1
      `,
      [userId]
    );

    if (resultado.affectedRows === 0) {
      throw new Error("No fue posible eliminar el usuario.");
    }
  }

  async resetearPasswordUsuarioRegional(payload: ResetearPasswordUsuarioInput): Promise<ResetearPasswordUsuarioResultado> {
    const userId = Number(payload.id);
    const passwordTemporal = payload.passwordTemporal?.trim() || generarPasswordTemporal();
    const pool = obtenerPoolActual();

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error("El identificador del usuario no es valido.");
    }

    if (passwordTemporal.length < 8) {
      throw new Error("La contrasena temporal debe tener al menos 8 caracteres.");
    }

    const usuarioActual = await this.obtenerUsuarioPorId(userId);
    if (!usuarioActual) {
      throw new Error("El usuario seleccionado no existe.");
    }

    if (usuarioActual.rol !== "regional") {
      throw new Error("Solo se pueden administrar usuarios regionales desde esta seccion.");
    }

    const passwordHash = await hashPassword(passwordTemporal);

    await pool.query(
      `
        UPDATE ${TABLA_USUARIOS}
        SET password_hash = ?, requiere_cambio_password = 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        LIMIT 1
      `,
      [passwordHash, userId]
    );

    await pool.query(
      `UPDATE ${TABLA_SESIONES} SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL`,
      [userId]
    );

    const usuarioActualizado = await this.obtenerUsuarioPorId(userId);
    if (!usuarioActualizado) {
      throw new Error("No fue posible recuperar el usuario actualizado.");
    }

    return {
      usuario: usuarioActualizado,
      passwordTemporal
    };
  }
}

export const usuariosServicio = new UsuariosServicio();
