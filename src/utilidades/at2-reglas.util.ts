export const CONCEPTO_TOTAL_PACIENTES_ATENDIDOS = 19;
export const CODIGO_CONCEPTO_TOTAL_PACIENTES_ATENDIDOS =
  String(CONCEPTO_TOTAL_PACIENTES_ATENDIDOS);
export const CONCEPTO_EDAD_INICIO = 1;
export const CONCEPTO_EDAD_FIN = 18;

export type RegistroAt2Normalizado = {
  concepto: number;
  enfermeraAux: number;
  enfermeraPro: number;
  medicoGen: number;
  medicoEsp: number;
};

export const CAMPOS_RECURSO_AT2 = [
  { key: "enfermeraAux", label: "Enf. Aux." },
  { key: "enfermeraPro", label: "Enf. Prof." },
  { key: "medicoGen", label: "Med. Gral." },
  { key: "medicoEsp", label: "Med. Esp." }
] as const;

type CampoRecursoAt2 = (typeof CAMPOS_RECURSO_AT2)[number]["key"];

const formatearEntero = (valor: number) => valor.toLocaleString("es-HN");

export const calcularTotalPacientesAtendidos = (
  registros: RegistroAt2Normalizado[]
): Omit<RegistroAt2Normalizado, "concepto"> => {
  const total = {
    enfermeraAux: 0,
    enfermeraPro: 0,
    medicoGen: 0,
    medicoEsp: 0
  };

  for (const registro of registros) {
    if (registro.concepto < CONCEPTO_EDAD_INICIO || registro.concepto > CONCEPTO_EDAD_FIN) {
      continue;
    }
    for (const campo of CAMPOS_RECURSO_AT2) {
      total[campo.key] += registro[campo.key];
    }
  }

  return total;
};

export const sincronizarTotalPacientesAtendidos = (
  registros: RegistroAt2Normalizado[]
): RegistroAt2Normalizado[] => {
  const totalCalculado = calcularTotalPacientesAtendidos(registros);
  const filaExistente = registros.find(
    (registro) => registro.concepto === CONCEPTO_TOTAL_PACIENTES_ATENDIDOS
  );

  if (filaExistente) {
    Object.assign(filaExistente, totalCalculado);
  } else {
    registros.push({
      concepto: CONCEPTO_TOTAL_PACIENTES_ATENDIDOS,
      ...totalCalculado
    });
  }

  return registros;
};

export const validarConsistenciaAt2r = (
  registros: RegistroAt2Normalizado[],
  conceptoMaximo: number
): string | null => {
  if (conceptoMaximo < 23) return null;

  const porConcepto = new Map<number, RegistroAt2Normalizado>();
  registros.forEach((registro) => porConcepto.set(registro.concepto, registro));

  for (let concepto = CONCEPTO_EDAD_INICIO; concepto <= 23; concepto += 1) {
    if (!porConcepto.has(concepto)) {
      return `Debe enviar los conceptos 1 al 23 para validar los totales AT2R. Falta el concepto ${concepto}.`;
    }
  }

  const valor = (concepto: number, campo: CampoRecursoAt2) =>
    Number(porConcepto.get(concepto)?.[campo] ?? 0);

  for (const campo of CAMPOS_RECURSO_AT2) {
    let sumaEdad = 0;
    for (let concepto = CONCEPTO_EDAD_INICIO; concepto <= CONCEPTO_EDAD_FIN; concepto += 1) {
      sumaEdad += valor(concepto, campo.key);
    }
    const concepto19 = valor(CONCEPTO_TOTAL_PACIENTES_ATENDIDOS, campo.key);
    const mujeresHombres = valor(20, campo.key) + valor(21, campo.key);
    const espontaneasReferidas = valor(22, campo.key) + valor(23, campo.key);

    if (sumaEdad !== concepto19) {
      return `${campo.label}: la suma de conceptos 1 al 18 (${formatearEntero(sumaEdad)}) debe ser igual al concepto 19 (${formatearEntero(concepto19)}).`;
    }

    if (mujeresHombres !== concepto19) {
      return `${campo.label}: conceptos 20 + 21 (${formatearEntero(mujeresHombres)}) deben ser igual al concepto 19 (${formatearEntero(concepto19)}).`;
    }

    if (espontaneasReferidas !== concepto19) {
      return `${campo.label}: conceptos 22 + 23 (${formatearEntero(espontaneasReferidas)}) deben ser igual al concepto 19 (${formatearEntero(concepto19)}).`;
    }
  }

  return null;
};
