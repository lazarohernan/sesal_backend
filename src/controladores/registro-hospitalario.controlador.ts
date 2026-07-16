import type { FastifyRequest, FastifyReply } from "fastify";
import type { RowDataPacket, OkPacket } from "mysql2";
import { obtenerPoolActual } from "../base_datos/pool";
import { AlcanceRegionalError, obtenerRegionesPermitidasUsuario, resolverRegionParaRegistro } from "../utilidades/alcance-regional.util";
import { logger } from "../utilidades/registro.utilidad";
import { seguimientoServicio } from "../servicios/seguimiento.servicio";
import { obtenerTablaDetalleAt2 } from "../servicios/at2-detalle-fuente.servicio";

// -- Versión activa del formulario AT2R --

export type VersionFormularioAt2 = '1' | '2';

const CONCEPTO_MAX_V1 = 52;
const CONCEPTO_MAX_V2 = 92;
const V_FORMULARIO_V1 = '3';
const V_FORMULARIO_V2 = '4';
const CLAVE_CONFIG_VERSION = 'AT2_VERSION_FORMULARIO';

export const obtenerVersionFormularioAt2 = async (): Promise<VersionFormularioAt2> => {
  const pool = obtenerPoolActual();
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT VALOR FROM BAS_BDP_SISTEMA WHERE VARIABLE = ? LIMIT 1',
    [CLAVE_CONFIG_VERSION]
  );
  const valor = rows[0]?.VALOR;
  return valor === '2' ? '2' : '1';
};

export const guardarVersionFormularioAt2 = async (version: VersionFormularioAt2): Promise<void> => {
  const pool = obtenerPoolActual();
  await pool.query<OkPacket>(
    `INSERT INTO BAS_BDP_SISTEMA (VARIABLE, VALOR) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE VALOR = VALUES(VALOR)`,
    [CLAVE_CONFIG_VERSION, version]
  );
};

const vFormularioPorVersion = (v: VersionFormularioAt2) =>
  v === '2' ? V_FORMULARIO_V2 : V_FORMULARIO_V1;

const conceptoMaxPorVersion = (v: VersionFormularioAt2) =>
  v === '2' ? CONCEPTO_MAX_V2 : CONCEPTO_MAX_V1;

const conceptoMaxPorAnio = (anio: number) =>
  anio >= 2026 ? CONCEPTO_MAX_V2 : CONCEPTO_MAX_V1;

const vFormularioPorAnio = (anio: number) =>
  anio >= 2026 ? V_FORMULARIO_V2 : V_FORMULARIO_V1;

const versionFormularioPorAnio = (anio: number): VersionFormularioAt2 =>
  anio >= 2026 ? '2' : '1';

// -- Validacion y sanitizacion --

const REGION_MIN = 1;
const REGION_MAX = 20;
const MES_MIN = 1;
const MES_MAX = 12;
const ANIO_MIN = 2025;
const ANIO_MAX = 2099;
const CONCEPTO_MIN = 1;
const VALOR_MAX = 999999;

const SERVICIOS_VALIDOS = new Set(['consulta_externa', 'emergencia']);

const sanitizarServicio = (valor: unknown): 'consulta_externa' | 'emergencia' | null => {
  if (valor === undefined || valor === null) return null;
  const texto = String(valor).trim().toLowerCase();
  return SERVICIOS_VALIDOS.has(texto) ? (texto as 'consulta_externa' | 'emergencia') : null;
};

// Niveles de establecimiento que corresponden a hospitales (HB=1, HG=2, HESP=3)
const NIVELES_HOSPITAL = [1, 2, 3];

const esCodigoHospital = async (rups: string): Promise<boolean> => {
  const pool = obtenerPoolActual();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM BAS_BDR_US WHERE CAST(C_US AS CHAR) = ? AND C_NIVEL_US IN (${NIVELES_HOSPITAL.join(',')}) LIMIT 1`,
    [rups]
  );
  return rows.length > 0;
};

const sanitizarEntero = (valor: unknown, min: number, max: number): number | null => {
  const num = Number(valor);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  if (num < min || num > max) return null;
  return num;
};

const sanitizarValorNumerico = (valor: unknown): number => {
  const num = Number(valor);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.min(Math.floor(num), VALOR_MAX);
};

type RegistroAt2Normalizado = {
  concepto: number;
  enfermeraAux: number;
  enfermeraPro: number;
  medicoGen: number;
  medicoEsp: number;
};

const CAMPOS_RECURSO_AT2 = [
  { key: "enfermeraAux", label: "Enf. Aux." },
  { key: "enfermeraPro", label: "Enf. Prof." },
  { key: "medicoGen", label: "Med. Gral." },
  { key: "medicoEsp", label: "Med. Esp." }
] as const;

const formatearEntero = (valor: number) => valor.toLocaleString("es-HN");

const validarConsistenciaAt2r = (
  registros: RegistroAt2Normalizado[],
  conceptoMaximo: number
): string | null => {
  if (conceptoMaximo < 23) return null;

  const porConcepto = new Map<number, RegistroAt2Normalizado>();
  registros.forEach((registro) => porConcepto.set(registro.concepto, registro));

  for (let concepto = 1; concepto <= 23; concepto += 1) {
    if (!porConcepto.has(concepto)) {
      return `Debe enviar los conceptos 1 al 23 para validar los totales AT2R. Falta el concepto ${concepto}.`;
    }
  }

  const valor = (concepto: number, campo: keyof RegistroAt2Normalizado) =>
    Number(porConcepto.get(concepto)?.[campo] ?? 0);

  for (const campo of CAMPOS_RECURSO_AT2) {
    const sumaEdad = Array.from({ length: 18 }, (_, index) => index + 1)
      .reduce((total, concepto) => total + valor(concepto, campo.key), 0);
    const concepto19 = valor(19, campo.key);
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

const sanitizarCodigoRups = (valor: unknown): string | null => {
  if (valor === undefined || valor === null) return null;
  const texto = String(valor).trim();
  return /^\d+$/.test(texto) ? texto : null;
};

const validarRupsPerteneceARegion = async (
  rups: string,
  regionId: number
) => {
  const pool = obtenerPoolActual();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
      CAST(C_US AS CHAR) AS rups,
      C_REGION AS region,
      D_US AS establecimiento
     FROM BAS_BDR_US
     WHERE CAST(C_US AS CHAR) = ?
     LIMIT 1`,
    [rups]
  );

  const registro = rows[0];
  if (!registro) {
    throw new AlcanceRegionalError(
      "El codigo RUPS indicado no existe en el catalogo de establecimientos.",
      400,
      "ESTABLECIMIENTO_INVALIDO"
    );
  }

  const regionEstablecimiento = Number(registro.region);
  if (!Number.isInteger(regionEstablecimiento) || regionEstablecimiento !== regionId) {
    throw new AlcanceRegionalError(
      "El establecimiento indicado no pertenece a la region seleccionada o autorizada.",
      403,
      "ESTABLECIMIENTO_NO_AUTORIZADO"
    );
  }

  return {
    rups: String(registro.rups),
    region: regionEstablecimiento,
    establecimiento: typeof registro.establecimiento === "string" ? registro.establecimiento.trim() : null
  };
};

// -- POST /api/registro-hospitalario --

export const guardarRegistroControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const esEdicion = request.method === "PUT";
    const { region, anio, mes, registros, establecimiento, establecimientoCodigo, rups, servicio } = request.body as any;

    // Validar campos requeridos
    const regionFueEnviado = region !== undefined && region !== null && region !== "";
    const regionSolicitada = regionFueEnviado ? sanitizarEntero(region, REGION_MIN, REGION_MAX) : null;
    if (regionFueEnviado && regionSolicitada === null) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: `El campo 'region' debe ser un entero entre ${REGION_MIN} y ${REGION_MAX}`
      });
    }

    const regionVal = resolverRegionParaRegistro(request.usuarioActual, regionSolicitada);
    if (regionVal === null) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: `El campo 'region' debe ser un entero entre ${REGION_MIN} y ${REGION_MAX}`
      });
    }

    const anioVal = sanitizarEntero(anio, ANIO_MIN, ANIO_MAX);
    if (anioVal === null) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: `El campo 'anio' debe ser un entero entre ${ANIO_MIN} y ${ANIO_MAX}`
      });
    }

    const mesVal = sanitizarEntero(mes, MES_MIN, MES_MAX);
    if (mesVal === null) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: `El campo 'mes' debe ser un entero entre ${MES_MIN} y ${MES_MAX}`
      });
    }

    const versionActiva = versionFormularioPorAnio(anioVal);
    const conceptoMaxActual = conceptoMaxPorAnio(anioVal);
    const vFormularioActual = vFormularioPorAnio(anioVal);

    if (!Array.isArray(registros) || registros.length === 0 || registros.length > conceptoMaxActual) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: `El campo 'registros' debe ser un array de 1 a ${conceptoMaxActual} elementos (versión ${versionActiva} para ${anioVal})`
      });
    }

    const codigoRups =
      sanitizarCodigoRups(establecimientoCodigo) ??
      sanitizarCodigoRups(establecimiento) ??
      sanitizarCodigoRups(rups);

    const usarRegistroPorEstablecimiento = anioVal >= 2026;
    const identificadorRegistro = usarRegistroPorEstablecimiento ? codigoRups : String(regionVal);

    if (usarRegistroPorEstablecimiento && !identificadorRegistro) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "Para 2026 en adelante debe indicar un establecimiento valido mediante su codigo RUPS."
      });
    }

    if (usarRegistroPorEstablecimiento && identificadorRegistro) {
      await validarRupsPerteneceARegion(identificadorRegistro, regionVal);
    }

    const esHospital = identificadorRegistro ? await esCodigoHospital(identificadorRegistro) : false;
    const servicioVal = sanitizarServicio(servicio);

    if (esHospital && !servicioVal) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "Este establecimiento es un hospital. Debe indicar el servicio: 'consulta_externa' o 'emergencia'."
      });
    }

    // C_SERVICIO: histórico usa '1'=Consulta Externa, '2'=Emergencia
    const cServicio = esHospital
      ? (servicioVal === 'emergencia' ? '2' : '1')
      : '1';

    // Sanitizar cada registro
    const conceptosVistos = new Set<number>();
    const registrosNormalizados: RegistroAt2Normalizado[] = [];

    for (const registro of registros) {
      const concepto = sanitizarEntero(registro.concepto, CONCEPTO_MIN, conceptoMaxActual);
      if (concepto === null) {
        return reply.status(400).send({
          codigo: "PARAMETRO_INVALIDO",
          mensaje: `Concepto inválido: debe ser entre ${CONCEPTO_MIN} y ${conceptoMaxActual} (versión ${versionActiva} para ${anioVal})`
        });
      }

      if (conceptosVistos.has(concepto)) {
        return reply.status(400).send({
          codigo: "PARAMETRO_INVALIDO",
          mensaje: `Concepto duplicado: ${concepto}`
        });
      }
      conceptosVistos.add(concepto);

      const enfermeraAux = sanitizarValorNumerico(registro.enfermeraAux);
      const enfermeraPro = sanitizarValorNumerico(registro.enfermeraPro);
      const medicoGen = sanitizarValorNumerico(registro.medicoGen);
      const medicoEsp = sanitizarValorNumerico(registro.medicoEsp);

      registrosNormalizados.push({
        concepto,
        enfermeraAux,
        enfermeraPro,
        medicoGen,
        medicoEsp
      });
    }

    const errorConsistencia = validarConsistenciaAt2r(registrosNormalizados, conceptoMaxActual);
    if (errorConsistencia) {
      return reply.status(400).send({
        codigo: "TOTALES_AT2R_INVALIDOS",
        mensaje: errorConsistencia
      });
    }

    const filas: Array<[string, number, number, string, string, null, string, number, number, number, number]> = [];

    for (const registro of registrosNormalizados) {
      // Solo insertar si tiene al menos un valor > 0
      if (registro.enfermeraAux + registro.enfermeraPro + registro.medicoGen + registro.medicoEsp > 0 && identificadorRegistro) {
        filas.push([
          identificadorRegistro,
          anioVal,               // N_ANIO
          mesVal,                // N_MES
          cServicio,             // C_SERVICIO
          String(registro.concepto), // C_CONCEPTO
          null,                  // V_US
          vFormularioActual,     // V_FORMULARIO ('3'=v1/52, '4'=v2/92)
          registro.enfermeraAux,
          registro.enfermeraPro,
          registro.medicoGen,
          registro.medicoEsp
        ]);
      }
    }

    if (filas.length === 0) {
      return reply.status(400).send({
        codigo: "SIN_DATOS",
        mensaje: "No se encontraron valores numéricos para guardar"
      });
    }

    const pool = obtenerPoolActual();
    const tablaDetalle = obtenerTablaDetalleAt2(anioVal);
    if (anioVal >= 2026 && identificadorRegistro) {
      await seguimientoServicio.asegurarTabla();
    }

    const [registrosExistentes] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total
       FROM ${tablaDetalle}
       WHERE C_US = ? AND N_ANIO = ? AND N_MES = ? AND C_SERVICIO = ? AND V_FORMULARIO = ?`,
      [identificadorRegistro, anioVal, mesVal, cServicio, vFormularioActual]
    );
    const totalExistente = Number(registrosExistentes[0]?.total ?? 0);

    if (totalExistente > 0 && !esEdicion) {
      return reply.status(409).send({
        codigo: "REGISTRO_DUPLICADO",
        mensaje: "Establecimiento de salud digitado, solo se permiten modificaciones o eliminacion.",
        datos: {
          region: regionVal,
          establecimiento: identificadorRegistro,
          anio: anioVal,
          mes: mesVal,
          servicio: cServicio,
          conceptosExistentes: totalExistente
        }
      });
    }

    if (totalExistente === 0 && esEdicion) {
      return reply.status(404).send({
        codigo: "REGISTRO_NO_EXISTE",
        mensaje: "No existe un registro previo para modificar."
      });
    }

    // Transacción: POST crea registros nuevos; PUT reemplaza un registro existente confirmado.
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      if (esEdicion) {
        await conn.query(
          `DELETE FROM ${tablaDetalle} WHERE C_US = ? AND N_ANIO = ? AND N_MES = ? AND C_SERVICIO = ? AND V_FORMULARIO = ?`,
          [identificadorRegistro, anioVal, mesVal, cServicio, vFormularioActual]
        );
      }

      const sql = `
        INSERT INTO ${tablaDetalle} (C_US, N_ANIO, N_MES, C_SERVICIO, C_CONCEPTO, V_US, V_FORMULARIO, Q_AT_ENFERMERA_AUX, Q_AT_ENFERMERA_PRO, Q_AT_MEDICO_GEN, Q_AT_MEDICO_ESP)
        VALUES ?
      `;

      const [resultado] = await conn.query(sql, [filas]);

      if (anioVal >= 2026 && identificadorRegistro) {
        await seguimientoServicio.registrarEnvio(
          {
            anio: anioVal,
            mes: mesVal,
            regionCodigo: regionVal,
            establecimientoRups: identificadorRegistro,
            servicio: esHospital
              ? (servicioVal === "emergencia" ? "emergencia" : "consulta_externa")
              : "general"
          },
          conn
        );
      }

      await conn.commit();

      const info = resultado as { affectedRows: number };
      logger.info(`Registro hospitalario ${esEdicion ? "actualizado" : "guardado"}: identificador=${identificadorRegistro}, region=${regionVal}, ${mesVal}/${anioVal}, ${filas.length} conceptos, ${info.affectedRows} filas afectadas`);

      return reply.status(200).send({
        mensaje: esEdicion ? "Registro actualizado correctamente" : "Registro guardado correctamente",
        datos: {
          region: regionVal,
          establecimiento: identificadorRegistro,
          anio: anioVal,
          mes: mesVal,
          versionFormulario: versionActiva,
          vFormularioBD: vFormularioActual,
          conceptosGuardados: filas.length,
          filasAfectadas: info.affectedRows
        },
        generadoEn: new Date().toISOString()
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (error) {
    if (error instanceof AlcanceRegionalError) {
      return reply.status(error.statusCode).send({
        codigo: error.codigo,
        mensaje: error.message
      });
    }
    logger.error("Error al guardar registro hospitalario", error);
    throw error;
  }
};

// -- GET /api/registro-hospitalario --

export const obtenerRegistroControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const { region, anio, mes, establecimiento, establecimientoCodigo, rups, servicio } = request.query as Record<string, string | undefined>;

    const regionFueEnviada = region !== undefined && region !== null && region !== "";
    const regionSolicitada = regionFueEnviada ? sanitizarEntero(region, REGION_MIN, REGION_MAX) : null;
    const anioVal = sanitizarEntero(anio, ANIO_MIN, ANIO_MAX);
    const mesVal = sanitizarEntero(mes, MES_MIN, MES_MAX);

    if ((regionFueEnviada && regionSolicitada === null) || anioVal === null || mesVal === null) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "Se requieren los parámetros 'region' (1-20), 'anio' (2025+) y 'mes' (1-12)"
      });
    }

    const regionVal = resolverRegionParaRegistro(request.usuarioActual, regionSolicitada);
    if (regionVal === null) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "Se requieren los parámetros 'region' (1-20), 'anio' (2025+) y 'mes' (1-12)"
      });
    }

    const codigoRups =
      sanitizarCodigoRups(establecimientoCodigo) ??
      sanitizarCodigoRups(establecimiento) ??
      sanitizarCodigoRups(rups);
    const identificadorRegistro = anioVal >= 2026 ? codigoRups : String(regionVal);

    if (!identificadorRegistro) {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "Para 2026 en adelante debe indicar un establecimiento valido mediante su codigo RUPS."
      });
    }

    if (anioVal >= 2026) {
      await validarRupsPerteneceARegion(identificadorRegistro, regionVal);
    }

    const esHospitalGet = identificadorRegistro ? await esCodigoHospital(identificadorRegistro) : false;
    const servicioValGet = sanitizarServicio(servicio);
    const cServicioGet = esHospitalGet
      ? (servicioValGet === 'emergencia' ? '2' : '1')
      : '1';

    const versionActivaGet = versionFormularioPorAnio(anioVal);
    const vFormularioGet = vFormularioPorAnio(anioVal);

    const pool = obtenerPoolActual();
    const tablaDetalle = obtenerTablaDetalleAt2(anioVal);
    let [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
        CAST(C_CONCEPTO AS UNSIGNED) AS concepto,
        Q_AT_ENFERMERA_AUX AS enfermera_aux,
        Q_AT_ENFERMERA_PRO AS enfermera_pro,
        Q_AT_MEDICO_GEN AS medico_gen,
        Q_AT_MEDICO_ESP AS medico_esp
       FROM ${tablaDetalle}
       WHERE C_US = ? AND N_ANIO = ? AND N_MES = ? AND C_SERVICIO = ? AND V_FORMULARIO = ?
       ORDER BY CAST(C_CONCEPTO AS UNSIGNED)`,
      [identificadorRegistro, anioVal, mesVal, cServicioGet, vFormularioGet]
    );

    if (rows.length === 0 && anioVal >= 2026) {
      [rows] = await pool.query<RowDataPacket[]>(
        `SELECT
          CAST(C_CONCEPTO AS UNSIGNED) AS concepto,
          SUM(Q_AT_ENFERMERA_AUX) AS enfermera_aux,
          SUM(Q_AT_ENFERMERA_PRO) AS enfermera_pro,
          SUM(Q_AT_MEDICO_GEN) AS medico_gen,
          SUM(Q_AT_MEDICO_ESP) AS medico_esp
         FROM ${tablaDetalle}
         WHERE C_US = ? AND N_ANIO = ? AND N_MES = ? AND C_SERVICIO = ?
         GROUP BY CAST(C_CONCEPTO AS UNSIGNED)
         ORDER BY CAST(C_CONCEPTO AS UNSIGNED)`,
        [identificadorRegistro, anioVal, mesVal, cServicioGet]
      );
    }

    return reply.status(200).send({
      datos: rows,
      region: regionVal,
      establecimiento: identificadorRegistro,
      anio: anioVal,
      mes: mesVal,
      versionFormulario: versionActivaGet,
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    if (error instanceof AlcanceRegionalError) {
      return reply.status(error.statusCode).send({
        codigo: error.codigo,
        mensaje: error.message
      });
    }
    logger.error("Error al obtener registro hospitalario", error);
    throw error;
  }
};

// -- GET /api/registro-hospitalario/version-formulario --

export const obtenerVersionFormularioControlador = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const version = await obtenerVersionFormularioAt2();
    return reply.status(200).send({
      versionFormulario: version,
      maxConcepto: conceptoMaxPorVersion(version),
      vFormularioBD: vFormularioPorVersion(version),
      descripcion: version === '2' ? 'AT2-R-2026 (92 casillas)' : 'AT2-R-2012 (52 casillas)',
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    logger.error("Error al obtener versión formulario AT2R", error);
    throw error;
  }
};

// -- PUT /api/registro-hospitalario/version-formulario --

export const actualizarVersionFormularioControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const { version } = request.body as { version?: unknown };
    if (version !== '1' && version !== '2') {
      return reply.status(400).send({
        codigo: "PARAMETRO_INVALIDO",
        mensaje: "El campo 'version' debe ser '1' (52 conceptos) o '2' (92 conceptos)"
      });
    }
    await guardarVersionFormularioAt2(version as VersionFormularioAt2);
    logger.info(`Versión formulario AT2R actualizada a v${version} por usuario ${request.usuarioActual?.id ?? 'desconocido'}`);
    return reply.status(200).send({
      mensaje: `Versión de formulario AT2R actualizada a v${version}`,
      versionFormulario: version,
      maxConcepto: conceptoMaxPorVersion(version as VersionFormularioAt2),
      descripcion: version === '2' ? 'AT2-R-2026 (92 casillas)' : 'AT2-R-2012 (52 casillas)',
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    logger.error("Error al actualizar versión formulario AT2R", error);
    throw error;
  }
};

// -- GET /api/registro-hospitalario/estado --

export const obtenerEstadoRegistrosControlador = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const { anio } = request.query as Record<string, string | undefined>;
    const anioVal = sanitizarEntero(anio, ANIO_MIN, ANIO_MAX) ?? 2026;
    const regionesPermitidas = obtenerRegionesPermitidasUsuario(request.usuarioActual);

    const pool = obtenerPoolActual();
    const tablaDetalle = obtenerTablaDetalleAt2(anioVal);
    const usaFlujoPorEstablecimiento = anioVal >= 2026;
    const vFormularioEstado = vFormularioPorAnio(anioVal);
    const condicionRegion = regionesPermitidas?.length
      ? ` AND us.C_REGION IN (${regionesPermitidas.map(() => "?").join(", ")})`
      : "";
    const condicionRegionHistorica = regionesPermitidas?.length
      ? ` AND CAST(C_US AS UNSIGNED) IN (${regionesPermitidas.map(() => "?").join(", ")})`
      : "";

    const [rows] = usaFlujoPorEstablecimiento
      ? await pool.query<RowDataPacket[]>(
          `SELECT
            us.C_REGION AS region,
            det.N_MES AS mes,
            COUNT(DISTINCT det.C_CONCEPTO) AS conceptos,
            SUM(det.Q_AT_ENFERMERA_AUX + det.Q_AT_ENFERMERA_PRO + det.Q_AT_MEDICO_GEN + det.Q_AT_MEDICO_ESP) AS total
	           FROM ${tablaDetalle} det
	           INNER JOIN BAS_BDR_US us
             ON CAST(us.C_US AS CHAR) COLLATE utf8mb4_unicode_ci = det.C_US COLLATE utf8mb4_unicode_ci
           WHERE det.N_ANIO = ? AND det.V_FORMULARIO = ?${condicionRegion}
           GROUP BY us.C_REGION, det.N_MES
           ORDER BY us.C_REGION, det.N_MES`,
          [anioVal, vFormularioEstado, ...(regionesPermitidas ?? [])]
        )
      : await pool.query<RowDataPacket[]>(
          `SELECT
            CAST(C_US AS UNSIGNED) AS region,
            N_MES AS mes,
            COUNT(DISTINCT C_CONCEPTO) AS conceptos,
            SUM(Q_AT_ENFERMERA_AUX + Q_AT_ENFERMERA_PRO + Q_AT_MEDICO_GEN + Q_AT_MEDICO_ESP) AS total
	           FROM ${tablaDetalle}
	           WHERE N_ANIO = ? AND V_FORMULARIO = ?${condicionRegionHistorica}
           GROUP BY C_US, N_MES
           ORDER BY CAST(C_US AS UNSIGNED), N_MES`,
          [anioVal, vFormularioEstado, ...(regionesPermitidas ?? [])]
        );

    return reply.status(200).send({
      datos: rows,
      anio: anioVal,
      generadoEn: new Date().toISOString()
    });
  } catch (error) {
    if (error instanceof AlcanceRegionalError) {
      return reply.status(error.statusCode).send({
        codigo: error.codigo,
        mensaje: error.message
      });
    }
    logger.error("Error al obtener estado de registros", error);
    throw error;
  }
};
