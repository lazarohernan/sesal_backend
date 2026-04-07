import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_FORMAT = "scrypt";

export const generarTokenSesion = () => randomBytes(32).toString("base64url");

export const hashTokenSesion = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");

export const hashPassword = async (password: string) => {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
  return `${PASSWORD_FORMAT}$${salt}$${derivedKey.toString("hex")}`;
};

export const verificarPassword = async (password: string, storedHash: string) => {
  const [format, salt, hashHex] = storedHash.split("$");
  if (format !== PASSWORD_FORMAT || !salt || !hashHex) {
    return false;
  }

  const expected = Buffer.from(hashHex, "hex");
  const derivedKey = (await scrypt(password, salt, expected.length)) as Buffer;

  if (derivedKey.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(derivedKey, expected);
};
