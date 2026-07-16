/* eslint-disable no-console */
const path = require("node:path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mysql = require("mysql2/promise");
const XLSX = require("xlsx");

const DEFAULT_INPUT = path.resolve(
  __dirname,
  "../../../Cambios/cambios2/EHO_BDR_CIE_ Catalogo.xlsx"
);

const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_INPUT;

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const textOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const normalizeDate = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 19).replace("T", " ");
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 19).replace("T", " ");
};

const getDbConfig = () => ({
  host: process.env.MYSQL_HOST ?? process.env.DB_HOST ?? "localhost",
  port: numberOrNull(process.env.MYSQL_PORT ?? process.env.DB_PORT) ?? 3306,
  user: process.env.MYSQL_USER ?? process.env.DB_USER ?? "root",
  password: process.env.MYSQL_PASSWORD ?? process.env.DB_PASSWORD ?? "",
  database: process.env.MYSQL_DATABASE ?? process.env.DB_NAME ?? "sesal_historico",
  charset: process.env.MYSQL_CHARSET ?? "utf8mb4",
});

const toRow = (row) => [
  textOrNull(row.C_CIE),
  textOrNull(row.D_CIE),
  numberOrNull(row.C_CIE_CAPITULO),
  numberOrNull(row.C_CIE_GRUPO),
  textOrNull(row.C_CIE_CATEGORIA),
  numberOrNull(row.C_SEXO),
  numberOrNull(row.C_EDAD_TIPO_MIN),
  numberOrNull(row.N_EDAD_MIN),
  numberOrNull(row.C_EDAD_TIPO_MAX),
  numberOrNull(row.N_EDAD_MAX),
  numberOrNull(row.B_MUERTE),
  numberOrNull(row.B_EMBARAZO),
  numberOrNull(row.B_UNICA),
  numberOrNull(row.B_PRINCIPAL),
  numberOrNull(row.B_APLICABLE),
  normalizeDate(row.F_ALTA),
  normalizeDate(row.F_BAJA),
];

const main = async () => {
  const workbook = XLSX.readFile(inputPath, { cellDates: true });
  const sheetName = workbook.SheetNames.includes("EHO_BDR_CIE")
    ? "EHO_BDR_CIE"
    : workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error("El archivo no contiene hojas.");
  }

  const rows = XLSX.utils
    .sheet_to_json(workbook.Sheets[sheetName], { defval: null })
    .map(toRow)
    .filter((row) => row[0]);

  const connection = await mysql.createConnection(getDbConfig());

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS EHO_BDR_CIE (
        C_CIE VARCHAR(12) NOT NULL,
        D_CIE VARCHAR(255) NULL,
        C_CIE_CAPITULO INT NULL,
        C_CIE_GRUPO INT NULL,
        C_CIE_CATEGORIA VARCHAR(12) NULL,
        C_SEXO INT NULL,
        C_EDAD_TIPO_MIN INT NULL,
        N_EDAD_MIN INT NULL,
        C_EDAD_TIPO_MAX INT NULL,
        N_EDAD_MAX INT NULL,
        B_MUERTE TINYINT NULL,
        B_EMBARAZO TINYINT NULL,
        B_UNICA TINYINT NULL,
        B_PRINCIPAL TINYINT NULL,
        B_APLICABLE TINYINT NULL,
        F_ALTA DATETIME NULL,
        F_BAJA DATETIME NULL,
        PRIMARY KEY (C_CIE),
        KEY idx_eho_bdr_cie_categoria (C_CIE_CATEGORIA),
        KEY idx_eho_bdr_cie_grupo (C_CIE_GRUPO)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.query("TRUNCATE TABLE EHO_BDR_CIE");

    const columns = [
      "C_CIE",
      "D_CIE",
      "C_CIE_CAPITULO",
      "C_CIE_GRUPO",
      "C_CIE_CATEGORIA",
      "C_SEXO",
      "C_EDAD_TIPO_MIN",
      "N_EDAD_MIN",
      "C_EDAD_TIPO_MAX",
      "N_EDAD_MAX",
      "B_MUERTE",
      "B_EMBARAZO",
      "B_UNICA",
      "B_PRINCIPAL",
      "B_APLICABLE",
      "F_ALTA",
      "F_BAJA",
    ];

    for (let index = 0; index < rows.length; index += 500) {
      const chunk = rows.slice(index, index + 500);
      await connection.query(
        `INSERT INTO EHO_BDR_CIE (${columns.join(", ")}) VALUES ?`,
        [chunk]
      );
    }

    console.log(`Catalogo CIE importado: ${rows.length} codigos desde ${inputPath}`);
  } finally {
    await connection.end();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
