import assert from "node:assert/strict";

import {
  CIE_PARTO_CATEGORIAS,
  construirCondicionAbortoCieSql,
  construirCondicionEmbarazoCieSql,
  construirEtiquetaCie,
  esCodigoCategoriaCie,
  esCodigoCategoriaParto,
  esEdadAdolescente,
  normalizarCodigoCie,
} from "../src/servicios/egresos-cie.util";

assert.equal(normalizarCodigoCie(" o80.x "), "O80X");
assert.equal(normalizarCodigoCie("A00.0"), "A000");

assert.equal(
  construirEtiquetaCie("A00.0", "Colera Debido A Vibrio Cholerae O1, Biotipo Cholerae"),
  "A00.0 Colera Debido A Vibrio Cholerae O1, Biotipo Cholerae"
);
assert.equal(construirEtiquetaCie("A00.0", ""), "A00.0");
assert.equal(construirEtiquetaCie("", "Dato basura"), "Sin diagnostico");

assert.deepEqual(CIE_PARTO_CATEGORIAS, ["O80", "O81", "O82", "O84"]);
assert.equal(esCodigoCategoriaParto("O80.0"), true);
assert.equal(esCodigoCategoriaParto("O84.X"), true);
assert.equal(esCodigoCategoriaParto("O10.0"), false);

assert.equal(esCodigoCategoriaCie("A09"), true);
assert.equal(esCodigoCategoriaCie("O72"), true);
assert.equal(esCodigoCategoriaCie("Z39"), true);
assert.equal(esCodigoCategoriaCie("A09.X"), false);
assert.equal(esCodigoCategoriaCie("A9"), false);

assert.equal(esEdadAdolescente(10, 4), true);
assert.equal(esEdadAdolescente(19, 4), true);
assert.equal(esEdadAdolescente(9, 4), false);
assert.equal(esEdadAdolescente(20, 4), false);
assert.equal(esEdadAdolescente(11, 3), false);

assert.match(construirCondicionEmbarazoCieSql("cie"), /cie\.B_EMBARAZO = 1/);
assert.match(construirCondicionAbortoCieSql("cie"), /O03%/);
assert.match(construirCondicionAbortoCieSql("cie"), /%ABORTO%/);
