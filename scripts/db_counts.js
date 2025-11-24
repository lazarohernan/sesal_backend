#!/usr/bin/env node
/*
  Quick DB counts script.
  Uses env from backend/.env to connect and prints a summary.
*/
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const cfg = {
  host: process.env.MYSQL_HOST || process.env.DB_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || process.env.DB_PORT || 3306),
  user: process.env.MYSQL_USER || process.env.DB_USER || 'root',
  password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || process.env.DB_NAME || '',
  connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT || 10000),
  charset: process.env.MYSQL_CHARSET || 'utf8mb4'
};

const q = async (conn, sql, params = []) => {
  const [rows] = await conn.query(sql, params);
  return rows;
};

(async () => {
  const conn = await mysql.createConnection(cfg);
  try {
    const db = cfg.database;
    const det = await q(
      conn,
      `SELECT TABLE_NAME, TABLE_ROWS
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME LIKE 'AT2_BDT_MENSUAL_DETALLE_%'
       ORDER BY TABLE_NAME`,
      [db]
    );

    const detalle = det.map(r => ({ table: r.TABLE_NAME, rowsApprox: Number(r.TABLE_ROWS || 0) }));
    const totalDetalleAprox = detalle.reduce((s, r) => s + r.rowsApprox, 0);
    const anios = detalle.map(d => {
      const m = /AT2_BDT_MENSUAL_DETALLE_(\d{4})/.exec(d.table);
      return m ? Number(m[1]) : null;
    }).filter(Boolean);

    const catNames = [
      'BAS_BDR_REGIONES',
      'BAS_BDR_DEPARTAMENTOS',
      'BAS_BDR_MUNICIPIOS',
      'BAS_BDR_US',
      'AT2_BDR_CONCEPTOS',
      'tablero_departamento_resumen'
    ];
    const catCounts = {};
    for (const name of catNames) {
      try {
        const r = await q(conn, `SELECT COUNT(*) AS c FROM \`${name}\``);
        catCounts[name] = Number(r?.[0]?.c || 0);
      } catch (e) {
        catCounts[name] = null;
      }
    }

    const summary = {
      database: db,
      detalleTablas: detalle,
      totalDetalleAprox,
      aniosDetectados: Array.from(new Set(anios)).sort(),
      catalogos: catCounts
    };

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await conn.end();
  }
})().catch((e) => {
  console.error('DB_COUNT_ERROR', e && e.message ? e.message : e);
  process.exit(1);
});
