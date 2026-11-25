/** BAS_BDR_US.C_US es INT; AT2 detalle.C_US es VARCHAR. El CAST va en el hecho para usar el índice del catálogo. */
export const JOIN_DETALLE_US =
  "LEFT JOIN BAS_BDR_US us ON us.C_US = CAST(det.C_US AS UNSIGNED)";

export const JOIN_DETALLE_US_INNER =
  "INNER JOIN BAS_BDR_US us ON us.C_US = CAST(det.C_US AS UNSIGNED)";

/** El código visible del RUPS es el del catálogo (INT → CHAR), igual que el selector de establecimientos. */
export const JOIN_CAT_ESTABLECIMIENTO =
  "LEFT JOIN cat_establecimientos cat_establecimiento ON cat_establecimiento.codigo COLLATE utf8mb4_unicode_ci = CAST(us.C_US AS CHAR) COLLATE utf8mb4_unicode_ci";

/** Mismo origen de nivel que el selector (`BAS_BDR_NIVELES_US`), sin el CR de `cat_nivel_establecimiento`. */
export const JOIN_NIVELES_US =
  "LEFT JOIN BAS_BDR_NIVELES_US niveles_us ON niveles_us.C_NIVEL_US = us.C_NIVEL_US";

export const RUPS_VISIBLE_SQL = "COALESCE(CAST(us.C_US AS CHAR), CAST(det.C_US AS CHAR))";

export const NIVEL_ESTABLECIMIENTO_ETIQUETA_SQL =
  "TRIM(TRAILING CHAR(13) FROM TRIM(cat_nivel_establecimiento.descripcion))";

export const NIVEL_CATALOGO_ETIQUETA_SQL =
  "TRIM(TRAILING CHAR(13) FROM TRIM(descripcion))";

export const CONDICION_DETALLE_C_US =
  "CAST(C_US AS UNSIGNED) = CAST(? AS UNSIGNED)";
