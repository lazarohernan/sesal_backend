import fs from "node:fs/promises";
import path from "node:path";

const CONFIG_DIR = path.resolve(process.cwd(), ".bi-sesal");
const CONFIG_FILE = path.join(CONFIG_DIR, "database-config.json");
const CONFIG_DIR_MODE = 0o700;
const CONFIG_FILE_MODE = 0o600;

export interface ConfiguracionPersistida {
  host: string;
  port: number;
  username: string;
  database: string;
  ssl: boolean;
  passwordEncrypted: string;
  updatedAt: string;
}

const asegurarDirectorio = async () => {
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: CONFIG_DIR_MODE });
  await fs.chmod(CONFIG_DIR, CONFIG_DIR_MODE).catch(() => undefined);
};

export const obtenerDirectorioConfiguracion = () => CONFIG_DIR;

export const guardarConfiguracionPersistida = async (config: ConfiguracionPersistida) => {
  await asegurarDirectorio();
  const contenido = JSON.stringify(config, null, 2);
  await fs.writeFile(CONFIG_FILE, contenido, { encoding: "utf8", mode: CONFIG_FILE_MODE });
  await fs.chmod(CONFIG_FILE, CONFIG_FILE_MODE).catch(() => undefined);
};

export const leerConfiguracionPersistida = async (): Promise<ConfiguracionPersistida | null> => {
  try {
    const contenido = await fs.readFile(CONFIG_FILE, "utf8");
    return JSON.parse(contenido) as ConfiguracionPersistida;
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

export const eliminarConfiguracionPersistida = async () => {
  try {
    await fs.unlink(CONFIG_FILE);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
};
