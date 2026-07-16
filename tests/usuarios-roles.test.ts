import assert from "node:assert/strict";
import path from "node:path";

import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const testSuffix = `${Date.now()}`;
const usernames = [`admincentraltest_${testSuffix}`, `regionaltest_${testSuffix}`];

const config = {
  host: process.env.MYSQL_HOST ?? "localhost",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? "root",
  password: process.env.MYSQL_PASSWORD ?? "",
  database: process.env.MYSQL_DATABASE ?? "sesal_historico",
  charset: process.env.MYSQL_CHARSET ?? "utf8mb4"
};

const limpiarUsuariosPrueba = async (conn: mysql.Connection) => {
  await conn.query(`DELETE FROM app_usuarios WHERE username IN (?, ?)`, usernames);
};

(async () => {
  process.env.NODE_ENV = "test";

  const conn = await mysql.createConnection(config);

  try {
    await limpiarUsuariosPrueba(conn);

    const poolModule = await import("../src/base_datos/pool");
    const { usuariosServicio } = await import("../src/servicios/usuarios.servicio");

    await poolModule.inicializarPool();

    const central = await usuariosServicio.crearUsuarioRegional({
      nombre: "Admin Central Test",
      username: usernames[0],
      email: `${usernames[0]}@sesal.test`,
      passwordTemporal: "Temporal!2026",
      rol: "central",
      regiones: [],
      establecimientos: [],
      puedeVerSeguimiento: true
    } as never);

    assert.equal(central.usuario.rol, "central");
    assert.deepEqual(central.usuario.regiones, []);
    assert.equal(central.usuario.puedeVerSeguimiento, true);

    const regional = await usuariosServicio.crearUsuarioRegional({
      nombre: "Regional Test",
      username: usernames[1],
      email: `${usernames[1]}@sesal.test`,
      passwordTemporal: "Temporal!2026",
      rol: "regional",
      regiones: ["ATLANTIDA"],
      establecimientos: [],
      puedeVerSeguimiento: false
    } as never);

    const promovido = await usuariosServicio.actualizarUsuarioRegional({
      id: regional.usuario.id,
      nombre: "Regional Promovido",
      username: usernames[1],
      email: `${usernames[1]}@sesal.test`,
      estado: "activo",
      rol: "central",
      regiones: [],
      establecimientos: [],
      puedeVerSeguimiento: true
    } as never);

    assert.equal(promovido.rol, "central");
    assert.deepEqual(promovido.regiones, []);
    assert.equal(promovido.puedeVerSeguimiento, true);

    await poolModule.pool?.end();
  } finally {
    await limpiarUsuariosPrueba(conn).catch(() => undefined);
    await conn.end();
  }
})();
