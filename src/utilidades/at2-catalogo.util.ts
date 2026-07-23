export interface ConceptoAt2Catalogo {
  numero: number;
  descripcion: string;
}

export const CONCEPTOS_AT2_FORMULARIO_NUEVO: ConceptoAt2Catalogo[] = [
  { numero: 1, descripcion: "Menores de 1 Mes 1a. Vez" },
  { numero: 2, descripcion: "Menores de 1 Mes Subsiguiente" },
  { numero: 3, descripcion: "1 Mes a 1 Año 1a. Vez" },
  { numero: 4, descripcion: "1 Mes a 1 Año Subsiguiente" },
  { numero: 5, descripcion: "1 - 4 Años 1a. Vez" },
  { numero: 6, descripcion: "1 - 4 Años Subsiguiente" },
  { numero: 7, descripcion: "5 - 9 Años 1a. Vez" },
  { numero: 8, descripcion: "5 - 9 Años Subsiguiente" },
  { numero: 9, descripcion: "10 - 14 Años 1a. Vez" },
  { numero: 10, descripcion: "10 - 14 Años Subsiguiente" },
  { numero: 11, descripcion: "15 - 19 Años 1a. Vez" },
  { numero: 12, descripcion: "15 - 19 Años Subsiguiente" },
  { numero: 13, descripcion: "20 - 49 Años 1a. Vez" },
  { numero: 14, descripcion: "20 - 49 Años Subsiguiente" },
  { numero: 15, descripcion: "50 - 59 Años 1a. Vez" },
  { numero: 16, descripcion: "50 - 59 Años Subsiguiente" },
  { numero: 17, descripcion: "60 y + Años 1a. Vez" },
  { numero: 18, descripcion: "60 y + Años Subsiguiente" },
  { numero: 19, descripcion: "Total Pacientes Atendidos" },
  { numero: 20, descripcion: "Número de Atenciones de Mujeres" },
  { numero: 21, descripcion: "Número de Atenciones de Hombres" },
  { numero: 22, descripcion: "Número de Atenciones Espontáneas" },
  { numero: 23, descripcion: "Número de Atenciones Referidas" },
  { numero: 24, descripcion: "Atenciones del Recién Nacido para Control Temprano antes de los 5 días" },
  { numero: 25, descripcion: "Menores de 5 años con Diarrea" },
  { numero: 26, descripcion: "Menores de 5 años con Diarrea que acuden a cita de Seguimiento" },
  { numero: 27, descripcion: "Menores de 5 años con Deshidratación Rehidratados en el ES" },
  { numero: 28, descripcion: "Menores de 5 años con Casos de Neumonía nuevos" },
  { numero: 29, descripcion: "Menores de 5 años con Casos de Neumonía en Seguimiento" },
  { numero: 30, descripcion: "Menores de 5 años con Síndrome Anémico Diagnosticado por Laboratorio" },
  { numero: 31, descripcion: "Menores de 5 años con crecimiento adecuado (normal)" },
  { numero: 32, descripcion: "Menores de 5 años sin desnutrición crónica" },
  { numero: 33, descripcion: "Menores de 5 años con baja talla y baja talla severa" },
  { numero: 34, descripcion: "Menores de 5 años sin desnutrición aguda ni sobrepeso/obesidad" },
  { numero: 35, descripcion: "Menores de 5 años emaciados y severamente emaciados" },
  { numero: 36, descripcion: "Menores de 5 años con sobrepeso y obesidad" },
  { numero: 37, descripcion: "Menores de 5 años con crecimiento inadecuado persistente" },
  { numero: 38, descripcion: "Menores de 5 años con Discapacidad Nuevos" },
  { numero: 39, descripcion: "Menores de 5 años con Probable Alteración del Desarrollo" },
  { numero: 40, descripcion: "Total de menores de 5 años Atendidos" },
  { numero: 41, descripcion: "Mujeres que se les entregó Anticonceptivo Oral Combinado" },
  { numero: 42, descripcion: "Mujeres que se les entregó Anticonceptivos Orales con Progestina sola" },
  { numero: 43, descripcion: "Mujeres que se les aplicó inyectables trimestral" },
  { numero: 44, descripcion: "Mujeres que se les aplicó autoinyectables trimestral" },
  { numero: 45, descripcion: "DIU con cobre insertados" },
  { numero: 46, descripcion: "DIU con levonorgestrel insertados" },
  { numero: 47, descripcion: "Mujeres que se les insertó Implante con levonorgestrel 5 años" },
  { numero: 48, descripcion: "Mujeres que se les insertó Implante con Etonogestrel 3 años" },
  { numero: 49, descripcion: "Mujeres que se les retiró implante" },
  { numero: 50, descripcion: "Mujeres que se les retiró DIU" },
  { numero: 51, descripcion: "Detección de Cáncer Cérvico Uterino" },
  { numero: 52, descripcion: "Consejerías de planificación familiar brindadas" },
  { numero: 53, descripcion: "Mujeres que se les realizó AQV Ambulatoria" },
  { numero: 54, descripcion: "Hombres que se les realizó AQV Ambulatoria" },
  { numero: 55, descripcion: "Mujeres que se les brindó PAE" },
  { numero: 56, descripcion: "Personas atendidas que se les entregó condones" },
  { numero: 57, descripcion: "Mujeres atendidas por aborto ambulatorio" },
  { numero: 58, descripcion: "Atención Prenatal Nueva en edades de 10 a 19 años (Adolescentes)" },
  { numero: 59, descripcion: "Atención Prenatal Nueva en las primeras 12 Semanas de Gestación" },
  { numero: 60, descripcion: "Atención Prenatal Nueva después de las 12 semanas de gestación" },
  { numero: 61, descripcion: "Total de atenciones prenatales subsiguientes" },
  { numero: 62, descripcion: "Atenciones puerperales entre los 3 a 7 días" },
  { numero: 63, descripcion: "Atenciones puerperales después de los 7 días" },
  { numero: 64, descripcion: "Total de Controles Puerperales" },
  { numero: 65, descripcion: "Atenciones por Violencia Sexual" },
  { numero: 66, descripcion: "Atención de adolescentes de 10 a 19 años mujeres" },
  { numero: 67, descripcion: "Atención de adolescentes de 10 a 19 años varones" },
  { numero: 68, descripcion: "Detección de Casos presuntivos de Tuberculosis" },
  { numero: 69, descripcion: "Atenciones brindadas Nuevas de Diabetes Mellitus" },
  { numero: 70, descripcion: "Atenciones brindadas Subsiguientes de Diabetes Mellitus" },
  { numero: 71, descripcion: "Atenciones brindadas Nuevas de HTA" },
  { numero: 72, descripcion: "Atenciones brindadas Subsiguientes de HTA" },
  { numero: 73, descripcion: "Atenciones brindadas Nuevas de Enfermedad Renal Crónica" },
  { numero: 74, descripcion: "Atenciones brindadas Subsiguientes de Enfermedad Renal Crónica" },
  { numero: 75, descripcion: "Atenciones brindadas Nuevas de Cáncer Cérvico Uterino" },
  { numero: 76, descripcion: "Atenciones brindadas Subsiguientes de Cáncer Cérvico Uterino" },
  { numero: 77, descripcion: "Atenciones brindadas Nuevas de Cáncer Priorizados" },
  { numero: 78, descripcion: "Atenciones brindadas Subsiguientes de Cáncer Priorizados" },
  { numero: 79, descripcion: "Atenciones por psicología-psiquiatría" },
  { numero: 80, descripcion: "Atenciones brindadas a Migrantes Irregulares" },
  { numero: 81, descripcion: "Atenciones brindadas a Migrantes hondureños retornados" },
  { numero: 82, descripcion: "Garífuna" },
  { numero: 83, descripcion: "Negro Inglés" },
  { numero: 84, descripcion: "Tolupán" },
  { numero: 85, descripcion: "Pech (Paya)" },
  { numero: 86, descripcion: "Misquito" },
  { numero: 87, descripcion: "Nahoa" },
  { numero: 88, descripcion: "Lenca" },
  { numero: 89, descripcion: "Tawaka (Sumo)" },
  { numero: 90, descripcion: "Maya Chortí" },
  { numero: 91, descripcion: "Otro" },
  { numero: 92, descripcion: "No Sabe / Ninguno" }
];

const escaparSql = (valor: string) => valor.replace(/'/g, "''");

export const obtenerNombreConceptoAt2Nuevo = (numero: number): string | null =>
  CONCEPTOS_AT2_FORMULARIO_NUEVO.find((concepto) => concepto.numero === numero)?.descripcion ?? null;

export const construirCaseConceptoAt2NuevoSql = (expresionCodigo: string): string =>
  `CASE CAST(${expresionCodigo} AS UNSIGNED)\n${CONCEPTOS_AT2_FORMULARIO_NUEVO
    .map((concepto) => `WHEN ${concepto.numero} THEN '${escaparSql(concepto.descripcion)}'`)
    .join("\n")}\nELSE NULL END`;

export const construirCatalogoAt2NuevoSql = (): string =>
  CONCEPTOS_AT2_FORMULARIO_NUEVO
    .map(
      (concepto) =>
        `SELECT ${concepto.numero} AS numero, '${escaparSql(concepto.descripcion)}' AS descripcion`
    )
    .join("\nUNION ALL\n");
