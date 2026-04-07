import type { UsuarioAutenticado } from "../servicios/auth.servicio";

export const REGION_CODE_TO_NAME: Record<number, string> = {
  1: "Departamental de Atlántida",
  2: "Departamental de Colón",
  3: "Departamental de Comayagua",
  4: "Departamental de Copán",
  5: "Departamental de Cortés",
  6: "Departamental de Choluteca",
  7: "Departamental de El Paraíso",
  8: "Departamental de Francisco Morazán",
  9: "Departamental de Gracias a Dios",
  10: "Departamental de Intibucá",
  11: "Departamental de Islas de la Bahía",
  12: "Departamental de La Paz",
  13: "Departamental de Lempira",
  14: "Departamental de Ocotepeque",
  15: "Departamental de Olancho",
  16: "Departamental de Santa Bárbara",
  17: "Departamental de Valle",
  18: "Departamental de Yoro",
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
  Object.entries(REGION_CODE_TO_NAME).map(([codigo, nombre]) => [normalizarTexto(nombre), Number(codigo)])
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

export const obtenerDepartamentosDesdeRegiones = (regionIds: number[]) =>
  Array.from(
    new Set(
      regionIds.map((regionId) => {
        if (regionId === 19) return 8;
        if (regionId === 20) return 5;
        return regionId;
      })
    )
  ).sort((a, b) => a - b);

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

