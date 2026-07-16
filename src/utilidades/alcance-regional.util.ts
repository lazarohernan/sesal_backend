import type { UsuarioAutenticado } from "../servicios/auth.servicio";

export const REGION_CODE_TO_NAME: Record<number, string> = {
  1: "Región Sanitaria de Atlántida",
  2: "Región Sanitaria de Colón",
  3: "Región Sanitaria de Comayagua",
  4: "Región Sanitaria de Copán",
  5: "Región Sanitaria de Cortés",
  6: "Región Sanitaria de Choluteca",
  7: "Región Sanitaria de El Paraíso",
  8: "Región Sanitaria de Francisco Morazán",
  9: "Región Sanitaria de Gracias a Dios",
  10: "Región Sanitaria de Intibucá",
  11: "Región Sanitaria de Islas de la Bahía",
  12: "Región Sanitaria de La Paz",
  13: "Región Sanitaria de Lempira",
  14: "Región Sanitaria de Ocotepeque",
  15: "Región Sanitaria de Olancho",
  16: "Región Sanitaria de Santa Bárbara",
  17: "Región Sanitaria de Valle",
  18: "Región Sanitaria de Yoro",
  19: "Metropolitana del Distrito Central",
  20: "Metropolitana de San Pedro Sula"
};

const normalizarTexto = (valor: string) =>
  valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const NOMBRE_A_REGION = new Map<string, number>(
  Object.entries(REGION_CODE_TO_NAME).flatMap(([codigo, nombre]) => {
    const id = Number(codigo);
    const nombreAnterior = nombre.replace("Región Sanitaria de ", "Departamental de ");
    return [
      [normalizarTexto(nombre), id],
      [normalizarTexto(nombreAnterior), id]
    ] as Array<[string, number]>;
  })
);

export class AlcanceRegionalError extends Error {
  statusCode: number;
  codigo: string;

  constructor(message: string, statusCode = 403, codigo = "REGION_NO_AUTORIZADA") {
    super(message);
    this.name = "AlcanceRegionalError";
    this.statusCode = statusCode;
    this.codigo = codigo;
  }
}

const normalizarIdsRegion = (valor?: number | number[] | null) => {
  if (valor === undefined || valor === null) {
    return [] as number[];
  }

  const lista = Array.isArray(valor) ? valor : [valor];
  return Array.from(
    new Set(
      lista
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item >= 1 && item <= 20)
    )
  ).sort((a, b) => a - b);
};

export const obtenerRegionIdPorNombre = (nombre: string) => NOMBRE_A_REGION.get(normalizarTexto(nombre));

export const obtenerRegionesPermitidasUsuario = (usuario?: UsuarioAutenticado | null) => {
  if (!usuario || usuario.rol === "central") {
    return null;
  }

  const regiones = Array.from(
    new Set(
      (usuario.regiones ?? [])
        .map((region) => obtenerRegionIdPorNombre(region))
        .filter((region): region is number => typeof region === "number")
    )
  ).sort((a, b) => a - b);

  if (!regiones.length) {
    throw new AlcanceRegionalError(
      "El usuario regional no tiene regiones validas asignadas.",
      403,
      "REGIONES_NO_CONFIGURADAS"
    );
  }

  return regiones;
};

export const resolverRegionesPermitidas = (
  usuario: UsuarioAutenticado | undefined,
  regionesSolicitadas?: number | number[] | null
) => {
  const permitidas = obtenerRegionesPermitidasUsuario(usuario);
  const solicitadas = normalizarIdsRegion(regionesSolicitadas);

  if (!permitidas) {
    return solicitadas.length ? solicitadas : null;
  }

  if (!solicitadas.length) {
    return permitidas;
  }

  const interseccion = solicitadas.filter((region) => permitidas.includes(region));
  if (!interseccion.length) {
    throw new AlcanceRegionalError("La region solicitada no pertenece al alcance del usuario.");
  }

  return interseccion;
};

export const resolverRegionParaRegistro = (
  usuario: UsuarioAutenticado | undefined,
  regionSolicitada?: number | null
) => {
  const permitidas = obtenerRegionesPermitidasUsuario(usuario);

  if (!permitidas) {
    return regionSolicitada ?? null;
  }

  if (regionSolicitada === undefined || regionSolicitada === null) {
    if (permitidas.length === 1) {
      return permitidas[0];
    }

    throw new AlcanceRegionalError(
      "Debe indicar una region autorizada para este usuario.",
      400,
      "REGION_REQUERIDA"
    );
  }

  if (!permitidas.includes(regionSolicitada)) {
    throw new AlcanceRegionalError("La region solicitada no pertenece al alcance del usuario.");
  }

  return regionSolicitada;
};

export interface PivotFilterLike {
  field: string;
  values?: Array<string | number>;
}

export const aplicarFiltroRegionalPivot = <T extends PivotFilterLike>(filtros: T[] | undefined, regiones: number[] | null) => {
  if (!regiones?.length) {
    return filtros ?? [];
  }

  const filtrosBase = [...(filtros ?? [])];
  const indiceFiltroRegion = filtrosBase.findIndex((filtro) => filtro.field === "REGION");

  if (indiceFiltroRegion === -1) {
    filtrosBase.push({
      field: "REGION",
      values: regiones
    } as T);
    return filtrosBase;
  }

  const filtroRegion = filtrosBase[indiceFiltroRegion];
  const valoresOriginales = normalizarIdsRegion(filtroRegion.values as number[] | undefined);
  const valoresPermitidos = valoresOriginales.filter((valor) => regiones.includes(valor));

  if (!valoresPermitidos.length) {
    throw new AlcanceRegionalError("La region solicitada no pertenece al alcance del usuario.");
  }

  filtrosBase[indiceFiltroRegion] = {
    ...filtroRegion,
    values: valoresPermitidos
  };

  return filtrosBase;
};
