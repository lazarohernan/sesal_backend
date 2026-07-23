import assert from "node:assert/strict";

import {
  calcularTotalPacientesAtendidos,
  sincronizarTotalPacientesAtendidos,
  validarConsistenciaAt2r,
  type RegistroAt2Normalizado
} from "../src/utilidades/at2-reglas.util";

const fila = (
  concepto: number,
  enfermeraAux = 0,
  enfermeraPro = 0,
  medicoGen = 0,
  medicoEsp = 0
): RegistroAt2Normalizado => ({
  concepto,
  enfermeraAux,
  enfermeraPro,
  medicoGen,
  medicoEsp
});

const registros = Array.from({ length: 23 }, (_, index) => fila(index + 1));
registros[0] = fila(1, 2, 3, 5, 7);
registros[17] = fila(18, 11, 13, 17, 19);
registros[18] = fila(19, 999, 999, 999, 999);
registros[19] = fila(20, 5, 7, 11, 13);
registros[20] = fila(21, 8, 9, 11, 13);
registros[21] = fila(22, 6, 8, 12, 14);
registros[22] = fila(23, 7, 8, 10, 12);

assert.deepEqual(calcularTotalPacientesAtendidos(registros), {
  enfermeraAux: 13,
  enfermeraPro: 16,
  medicoGen: 22,
  medicoEsp: 26
});

assert.match(validarConsistenciaAt2r(registros, 92) ?? "", /1 al 18/);
sincronizarTotalPacientesAtendidos(registros);
assert.deepEqual(registros.find((registro) => registro.concepto === 19), fila(19, 13, 16, 22, 26));
assert.equal(validarConsistenciaAt2r(registros, 92), null);

const sinConcepto19 = registros.filter((registro) => registro.concepto !== 19);
sincronizarTotalPacientesAtendidos(sinConcepto19);
assert.deepEqual(
  sinConcepto19.find((registro) => registro.concepto === 19),
  fila(19, 13, 16, 22, 26)
);

const inconsistente = registros.map((registro) => ({ ...registro }));
const mujeres = inconsistente.find((registro) => registro.concepto === 20);
assert.ok(mujeres);
mujeres.enfermeraAux += 1;
assert.match(validarConsistenciaAt2r(inconsistente, 92) ?? "", /20 \+ 21/);
