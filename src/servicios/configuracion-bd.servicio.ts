import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { entorno } from "../configuracion/entorno";
import {
  eliminarConfiguracionPersistida,
  guardarConfiguracionPersistida,
  leerConfiguracionPersistida,
  obtenerDirectorioConfiguracion,
  type ConfiguracionPersistida
} from "../utilidades/configuracion-archivo.utilidad";

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl: boolean;
}

const CONFIG_KEY_FILE = path.join(obtenerDirectorioConfiguracion(), "config.key");
const CONFIG_KEY_FILE_MODE = 0o600;
const PASSWORD_ENCRYPTION_VERSION = "aes-256-gcm:v1";
const PASSWORD_LEGACY_ENCODING = "legacy-base64";

const derivarClave = (material: Buffer | string) =>
  scryptSync(material, "bi-sesal-db-config", 32);

const obtenerClavePersistencia = async () => {
  const secretDesdeEntorno = process.env.APP_CONFIG_SECRET?.trim();
  if (secretDesdeEntorno) {
    return derivarClave(secretDesdeEntorno);
  }

  await fs.mkdir(obtenerDirectorioConfiguracion(), { recursive: true, mode: 0o700 });
  await fs.chmod(obtenerDirectorioConfiguracion(), 0o700).catch(() => undefined);

  try {
    const existente = await fs.readFile(CONFIG_KEY_FILE, "utf8");
    return derivarClave(Buffer.from(existente.trim(), "base64"));
  } catch (error: unknown) {
    const errorCode = typeof error === "object" && error && "code" in error
      ? String((error as { code?: string }).code)
      : "";
    if (errorCode !== "ENOENT") {
      throw error;
    }
  }

  const nuevaClave = randomBytes(32);
  await fs.writeFile(CONFIG_KEY_FILE, nuevaClave.toString("base64"), {
    encoding: "utf8",
    mode: CONFIG_KEY_FILE_MODE
  });
  await fs.chmod(CONFIG_KEY_FILE, CONFIG_KEY_FILE_MODE).catch(() => undefined);
  return derivarClave(nuevaClave);
};

const encryptPassword = async (password: string): Promise<string> => {
  const key = await obtenerClavePersistencia();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    PASSWORD_ENCRYPTION_VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64")
  ].join(":");
};

const decryptPassword = async (passwordEncrypted: string): Promise<string> => {
  if (passwordEncrypted.startsWith(`${PASSWORD_ENCRYPTION_VERSION}:`)) {
    const payload = passwordEncrypted.slice(PASSWORD_ENCRYPTION_VERSION.length + 1);
    const [ivBase64, tagBase64, encryptedBase64] = payload.split(":");
    if (!ivBase64 || !tagBase64 || !encryptedBase64) {
      throw new Error("La configuración cifrada de base de datos está incompleta.");
    }

    const key = await obtenerClavePersistencia();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivBase64, "base64")
    );
    decipher.setAuthTag(Buffer.from(tagBase64, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedBase64, "base64")),
      decipher.final()
    ]);
    return decrypted.toString("utf8");
  }

  if (passwordEncrypted.startsWith(`${PASSWORD_LEGACY_ENCODING}:`)) {
    return Buffer.from(passwordEncrypted.slice(PASSWORD_LEGACY_ENCODING.length + 1), "base64").toString("utf8");
  }

  return Buffer.from(passwordEncrypted, "base64").toString("utf8");
};

const normalizarConfig = (config: DatabaseConfig): DatabaseConfig => ({
  host: config.host.trim(),
  port: Number.isFinite(config.port) ? config.port : 3306,
  username: config.username.trim(),
  password: config.password ?? "",
  database: config.database.trim(),
  ssl: Boolean(config.ssl)
});

class ConfiguracionBDServicio {
  private configuracionPersonalizada: DatabaseConfig | null = null;
  private persistenciaCargada = false;

  private obtenerConfigPorDefecto(): DatabaseConfig {
    return {
      host: entorno.baseDatos.host,
      port: entorno.baseDatos.puerto,
      username: entorno.baseDatos.usuario,
      password: entorno.baseDatos.contrasena,
      database: entorno.baseDatos.nombre,
      ssl: false
    };
  }

  async cargarConfiguracionPersistida() {
    if (this.persistenciaCargada) return;
    this.persistenciaCargada = true;
    const guardada = await leerConfiguracionPersistida();
    if (guardada) {
      this.configuracionPersonalizada = {
        host: guardada.host,
        port: guardada.port,
        username: guardada.username,
        database: guardada.database,
        ssl: guardada.ssl,
        password: await decryptPassword(guardada.passwordEncrypted)
      };
    }
  }

  obtenerConfiguracion(): DatabaseConfig {
    if (this.configuracionPersonalizada) {
      return this.configuracionPersonalizada;
    }
    return this.obtenerConfigPorDefecto();
  }

  async persistirConfiguracion(config: DatabaseConfig | null) {
    if (!config) {
      await eliminarConfiguracionPersistida();
      return;
    }

    const payload: ConfiguracionPersistida = {
      host: config.host,
      port: config.port,
      username: config.username,
      database: config.database,
      ssl: Boolean(config.ssl),
      passwordEncrypted: await encryptPassword(config.password),
      updatedAt: new Date().toISOString()
    };
    await guardarConfiguracionPersistida(payload);
  }

  async actualizarConfiguracion(config: DatabaseConfig) {
    const normalizada = normalizarConfig(config);
    await this.persistirConfiguracion(normalizada);
    this.configuracionPersonalizada = normalizada;
  }

  limpiarConfiguracionPersonalizada() {
    this.configuracionPersonalizada = null;
  }

  async limpiarConfiguracionPersistida() {
    await this.persistirConfiguracion(null);
    this.limpiarConfiguracionPersonalizada();
  }

  obtenerConfiguracionPersistidaSanitizada() {
    if (!this.configuracionPersonalizada) return null;
    const { password, ...resto } = this.configuracionPersonalizada;
    return {
      ...resto,
      ssl: Boolean(resto.ssl),
      tienePassword: Boolean(password)
    };
  }
}

export const configuracionBDServicio = new ConfiguracionBDServicio();
