import mysql from "mysql2/promise";
import path from "node:path";

import { entorno } from "../configuracion/entorno";
import {
  eliminarConfiguracionPersistida,
  guardarConfiguracionPersistida,
  leerConfiguracionPersistida,
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

const encryptPassword = (password: string): string => Buffer.from(password, "utf8").toString("base64");
const decryptPassword = (passwordEncrypted: string): string =>
  Buffer.from(passwordEncrypted, "base64").toString("utf8");

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
  private readonly contextoId = path.basename(process.cwd());

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
        password: decryptPassword(guardada.passwordEncrypted)
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
      passwordEncrypted: encryptPassword(config.password),
      updatedAt: new Date().toISOString()
    };
    await guardarConfiguracionPersistida(payload);
  }

  setConfiguracionPersonalizada(config: DatabaseConfig | null) {
    this.configuracionPersonalizada = config ? normalizarConfig(config) : null;
  }

  async actualizarConfiguracion(config: DatabaseConfig) {
    this.setConfiguracionPersonalizada(config);
    await this.persistirConfiguracion(config);
  }

  limpiarConfiguracionPersonalizada() {
    this.configuracionPersonalizada = null;
  }

  async limpiarConfiguracionPersistida() {
    this.limpiarConfiguracionPersonalizada();
    await this.persistirConfiguracion(null);
  }

  estaUsandoConfiguracionPersonalizada(): boolean {
    return this.configuracionPersonalizada !== null;
  }

  obtenerInfoConfiguracion() {
    const config = this.obtenerConfiguracion();
    return {
      host: config.host,
      port: config.port,
      database: config.database,
      ssl: config.ssl,
      esPersonalizada: this.estaUsandoConfiguracionPersonalizada(),
      contextoId: this.contextoId,
      timestamp: new Date().toISOString()
    };
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

  crearPool() {
    const config = this.obtenerConfiguracion();
    const normalizado = normalizarConfig(config);
    return mysql.createPool({
      host: normalizado.host,
      port: normalizado.port,
      user: normalizado.username,
      password: normalizado.password,
      database: normalizado.database,
      ssl: normalizado.ssl
        ? {
            rejectUnauthorized: false
          }
        : undefined,
      waitForConnections: true,
      connectionLimit: entorno.baseDatos.maximoConexiones,
      queueLimit: entorno.baseDatos.limiteCola,
      connectTimeout: entorno.baseDatos.tiempoEsperaConexion,
      charset: entorno.baseDatos.conjuntoCaracteres
    });
  }

  async crearConexion() {
    const config = this.obtenerConfiguracion();
    const normalizado = normalizarConfig(config);
    return mysql.createConnection({
      host: normalizado.host,
      port: normalizado.port,
      user: normalizado.username,
      password: normalizado.password,
      database: normalizado.database,
      ssl: normalizado.ssl
        ? {
            rejectUnauthorized: false
          }
        : undefined,
      connectTimeout: entorno.baseDatos.tiempoEsperaConexion,
      charset: entorno.baseDatos.conjuntoCaracteres
    });
  }
}

export const configuracionBDServicio = new ConfiguracionBDServicio();
