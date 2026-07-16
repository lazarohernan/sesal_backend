const IDENTIFICADOR_MAX = 180;
const PASSWORD_MAX = 256;
const TOKEN_MAX = 256;
const IDENTIFICADOR_SEGURO = /^[a-zA-Z0-9._@+-]+$/;
const TOKEN_SEGURO = /^[a-zA-Z0-9_-]+$/;

export const normalizarIdentificadorAuth = (valor: unknown) => {
  if (typeof valor !== "string") {
    return "";
  }

  return valor.trim().toLowerCase();
};

export const esIdentificadorAuthValido = (valor: string) =>
  valor.length > 0 &&
  valor.length <= IDENTIFICADOR_MAX &&
  IDENTIFICADOR_SEGURO.test(valor);

export const normalizarTokenAuth = (valor: unknown) => {
  if (typeof valor !== "string") {
    return "";
  }

  return valor.trim();
};

export const esTokenAuthValido = (valor: string) =>
  valor.length >= 20 &&
  valor.length <= TOKEN_MAX &&
  TOKEN_SEGURO.test(valor);

export const leerPasswordAuth = (valor: unknown) =>
  typeof valor === "string" ? valor : "";

export const esPasswordAuthTamanoValido = (valor: string) =>
  valor.length > 0 && valor.length <= PASSWORD_MAX;
