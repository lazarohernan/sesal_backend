const assert = require('node:assert/strict');
const { test } = require('node:test');
const analytics = require('../src/servicios/pivot-analytics.servicio');
const pivot = require('../src/servicios/pivot.servicio');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const result = { datos: [], totalGeneral: null, aniosConsultados: [2025], metadata: {} };
const { crearPivotJob, obtenerPivotJob } = require('../src/servicios/pivot-jobs.servicio');
const payload = year => ({year,rows:['CONCEPTO_ORDENADO'],values:[{field:'TOTAL'}]});
test('resultado inmediato no pierde el log ni permite que processing sobrescriba completed', async () => {
  const insert = deferred(), processing = deferred(), calls = [];
  analytics.registrarInicioConsultaPivot = () => insert.promise;
  analytics.marcarConsultaPivotProcesando = async id => { calls.push(['processing', id]); await processing.promise; };
  analytics.registrarFinConsultaPivot = async (id, end) => { calls.push([end.status, id]); };
  pivot.ejecutarConsultaPivot = async () => result;
  const job = crearPivotJob(payload(2025));
  await tick();
  assert.equal(obtenerPivotJob(job.jobId).status, 'completed');
  assert.deepEqual(calls, []);
  insert.resolve('log-1'); await tick();
  assert.deepEqual(calls, [['processing','log-1']]);
  processing.resolve(); await tick();
  assert.deepEqual(calls, [['processing','log-1'],['completed','log-1']]);
  assert.equal(crearPivotJob(payload(2025)).jobId, job.jobId); // caché del job
});
test('fallo de telemetría no cambia un reporte exitoso', async () => {
  analytics.registrarInicioConsultaPivot = async () => { throw Error('simulado'); };
  analytics.marcarConsultaPivotProcesando = async () => { throw Error('simulado'); };
  analytics.registrarFinConsultaPivot = async () => { throw Error('simulado'); };
  pivot.ejecutarConsultaPivot = async () => result;
  const job = crearPivotJob(payload(2024)); await tick(); await tick();
  assert.equal(obtenerPivotJob(job.jobId).status,'completed');
});
test('fallo de consulta se registra después del INSERT tardío', async () => {
  const insert = deferred(), calls = [];
  analytics.registrarInicioConsultaPivot = () => insert.promise;
  analytics.marcarConsultaPivotProcesando = async id => { calls.push(['processing',id]); };
  analytics.registrarFinConsultaPivot = async (id,end) => {calls.push([end.status,id]);};
  pivot.ejecutarConsultaPivot = async () => {throw Error('consulta simulada');};
  const job = crearPivotJob(payload(2023)); await tick();
  assert.equal(obtenerPivotJob(job.jobId).status,'failed');
  insert.resolve('log-3'); await tick();
  assert.deepEqual(calls,[['processing','log-3'],['failed','log-3']]);
});
