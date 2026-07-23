export const CIE_PARTO_CATEGORIAS = ["O80", "O81", "O82", "O84"] as const;

export const normalizarCodigoCie = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/\*/g, "");

export const construirEtiquetaCie = (codigo: unknown, descripcion: unknown): string => {
  const codigoTexto = String(codigo ?? "").trim();
  const descripcionTexto = String(descripcion ?? "").trim();

  if (!codigoTexto) {
    return "Sin diagnostico";
  }

  return descripcionTexto ? `${codigoTexto} ${descripcionTexto}` : codigoTexto;
};

export const esCodigoCategoriaParto = (codigo: unknown): boolean => {
  const normalizado = normalizarCodigoCie(codigo);
  return CIE_PARTO_CATEGORIAS.some((categoria) => normalizado.startsWith(categoria));
};

export const esCodigoCategoriaCie = (codigo: unknown): boolean => {
  const normalizado = normalizarCodigoCie(codigo);
  return /^[A-Z]\d{2}$/.test(normalizado);
};

export const esEdadAdolescente = (edad: unknown, tipoEdad: unknown): boolean => {
  const edadNumero = Number(edad);
  const tipoEdadNumero = Number(tipoEdad);

  return tipoEdadNumero === 4 && edadNumero >= 10 && edadNumero <= 19;
};

/** Código CIE normalizado para condiciones SQL (sin puntos ni asteriscos). */
export const expresionCodigoCieNormalizadoSql = (alias: string) =>
  `REPLACE(REPLACE(UPPER(TRIM(${alias}.C_CIE)), '.', ''), '*', '')`;

/** Diagnósticos O80, O81, O82 y O84 asociados a un egreso con parto. */
export const construirCondicionPartoCieSql = (alias: string) => {
  const codigo = expresionCodigoCieNormalizadoSql(alias);
  return `(${CIE_PARTO_CATEGORIAS
    .map((categoria) => `${codigo} LIKE '${categoria}%'`)
    .join(" OR ")})`;
};

/** Diagnóstico de aborto según reporte municipal (generar_reporte.py). */
export const construirCondicionAbortoCieSql = (alias: string) => {
  const codigo = expresionCodigoCieNormalizadoSql(alias);
  return `(
    ${codigo} LIKE 'O03%'
    OR ${codigo} LIKE 'O04%'
    OR ${codigo} LIKE 'O05%'
    OR ${codigo} LIKE 'O06%'
    OR ${codigo} LIKE 'O07%'
    OR ${codigo} LIKE 'O08%'
    OR ${codigo} IN ('O021', 'O200', 'O311')
    OR UPPER(${alias}.D_CIE) LIKE '%ABORTO%'
  )`;
};

export const construirCondicionEmbarazoCieSql = (alias: string) => `${alias}.B_EMBARAZO = 1`;
