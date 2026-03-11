import fs from "node:fs/promises";
import path from "node:path";

const CONFIG_DIR = path.resolve(process.cwd(), ".bi-sesal");
const CONFIG_FILE = path.join(CONFIG_DIR, "database-config.json");

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
  await fs.mkdir(CONFIG_DIR, { recursive: true });
};

export const obtenerRutaConfiguracion = () => CONFIG_FILE;

export const guardarConfiguracionPersistida = async (config: ConfiguracionPersistida) => {
  await asegurarDirectorio();
  const contenido = JSON.stringify(config, null, 2);
  await fs.writeFile(CONFIG_FILE, contenido, "utf8");
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
