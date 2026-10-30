import type { BaseDatos } from "../datos/db.ts";
import { MERCADO_SEMILLA } from "../reglas/mercado.semilla.ts";

const CATEGORIAS: [string, "esencial" | "ocio" | "otro" | "ingreso"][] = [
  ["Nómina", "ingreso"],
  ["Otros ingresos", "ingreso"],
  ["Vivienda", "esencial"],
  ["Suministros", "esencial"],
  ["Alimentación", "esencial"],
  ["Transporte", "esencial"],
  ["Seguros", "esencial"],
  ["Salud", "esencial"],
  ["Impuestos", "esencial"],
  ["Préstamos", "esencial"],
  ["Educación", "esencial"],
  ["Suscripciones", "otro"],
  ["Compras", "otro"],
  ["Regalos", "otro"],
  ["Ocio", "ocio"],
  ["Restaurantes", "ocio"],
  ["Viajes", "ocio"],
];

// Reglas para categorizar los extractos importados: «si el concepto contiene…»
const REGLAS: [string, string][] = [
  ...["mercadona", "carrefour", "lidl", "supermercados dia", "alcampo", "eroski", "consum s coop", "aldi", "bonpreu", "hipercor"].map((p): [string, string] => [p, "Alimentación"]),
  ...["netflix", "spotify", "hbo", "disney", "prime video", "youtube premium", "icloud"].map((p): [string, string] => [p, "Suscripciones"]),
  ...["repsol", "cepsa", "galp", "gasolinera", "renfe", "metro", "cabify", "uber "].map((p): [string, string] => [p, "Transporte"]),
  ...["restaurante", "glovo", "just eat", "uber eats", "burger", "mcdonald", "telepizza"].map((p): [string, string] => [p, "Restaurantes"]),
  ...["iberdrola", "endesa", "naturgy", "holaluz", "aigues", "canal de isabel", "movistar", "vodafone", "orange", "digi mobil"].map((p): [string, string] => [p, "Suministros"]),
  ...["amazon", "zara", "decathlon", "ikea", "el corte ingles"].map((p): [string, string] => [p, "Compras"]),
  ...["farmacia", "dentista", "clinica"].map((p): [string, string] => [p, "Salud"]),
  ...["cine", "teatro", "ticketmaster", "entradas"].map((p): [string, string] => [p, "Ocio"]),
  ...["booking", "ryanair", "vueling", "iberia", "airbnb"].map((p): [string, string] => [p, "Viajes"]),
  ...["nomina", "nómina"].map((p): [string, string] => [p, "Nómina"]),
];

/** Prepara una base recién abierta: migraciones, categorías por defecto y datos de mercado nuevos. */
export function prepararBase(bd: BaseDatos) {
  bd.migrar();
  const nueva = bd.leerMeta("creada") === null;
  bd.transaccion(() => {
    if (nueva) {
      for (const [nombre, tipo] of CATEGORIAS) bd.ejecutar("INSERT OR IGNORE INTO categorias (nombre, tipo) VALUES (?, ?)", nombre, tipo);
    }
    for (const dato of MERCADO_SEMILLA) {
      const actual = bd.uno<{ comprobado: string; origen: string }>("SELECT comprobado, origen FROM datos_mercado WHERE clave = ?", dato.clave);
      // Un dato que has cambiado tú, o más reciente que el del programa, no se toca
      if (actual && (actual.origen === "usuario" || actual.comprobado >= dato.comprobado)) continue;
      bd.ejecutar(
        `INSERT INTO datos_mercado (clave, nombre, tipo, valor, fuente, comprobado, fin_promocion, nota, origen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'semilla')
         ON CONFLICT (clave) DO UPDATE SET nombre = excluded.nombre, tipo = excluded.tipo, valor = excluded.valor, fuente = excluded.fuente,
           comprobado = excluded.comprobado, fin_promocion = excluded.fin_promocion, nota = excluded.nota`,
        dato.clave,
        dato.nombre,
        dato.tipo,
        JSON.stringify(dato.valor),
        dato.fuente,
        dato.comprobado,
        dato.finPromocion ?? null,
        dato.nota ?? null,
      );
    }
  });
  if (bd.leerMeta("reglas_sembradas") === null) {
    for (const [patron, categoria] of REGLAS) {
      bd.ejecutar("INSERT OR IGNORE INTO reglas_categoria (patron, categoria_id) SELECT ?, id FROM categorias WHERE nombre = ?", patron, categoria);
    }
    bd.escribirMeta("reglas_sembradas", "1");
  }
  if (nueva) {
    // Las semillas no cuentan como cambios: así un ordenador nuevo trae los datos del otro en vez de pisarlos
    bd.escribirMeta("creada", new Date().toISOString());
    bd.escribirMeta("sucio", "0");
  }
}
