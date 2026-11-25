const NIVEL_ESTABLECIMIENTO_ORDEN_ETIQUETA = new Map<string, number>([
  ["Hospital Básico", 1],
  ["Hospital General", 2],
  ["Hospital de Especialidades", 3],
  ["Instituto Hondureño de Seguridad Social", 4],
  ["Unidad de Atención Primaria en Salud", 5],
  ["Centro Integral de Salud", 6]
]);

const NOMBRES_MES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre"
] as const;

const MES_ORDEN_ETIQUETA = new Map(
  NOMBRES_MES.flatMap((nombre, index) => {
    const orden = index + 1;
    return [
      [nombre.toLowerCase(), orden],
      [nombre.slice(0, 3).toLowerCase(), orden]
    ];
  })
);

const esTotalColumna = (valor: string) => /^total(\b|\s|$)/i.test(valor.trim());

const ordenMesExacto = (segmento: string): number | null => {
  const limpio = segmento.trim().toLowerCase();
  if (!limpio) return null;

  const directo = MES_ORDEN_ETIQUETA.get(limpio);
  if (directo) return directo;

  const primerToken = limpio.split(/[\s_/\-·]+/)[0] ?? "";
  return MES_ORDEN_ETIQUETA.get(primerToken) ?? null;
};

const partesClaveColumna = (valor: string) => {
  const [dimensiones, medida] = valor.split(" · ").map((parte) => parte.trim());
  const segmentos = (dimensiones || valor)
    .split(" / ")
    .map((parte) => parte.trim())
    .filter(Boolean);
  return { segmentos, medida: medida || null };
};

const compararSegmentoColumna = (a: string, b: string) => {
  if (esTotalColumna(a) !== esTotalColumna(b)) {
    return esTotalColumna(a) ? 1 : -1;
  }

  const mesA = ordenMesExacto(a);
  const mesB = ordenMesExacto(b);
  if (mesA !== null || mesB !== null) {
    const comparacion = (mesA ?? 99) - (mesB ?? 99);
    if (comparacion !== 0) return comparacion;
  }

  const nivelA = NIVEL_ESTABLECIMIENTO_ORDEN_ETIQUETA.get(a);
  const nivelB = NIVEL_ESTABLECIMIENTO_ORDEN_ETIQUETA.get(b);
  if (nivelA !== undefined || nivelB !== undefined) {
    const comparacion = (nivelA ?? 99) - (nivelB ?? 99);
    if (comparacion !== 0) return comparacion;
  }

  const numeroA = Number(a);
  const numeroB = Number(b);
  if (a.trim() !== "" && b.trim() !== "" && Number.isFinite(numeroA) && Number.isFinite(numeroB)) {
    if (numeroA !== numeroB) return numeroA - numeroB;
  }

  return a.localeCompare(b, "es-HN", { numeric: true });
};

export const compararValoresColumnaPivot = (a: string, b: string) => {
  if (esTotalColumna(a) !== esTotalColumna(b)) {
    return esTotalColumna(a) ? 1 : -1;
  }

  const partesA = partesClaveColumna(a);
  const partesB = partesClaveColumna(b);
  const totalSegmentos = Math.max(partesA.segmentos.length, partesB.segmentos.length);

  for (let indice = 0; indice < totalSegmentos; indice += 1) {
    const comparacion = compararSegmentoColumna(
      partesA.segmentos[indice] ?? "",
      partesB.segmentos[indice] ?? ""
    );
    if (comparacion !== 0) return comparacion;
  }

  return (partesA.medida ?? "").localeCompare(partesB.medida ?? "", "es-HN", { numeric: true });
};

const DIMENSIONES_ORDEN_ESPECIAL = new Set([
  "MES",
  "ANIO",
  "NIVEL_ESTABLECIMIENTO",
  "CATEGORIA_ESTABLECIMIENTO"
]);

const claveTieneMes = (valor: string) =>
  partesClaveColumna(valor).segmentos.some((segmento) => ordenMesExacto(segmento) !== null);

export const ordenarValoresColumnaPivot = (
  valores: string[],
  _dimensionesColumnas: string[] = []
) => {
  return [...valores].sort((a, b) => compararValoresColumnaPivot(a, b));
};

export const ordenarValoresColumnaPivotSiAplica = (
  valores: string[],
  dimensionesColumnas: string[] = []
) => {
  const aplica =
    dimensionesColumnas.some((dimension) => DIMENSIONES_ORDEN_ESPECIAL.has(dimension)) ||
    valores.some(claveTieneMes);

  return aplica ? ordenarValoresColumnaPivot(valores, dimensionesColumnas) : [...valores];
};
