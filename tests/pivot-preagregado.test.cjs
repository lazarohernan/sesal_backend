const assert = require('node:assert/strict');
const { test } = require('node:test');
const sql = require('../src/utilidades/mysql-consulta.utilidad');
const { cache, CACHE_KEYS } = require('../src/utilidades/cache.utilidad');
const { ejecutarConsultaPivot } = require('../src/servicios/pivot.servicio');
async function capture(overrides = {}) {
  cache.clear();
  cache.set(CACHE_KEYS.PERIODOS_DISPONIBLES,[{anio:2025,meses:[1]},{anio:2026,meses:[1]}]);
  const calls = [];
  sql.consultarSql = async (query, params) => {calls.push({query,params});return [];};
  await ejecutarConsultaPivot({years:[2025,2026],rows:['CONCEPTO_ORDENADO'],columns:[],
    values:[{field:'Q_AT_ENFERMERA_AUX',aggregation:'SUM'},{field:'TOTAL',aggregation:'SUM'}],
    filters:[{field:'REGION',values:[1]}],includeTotals:true,...overrides});
  return calls;
}
test('filtra antes de resumir y conserva parámetros en consulta y total',async()=>{
  const calls=await capture(); assert.equal(calls.length,2);
  for(const {query,params} of calls){
    assert.match(query,/FROM \(SELECT det\.C_US, det\.N_ANIO/);
    assert.match(query,/WHERE det\.N_ANIO IN \(\?, \?\) AND EXISTS[\s\S]*LEFT JOIN BAS_BDR_US us[\s\S]*WHERE COALESCE\(us\.C_REGION, det\.C_US\) IN \(\?\)[\s\S]*GROUP BY det\.C_US/);
    assert.deepEqual(params,[2025,2026,'1',2025,2026,'1']);
    assert.equal((query.match(/\?/g)||[]).length,params.length);
  }
});
test('AVG conserva la consulta original para no promediar sumas',async()=>{
  for(const {query} of await capture({values:[{field:'Q_AT_ENFERMERA_AUX',aggregation:'AVG'}]})){
    assert.doesNotMatch(query,/FROM \(SELECT det\.C_US, det\.N_ANIO/);
    assert.match(query,/AVG\(COALESCE\(det.Q_AT_ENFERMERA_AUX/);
  }
});
test('filtro de mes y desglose por mes no pierden su granularidad',async()=>{
  for(const overrides of [{filters:[{field:'MES',values:[1]}]},{columns:['MES']}]){
    for(const {query} of await capture(overrides))assert.doesNotMatch(query,/FROM \(SELECT det\.C_US, det\.N_ANIO/);
  }
});
test('filtro de concepto no agrega un join territorial que excluya registros',async()=>{
  const calls=await capture({filters:[{field:'CONCEPTO',values:['1']}]});
  for(const {query,params} of calls){
    const inner=query.slice(0,query.indexOf('GROUP BY det.C_US'));
    assert.doesNotMatch(inner,/JOIN BAS_BDR_US/);
    assert.deepEqual(params,[2025,2026,'1',2025,2026,'1']);
  }
});
