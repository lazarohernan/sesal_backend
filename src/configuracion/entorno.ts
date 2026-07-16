import dotenv from "dotenv";

dotenv.config();

const numero = (valor: string | undefined, predeterminado: number) => {
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : predeterminado;
};

const booleano = (valor: string | undefined, predeterminado: boolean) => {
  if (valor === undefined) return predeterminado;
  const normalizado = valor.trim().toLowerCase();
  if (["true", "1", "yes", "si", "on"].includes(normalizado)) return true;
  if (["false", "0", "no", "off"].includes(normalizado)) return false;
  return predeterminado;
};

const lista = (valor: string | undefined): string[] =>
  (valor ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const aniosPrecalentamiento = lista(process.env.CACHE_PREWARM_YEARS)
  .map((item) => Number(item))
  .filter((item) => Number.isInteger(item) && item >= 2000 && item <= 2100);

export const entorno = {
  ambiente: process.env.NODE_ENV ?? "desarrollo",
  esProduccion: process.env.NODE_ENV === "production",
  puerto: numero(process.env.PUERTO ?? process.env.PORT, 4000),
  cors: {
    origenes: lista(process.env.CORS_ORIGINS)
  },
  admin: {
    token: (process.env.ADMIN_TOKEN ?? process.env.API_ADMIN_TOKEN ?? "").trim()
  },
  auth: {
    cookieName: (process.env.AUTH_COOKIE_NAME ?? "bi_sesal_session").trim(),
    sessionTtlHours: Math.max(1, numero(process.env.AUTH_SESSION_TTL_HOURS, 12)),
    sessionRememberDays: Math.max(1, numero(process.env.AUTH_SESSION_REMEMBER_DAYS, 30)),
    secureCookies: booleano(process.env.AUTH_SECURE_COOKIE, process.env.NODE_ENV === "production"),
    bootstrapUsername: (process.env.AUTH_BOOTSTRAP_USERNAME ?? "admin").trim(),
    bootstrapEmail: (process.env.AUTH_BOOTSTRAP_EMAIL ?? "admin@local.test").trim(),
    bootstrapPassword: (process.env.AUTH_BOOTSTRAP_PASSWORD ?? "").trim(),
    resetTtlMinutes: Math.max(5, numero(process.env.AUTH_RESET_TTL_MINUTES, 30)),
    resetBaseUrl: (process.env.AUTH_RESET_BASE_URL ?? "http://localhost:3001/recuperar-password").trim()
  },
  baseDatos: {
    host: process.env.MYSQL_HOST ?? process.env.DB_HOST ?? "localhost",
    puerto: numero(process.env.MYSQL_PORT ?? process.env.DB_PORT, 3306),
    usuario: process.env.MYSQL_USER ?? process.env.DB_USER ?? "root",
    contrasena: process.env.MYSQL_PASSWORD ?? process.env.DB_PASSWORD ?? "",
    nombre: process.env.MYSQL_DATABASE ?? process.env.DB_NAME ?? "sesal_historico",
    maximoConexiones: numero(
      process.env.MYSQL_CONNECTION_LIMIT ?? process.env.DB_POOL_LIMIT,
      process.env.NODE_ENV === 'production' ? 50 : 20
    ),
    limiteCola: numero(process.env.MYSQL_QUEUE_LIMIT, 0),
    tiempoEsperaConexion: numero(
      process.env.MYSQL_CONNECT_TIMEOUT,
      10_000
    ),
    conjuntoCaracteres: process.env.MYSQL_CHARSET ?? "utf8mb4"
  },
  cache: {
    precalentar: booleano(process.env.ENABLE_CACHE_PREWARM, process.env.NODE_ENV === "production"),
    precalentarDelayMs: numero(process.env.CACHE_PREWARM_DELAY_MS, 3000),
    precalentarConcurrencia: Math.max(1, numero(process.env.CACHE_PREWARM_CONCURRENCY, 2)),
    precalentarAnios: aniosPrecalentamiento,
    precalentarEgresos: booleano(process.env.CACHE_PREWARM_EGRESOS, false)
  },
  trabajos: {
    pivotConcurrencia: Math.max(1, numero(process.env.PIVOT_JOB_CONCURRENCY, 1)),
    pivotMaxEnCola: Math.max(1, numero(process.env.PIVOT_JOB_MAX_QUEUE, 100)),
    pivotPollMs: Math.max(1000, numero(process.env.PIVOT_JOB_POLL_MS, 3000)),
    pivotResultadoTtlMs: Math.max(60_000, numero(process.env.PIVOT_JOB_TTL_MS, 6 * 60 * 60 * 1000))
  }
};
