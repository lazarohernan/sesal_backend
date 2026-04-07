import type { FastifyRequest } from "fastify";

import { entorno } from "../configuracion/entorno";

const COOKIE_PATH = "Path=/";
const COOKIE_HTTP_ONLY = "HttpOnly";
const COOKIE_SAME_SITE = "SameSite=Lax";

const encodeCookieValue = (value: string) => encodeURIComponent(value);

export const construirCookieSesion = (token: string, maxAgeSeconds: number) => {
  const partes = [
    `${entorno.auth.cookieName}=${encodeCookieValue(token)}`,
    COOKIE_PATH,
    COOKIE_HTTP_ONLY,
    COOKIE_SAME_SITE,
    `Max-Age=${maxAgeSeconds}`
  ];

  if (entorno.auth.secureCookies) {
    partes.push("Secure");
  }

  return partes.join("; ");
};

export const construirCookieSesionExpirada = () => {
  const partes = [
    `${entorno.auth.cookieName}=`,
    COOKIE_PATH,
    COOKIE_HTTP_ONLY,
    COOKIE_SAME_SITE,
    "Max-Age=0"
  ];

  if (entorno.auth.secureCookies) {
    partes.push("Secure");
  }

  return partes.join("; ");
};

export const obtenerCookie = (request: FastifyRequest, name: string) => {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";");
  for (const rawCookie of cookies) {
    const [rawName, ...rawValueParts] = rawCookie.trim().split("=");
    if (rawName !== name) {
      continue;
    }

    return decodeURIComponent(rawValueParts.join("="));
  }

  return null;
};
