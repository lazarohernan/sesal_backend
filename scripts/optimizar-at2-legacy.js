const path = require("node:path");

const dotenv = require("dotenv");
const mysql = require("mysql2/promise");

const backendRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(backendRoot, ".env") });

const requiredEnv = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_USER", "MYSQL_DATABASE"];

const detailIndexDefinitions = [
  { name: "idx_detalle_c_us", columns: ["C_US"] },
  { name: "idx_detalle_mes", columns: ["N_MES"] },
  { name: "idx_detalle_servicio", columns: ["C_SERVICIO"] },
  { name: "idx_detalle_formulario", columns: ["V_FORMULARIO"] },
  { name: "idx_detalle_compuesto", columns: ["C_US", "N_MES", "C_SERVICIO"] },
  { name: "idx_detalle_anio_us", columns: ["N_ANIO", "C_US"] },
  { name: "idx_detalle_anio_concepto", columns: ["N_ANIO", "C_CONCEPTO"] },
  { name: "idx_detalle_concepto", columns: ["C_CONCEPTO"] },
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

const getColumns = async (connection, database, table) => {
  const [rows] = await connection.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ?
        AND table_name = ?
    `,
    [database, table]
  );

  return new Set(rows.map((row) => row.COLUMN_NAME || row.column_name));
};

const getDetailTables = async (connection, database) => {
  const [rows] = await connection.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ?
        AND table_name REGEXP '^AT2_BDT_MENSUAL_DETALLE_[0-9]{4}$'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `,
    [database]
  );

  return rows.map((row) => row.TABLE_NAME || row.table_name);
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const analyze = !process.argv.includes("--skip-analyze");
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
    const startedAt = Date.now();
    const detailTables = await getDetailTables(connection, database);
    console.log(
      dryRun
        ? `Validando índices AT2 legacy (${detailTables.length} tablas, dry-run)...`
        : `Optimizando índices AT2 legacy (${detailTables.length} tablas)...`
    );

    let created = 0;
    let skipped = 0;
    let pending = 0;

    for (const table of detailTables) {
      const columns = await getColumns(connection, database, table);

      for (const index of detailIndexDefinitions) {
        if (!index.columns.every((column) => columns.has(column))) {
          skipped++;
          console.log(`SKIP ${table}.${index.name} columnas no disponibles`);
          continue;
        }

        const exists = await indexExists(connection, database, table, index.name);
        const columnsSql = index.columns.map(quoteIdentifier).join(", ");
        const sql = `ALTER TABLE ${quoteIdentifier(table)} ADD INDEX ${quoteIdentifier(index.name)} (${columnsSql})`;

        if (exists) {
          skipped++;
          continue;
        }

        if (dryRun) {
          pending++;
          console.log(`PENDING ${sql};`);
          continue;
        }

        const indexStartedAt = Date.now();
        console.log(`CREATE ${table}.${index.name}`);
        await connection.query(sql);
        created++;
        console.log(`OK ${table}.${index.name} ${Date.now() - indexStartedAt}ms`);
      }
    }

    if (analyze) {
      for (const table of detailTables) {
        if (dryRun) {
          console.log(`PENDING ANALYZE TABLE ${quoteIdentifier(table)};`);
          continue;
        }
        const analyzeStartedAt = Date.now();
        await connection.query(`ANALYZE TABLE ${quoteIdentifier(table)}`);
        console.log(`ANALYZE ${table} ${Date.now() - analyzeStartedAt}ms`);
      }
    }

    console.log(
      JSON.stringify(
        {
          dryRun,
          analyze,
          durationMs: Date.now() - startedAt,
          tables: detailTables.length,
          created,
          pending,
          skipped,
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
  console.error("No se pudo optimizar AT2 legacy.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
