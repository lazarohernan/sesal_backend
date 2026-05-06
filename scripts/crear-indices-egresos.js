const path = require("node:path");

const dotenv = require("dotenv");
const mysql = require("mysql2/promise");

const backendRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(backendRoot, ".env") });

const requiredEnv = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_USER", "MYSQL_DATABASE"];

const indexes = [
  {
    table: "EHO_BDT_EGR_GENERAL",
    name: "idx_egr_general_anio_us_mes",
    columns: ["N_ANIO", "C_US", "N_MES"],
  },
  {
    table: "EHO_BDT_EGR_GENERAL",
    name: "idx_egr_general_anio_mes",
    columns: ["N_ANIO", "N_MES"],
  },
  {
    table: "EHO_BDT_EGR_GENERAL",
    name: "idx_egr_general_anio_sexo",
    columns: ["N_ANIO", "C_PAC_SEXO"],
  },
  {
    table: "EHO_BDT_EGR_GENERAL",
    name: "idx_egr_general_anio_edad",
    columns: ["N_ANIO", "C_PAC_EDAD_TIPO", "N_PAC_EDAD"],
  },
  {
    table: "EHO_BDT_EGR_DIAGNOSTICOS",
    name: "idx_egr_diag_anio_us_mes",
    columns: ["N_ANIO", "C_US", "N_MES", "N_PAGINA"],
  },
  {
    table: "EHO_BDT_EGR_DIAGNOSTICOS",
    name: "idx_egr_diag_anio_mes",
    columns: ["N_ANIO", "N_MES"],
  },
  {
    table: "EHO_BDT_EGR_OPERACIONES",
    name: "idx_egr_op_anio_us_mes",
    columns: ["N_ANIO", "C_US", "N_MES", "N_PAGINA"],
  },
  {
    table: "EHO_BDT_EGR_OPERACIONES",
    name: "idx_egr_op_anio_mes",
    columns: ["N_ANIO", "N_MES"],
  },
  {
    table: "EHO_BDT_EGR_PARTOS",
    name: "idx_egr_partos_anio_us_mes",
    columns: ["N_ANIO", "C_US", "N_MES", "N_PAGINA"],
  },
  {
    table: "EHO_BDT_EGR_PARTOS",
    name: "idx_egr_partos_anio_mes",
    columns: ["N_ANIO", "N_MES"],
  },
];

const quoteIdentifier = (identifier) => `\`${identifier.replace(/`/g, "``")}\``;

const getMissingEnv = () =>
  requiredEnv.filter((name) => {
    const value = process.env[name];
    return value === undefined || value === "";
  });

const indexExists = async (connection, database, table, indexName) => {
  const [rows] = await connection.query(
    `
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = ?
        AND table_name = ?
        AND index_name = ?
      LIMIT 1
    `,
    [database, table, indexName]
  );

  return rows.length > 0;
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const missingEnv = getMissingEnv();
  if (missingEnv.length > 0) {
    throw new Error(`Faltan variables de entorno para MySQL: ${missingEnv.join(", ")}`);
  }

  const database = process.env.MYSQL_DATABASE;
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD || "",
    database,
    charset: process.env.MYSQL_CHARSET || "utf8mb4",
    connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT || 20000),
    multipleStatements: false,
  });

  try {
    console.log(dryRun ? "Validando índices de egresos (dry-run)..." : "Creando índices de egresos...");
    const startedAt = Date.now();

    for (const index of indexes) {
      const exists = await indexExists(connection, database, index.table, index.name);
      const columns = index.columns.map(quoteIdentifier).join(", ");
      const sql = `ALTER TABLE ${quoteIdentifier(index.table)} ADD INDEX ${quoteIdentifier(index.name)} (${columns})`;

      if (exists) {
        console.log(`SKIP ${index.table}.${index.name}`);
        continue;
      }

      if (dryRun) {
        console.log(`PENDING ${sql};`);
        continue;
      }

      const indexStartedAt = Date.now();
      console.log(`CREATE ${index.table}.${index.name}`);
      await connection.query(sql);
      console.log(`OK ${index.table}.${index.name} ${Date.now() - indexStartedAt}ms`);
    }

    console.log(
      JSON.stringify(
        {
          dryRun,
          durationMs: Date.now() - startedAt,
          indexes: indexes.length,
        },
        null,
        2
      )
    );
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error("No se pudieron preparar los índices de egresos.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
