import dotenv from "dotenv";

dotenv.config();

const numero = (valor: string | undefined, predeterminado: number) => {
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : predeterminado;
};

export const entorno = {
  ambiente: process.env.NODE_ENV ?? "desarrollo",
  puerto: numero(process.env.PUERTO ?? process.env.PORT, 4000),
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
  tablero: {
    tablaHechos: process.env.DB_FACT_TABLE ?? "fact_transactions",
    columnaMonto: process.env.DB_AMOUNT_COLUMN ?? "amount",
    columnaFecha: process.env.DB_DATE_COLUMN ?? "transaction_date",
    columnaCategoria: process.env.DB_CATEGORY_COLUMN ?? "category"
  }
};
