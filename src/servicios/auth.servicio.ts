import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { obtenerPoolActual } from "../base_datos/pool";
import { entorno } from "../configuracion/entorno";
import { hashPassword, hashTokenSesion, verificarPassword, generarTokenSesion } from "../utilidades/auth.util";
import { logger } from "../utilidades/registro.utilidad";

export interface UsuarioAutenticado {
  id: number;
  username: string;
  email: string | null;
  nombreMostrar: string;
  rol: string;
  regiones: string[];
  establecimientos: string[];
  puedeVerSeguimiento: boolean;
  requiereCambioPassword: boolean;
}

interface UsuarioRow extends RowDataPacket {
  id: number;
  username: string;
  email: string | null;
  password_hash: string;
  nombre_mostrar: string;
  rol: string;
  regiones_json: string | string[] | null;
  establecimientos_json: string | string[] | null;
  puede_ver_seguimiento: number | boolean;
  requiere_cambio_password: number | boolean;
}

interface SesionRow extends RowDataPacket {
  session_id: number;
  id: number;
  user_id: number;
  username: string;
  email: string | null;
  nombre_mostrar: string;
  rol: string;
  regiones_json: string | string[] | null;
  establecimientos_json: string | string[] | null;
  puede_ver_seguimiento: number | boolean;
  requiere_cambio_password: number | boolean;
  expires_at: Date | string;
}

interface LoginPayload {
  identificador: string;
  password: string;
  recordar: boolean;
  ip: string | null;
  userAgent: string | null;
}

interface LoginResult {
  token: string;
  maxAgeSeconds: number;
  usuario: UsuarioAutenticado;
}

interface PasswordResetRow extends RowDataPacket {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: Date | string;
  used_at: Date | string | null;
  username: string;
  email: string | null;
  nombre_mostrar: string;
}

interface PasswordResetRequestResult {
  expiresAt: string | null;
  resetUrl: string | null;
}

const TABLA_USUARIOS = "app_usuarios";
const TABLA_SESIONES = "app_sesiones";
const TABLA_PASSWORD_RESET = "app_password_resets";

const normalizarRegiones = (raw: string | string[] | null) => {
  if (!raw) {
    return [];
  }

  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item)).filter(Boolean);
    }
  } catch (_error) {
    // Si el valor no es JSON valido, devolvemos vacio para no romper la autenticacion.
  }

  return [];
};

const mapearUsuario = (row: Pick<UsuarioRow, "id" | "username" | "email" | "nombre_mostrar" | "rol" | "regiones_json" | "establecimientos_json" | "puede_ver_seguimiento" | "requiere_cambio_password">): UsuarioAutenticado => ({
  id: row.id,
  username: row.username,
  email: row.email,
  nombreMostrar: row.nombre_mostrar,
  rol: row.rol,
  regiones: normalizarRegiones(row.regiones_json),
  establecimientos: normalizarRegiones(row.establecimientos_json),
  puedeVerSeguimiento: Boolean(row.puede_ver_seguimiento),
  requiereCambioPassword: Boolean(row.requiere_cambio_password)
});

const obtenerSegundosSesion = (recordar: boolean) =>
  recordar
    ? entorno.auth.sessionRememberDays * 24 * 60 * 60
    : entorno.auth.sessionTtlHours * 60 * 60;

class AuthServicio {
  private inicializado = false;

  async inicializar() {
    if (this.inicializado) {
      return;
    }

    const pool = obtenerPoolActual();

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLA_USUARIOS} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        username VARCHAR(80) NOT NULL,
        email VARCHAR(180) DEFAULT NULL,
        password_hash VARCHAR(255) NOT NULL,
        nombre_mostrar VARCHAR(120) NOT NULL,
        rol VARCHAR(32) NOT NULL DEFAULT 'central',
        regiones_json JSON DEFAULT NULL,
        establecimientos_json JSON DEFAULT NULL,
        puede_ver_seguimiento TINYINT(1) NOT NULL DEFAULT 0,
        activo TINYINT(1) NOT NULL DEFAULT 1,
        requiere_cambio_password TINYINT(1) NOT NULL DEFAULT 0,
        ultimo_login_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_${TABLA_USUARIOS}_username (username),
        UNIQUE KEY uq_${TABLA_USUARIOS}_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await this.asegurarColumnaUsuarios(
      "establecimientos_json",
      "JSON DEFAULT NULL AFTER regiones_json"
    );

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLA_SESIONES} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        token_hash CHAR(64) NOT NULL,
        remember_me TINYINT(1) NOT NULL DEFAULT 0,
        ip_address VARCHAR(64) DEFAULT NULL,
        user_agent VARCHAR(255) DEFAULT NULL,
        expires_at DATETIME NOT NULL,
        last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        revoked_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_${TABLA_SESIONES}_token_hash (token_hash),
        KEY idx_${TABLA_SESIONES}_user_id (user_id),
        KEY idx_${TABLA_SESIONES}_expires_at (expires_at),
        CONSTRAINT fk_${TABLA_SESIONES}_user
          FOREIGN KEY (user_id) REFERENCES ${TABLA_USUARIOS} (id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLA_PASSWORD_RESET} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        token_hash CHAR(64) NOT NULL,
        requested_ip VARCHAR(64) DEFAULT NULL,
        user_agent VARCHAR(255) DEFAULT NULL,
        expires_at DATETIME NOT NULL,
        used_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_${TABLA_PASSWORD_RESET}_token_hash (token_hash),
        KEY idx_${TABLA_PASSWORD_RESET}_user_id (user_id),
        KEY idx_${TABLA_PASSWORD_RESET}_expires_at (expires_at),
        CONSTRAINT fk_${TABLA_PASSWORD_RESET}_user
          FOREIGN KEY (user_id) REFERENCES ${TABLA_USUARIOS} (id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await this.asegurarColumnaUsuarios(
      "requiere_cambio_password",
      "TINYINT(1) NOT NULL DEFAULT 0 AFTER activo"
    );

    await this.asegurarColumnaUsuarios(
      "puede_ver_seguimiento",
      "TINYINT(1) NOT NULL DEFAULT 0 AFTER establecimientos_json"
    );

    await this.limpiarSesionesExpiradas();
    await this.limpiarTokensRecuperacionExpirados();
    await this.bootstrapAdminSiHaceFalta();

    this.inicializado = true;
    logger.info("Autenticacion local inicializada");
  }

  async login(payload: LoginPayload): Promise<LoginResult | null> {
    const pool = obtenerPoolActual();
    const identificador = payload.identificador.trim().toLowerCase();

    const [rows] = await pool.query<UsuarioRow[]>(
      `
        SELECT id, username, email, password_hash, nombre_mostrar, rol, regiones_json, establecimientos_json
        , puede_ver_seguimiento, requiere_cambio_password
        FROM ${TABLA_USUARIOS}
        WHERE activo = 1 AND (LOWER(username) = ? OR LOWER(COALESCE(email, '')) = ?)
        LIMIT 1
      `,
      [identificador, identificador]
    );

    const usuario = rows[0];
    if (!usuario) {
      return null;
    }

    const passwordValido = await verificarPassword(payload.password, usuario.password_hash);
    if (!passwordValido) {
      return null;
    }

    const token = generarTokenSesion();
    const tokenHash = hashTokenSesion(token);
    const maxAgeSeconds = obtenerSegundosSesion(payload.recordar);
    const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000);

    await pool.query(
      `
        INSERT INTO ${TABLA_SESIONES}
          (user_id, token_hash, remember_me, ip_address, user_agent, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        usuario.id,
        tokenHash,
        payload.recordar ? 1 : 0,
        payload.ip,
        payload.userAgent?.slice(0, 255) ?? null,
        expiresAt
      ]
    );

    await pool.query(
      `UPDATE ${TABLA_USUARIOS} SET ultimo_login_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [usuario.id]
    );

    return {
      token,
      maxAgeSeconds,
      usuario: mapearUsuario(usuario)
    };
  }

  async obtenerSesion(token: string): Promise<UsuarioAutenticado | null> {
    const pool = obtenerPoolActual();
    const tokenHash = hashTokenSesion(token);

    const [rows] = await pool.query<SesionRow[]>(
      `
        SELECT
          s.id AS session_id,
          u.id,
          s.user_id,
          s.expires_at,
          u.username,
          u.email,
          u.nombre_mostrar,
          u.rol,
          u.regiones_json,
          u.establecimientos_json,
          u.puede_ver_seguimiento,
          u.requiere_cambio_password
        FROM ${TABLA_SESIONES} s
        INNER JOIN ${TABLA_USUARIOS} u ON u.id = s.user_id
        WHERE s.token_hash = ?
          AND s.revoked_at IS NULL
          AND s.expires_at > CURRENT_TIMESTAMP
          AND u.activo = 1
        LIMIT 1
      `,
      [tokenHash]
    );

    const sesion = rows[0];
    if (!sesion) {
      return null;
    }

    await pool.query(
      `UPDATE ${TABLA_SESIONES} SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [sesion.session_id]
    );

    return mapearUsuario(sesion);
  }

  async cerrarSesion(token: string) {
    const pool = obtenerPoolActual();
    const tokenHash = hashTokenSesion(token);

    await pool.query(
      `
        UPDATE ${TABLA_SESIONES}
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE token_hash = ? AND revoked_at IS NULL
      `,
      [tokenHash]
    );
  }

  async solicitarRecuperacion(
    identificador: string,
    ip: string | null,
    userAgent: string | null
  ): Promise<PasswordResetRequestResult> {
    const pool = obtenerPoolActual();
    const limpio = identificador.trim().toLowerCase();
    if (!limpio) {
      return { expiresAt: null, resetUrl: null };
    }

    const [rows] = await pool.query<UsuarioRow[]>(
      `
        SELECT id, username, email, password_hash, nombre_mostrar, rol, regiones_json, establecimientos_json
        , puede_ver_seguimiento, requiere_cambio_password
        FROM ${TABLA_USUARIOS}
        WHERE activo = 1 AND (LOWER(username) = ? OR LOWER(COALESCE(email, '')) = ?)
        LIMIT 1
      `,
      [limpio, limpio]
    );

    const usuario = rows[0];
    if (!usuario) {
      return { expiresAt: null, resetUrl: null };
    }

    await pool.query(
      `
        UPDATE ${TABLA_PASSWORD_RESET}
        SET used_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND used_at IS NULL
      `,
      [usuario.id]
    );

    const token = generarTokenSesion();
    const tokenHash = hashTokenSesion(token);
    const expiresAtDate = new Date(Date.now() + entorno.auth.resetTtlMinutes * 60 * 1000);

    await pool.query(
      `
        INSERT INTO ${TABLA_PASSWORD_RESET}
          (user_id, token_hash, requested_ip, user_agent, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      [usuario.id, tokenHash, ip, userAgent?.slice(0, 255) ?? null, expiresAtDate]
    );

    const resetUrl = new URL(entorno.auth.resetBaseUrl);
    resetUrl.searchParams.set("token", token);

    return {
      expiresAt: expiresAtDate.toISOString(),
      resetUrl: resetUrl.toString()
    };
  }

  async validarTokenRecuperacion(token: string) {
    const reset = await this.obtenerResetToken(token);
    if (!reset) {
      return null;
    }

    return {
      nombreMostrar: reset.nombre_mostrar,
      email: reset.email
    };
  }

  async restablecerPassword(token: string, nuevoPassword: string) {
    const pool = obtenerPoolActual();
    const reset = await this.obtenerResetToken(token);
    if (!reset) {
      return false;
    }

    const passwordHash = await hashPassword(nuevoPassword);

    await pool.query(
      `UPDATE ${TABLA_USUARIOS} SET password_hash = ?, requiere_cambio_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [passwordHash, reset.user_id]
    );

    await pool.query(
      `UPDATE ${TABLA_PASSWORD_RESET} SET used_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [reset.id]
    );

    await pool.query(
      `UPDATE ${TABLA_SESIONES} SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL`,
      [reset.user_id]
    );

    return true;
  }

  async cambiarPasswordAutenticado(payload: {
    userId: number;
    nuevoPassword: string;
    sessionTokenActual?: string | null;
  }): Promise<UsuarioAutenticado | null> {
    const pool = obtenerPoolActual();

    const [rows] = await pool.query<UsuarioRow[]>(
      `
        SELECT id, username, email, password_hash, nombre_mostrar, rol, regiones_json, establecimientos_json, puede_ver_seguimiento, requiere_cambio_password
        FROM ${TABLA_USUARIOS}
        WHERE id = ? AND activo = 1
        LIMIT 1
      `,
      [payload.userId]
    );

    const usuario = rows[0];
    if (!usuario) {
      return null;
    }

    const nuevoHash = await hashPassword(payload.nuevoPassword);

    await pool.query(
      `
        UPDATE ${TABLA_USUARIOS}
        SET password_hash = ?, requiere_cambio_password = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [nuevoHash, usuario.id]
    );

    if (payload.sessionTokenActual) {
      await pool.query(
        `
          UPDATE ${TABLA_SESIONES}
          SET revoked_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND token_hash <> ? AND revoked_at IS NULL
        `,
        [usuario.id, hashTokenSesion(payload.sessionTokenActual)]
      );
    }

    return mapearUsuario({
      ...usuario,
      puede_ver_seguimiento: usuario.puede_ver_seguimiento,
      requiere_cambio_password: 0
    });
  }

  private async asegurarColumnaUsuarios(nombre: string, definicion: string) {
    const pool = obtenerPoolActual();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SHOW COLUMNS FROM ${TABLA_USUARIOS} LIKE ?`,
      [nombre]
    );

    if (rows.length > 0) {
      return;
    }

    await pool.query(`ALTER TABLE ${TABLA_USUARIOS} ADD COLUMN ${nombre} ${definicion}`);
  }

  private async limpiarSesionesExpiradas() {
    const pool = obtenerPoolActual();
    await pool.query(
      `DELETE FROM ${TABLA_SESIONES} WHERE expires_at <= CURRENT_TIMESTAMP OR revoked_at IS NOT NULL`
    );
  }

  private async limpiarTokensRecuperacionExpirados() {
    const pool = obtenerPoolActual();
    await pool.query(
      `
        DELETE FROM ${TABLA_PASSWORD_RESET}
        WHERE expires_at <= CURRENT_TIMESTAMP OR used_at IS NOT NULL
      `
    );
  }

  private async obtenerResetToken(token: string) {
    const pool = obtenerPoolActual();
    const tokenHash = hashTokenSesion(token);

    const [rows] = await pool.query<PasswordResetRow[]>(
      `
        SELECT
          pr.id,
          pr.user_id,
          pr.token_hash,
          pr.expires_at,
          pr.used_at,
          u.username,
          u.email,
          u.nombre_mostrar
        FROM ${TABLA_PASSWORD_RESET} pr
        INNER JOIN ${TABLA_USUARIOS} u ON u.id = pr.user_id
        WHERE pr.token_hash = ?
          AND pr.used_at IS NULL
          AND pr.expires_at > CURRENT_TIMESTAMP
          AND u.activo = 1
        LIMIT 1
      `,
      [tokenHash]
    );

    return rows[0] ?? null;
  }

  private async bootstrapAdminSiHaceFalta() {
    const pool = obtenerPoolActual();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM ${TABLA_USUARIOS}`
    );

    const total = Number(rows[0]?.total ?? 0);
    if (total > 0) {
      return;
    }

    const password =
      entorno.auth.bootstrapPassword ||
      (!entorno.esProduccion && entorno.ambiente !== "test" ? "AdminLocal123!" : "");

    if (!password) {
      logger.warn("No se creo usuario bootstrap porque no hay AUTH_BOOTSTRAP_PASSWORD configurado");
      return;
    }

    const passwordHash = await hashPassword(password);

    await pool.query<ResultSetHeader>(
      `
        INSERT INTO ${TABLA_USUARIOS}
          (username, email, password_hash, nombre_mostrar, rol, regiones_json, activo)
        VALUES (?, ?, ?, ?, 'central', JSON_ARRAY(), 1)
      `,
      [
        entorno.auth.bootstrapUsername || "admin",
        entorno.auth.bootstrapEmail || "admin@local.test",
        passwordHash,
        "Administrador Local"
      ]
    );

    logger.info("Usuario administrador local creado para entorno de desarrollo");
  }
}

export const authServicio = new AuthServicio();
