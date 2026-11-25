/* Comparación de solo lectura. No inicia servidores ni ejecuta migraciones.
 * MYSQL_* y MYSQL_SSL_CA_FILE se reciben por entorno, nunca se imprimen.
 * node scripts/verificar-optimizacion-consultas.cjs /ruta/dist-anterior /ruta/dist-nuevo
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const roots = process.argv.slice(2).map(p => path.resolve(p));
assert.equal(roots.length, 2, 'Indicar dos directorios dist');
assert.notEqual(roots[0], roots[1], 'Las versiones deben ser distintas');
assert.ok(process.env.MYSQL_SSL_CA_FILE, 'Se requiere el certificado CA de RDS');
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
(async () => {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE, connectionLimit: 2,
    ssl: {ca: fs.readFileSync(process.env.MYSQL_SSL_CA_FILE, 'utf8')},
  });
  pool.on('connection', connection => {
    connection.query('SET SESSION max_execution_time=180000');
    connection.query('SET SESSION TRANSACTION READ ONLY');
  });
  try {
    for (const root of roots) require(path.join(root, 'base_datos/pool.js')).pool = pool;
    const values = ['Q_AT_ENFERMERA_AUX','Q_AT_ENFERMERA_PRO','Q_AT_MEDICO_ESP','Q_AT_MEDICO_GEN','TOTAL']
      .map(field => ({field, aggregation:'SUM'}));
    const cases = [
      ...[{anio:2025},{anio:2026,departamentoId:1},{anio:2025,regionIds:[1]},
        {anio:1900},{departamentoId:1,regionIds:[1]},{anio:2025,departamentoId:1,regionIds:[2]}]
        .map(params => ['egresos-tablero.servicio','obtenerIndicadoresTableroEgresos',params]),
      ...[
        {years:[2025],columns:[],filters:[{field:'REGION',values:[1]}]},
        {years:[2025],columns:['ANIO'],filters:[{field:'REGION',values:[1]}]},
        {years:[2025,2026],columns:['REGION'],filters:[{field:'CONCEPTO',values:['1']}]},
      ].map(params => ['pivot.servicio','ejecutarConsultaPivot',
        {...params, rows:['CONCEPTO_ORDENADO'],values,includeTotals:true}]),
    ];
    for (const [index, [moduleName, method, params]] of cases.entries()) {
      const results = [], ms = [];
      for (const root of roots) {
        const cache = require(path.join(root,'utilidades/cache.utilidad.js')).cache;
        if (moduleName === 'pivot.servicio') {
          cache.deleteByPrefix('pivot:query:');
          await require(path.join(root,'servicios/pivot.servicio.js')).resolverAniosConsultaPivot(params);
        } else { cache.deleteByPrefix('egresos-tablero:'); }
        const start = Date.now();
        results.push(await require(path.join(root,`servicios/${moduleName}.js`))[method](params));
        ms.push(Date.now()-start);
      }
      const equal = require('node:util').isDeepStrictEqual(canonical(results[0]),canonical(results[1]));
      console.log(JSON.stringify({case:index+1,module:moduleName,equal,ms}));
      assert.ok(equal, `Diferencia en caso ${index+1}; no desplegar`);
    }
  } finally { await pool.end(); }
})().catch(error => {
  console.error(error.code || error.name);
  process.exitCode = 1;
});
