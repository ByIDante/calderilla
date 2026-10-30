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
  if (nueva) {
    // Las semillas no cuentan como cambios: así un ordenador nuevo trae los datos del otro en vez de pisarlos
    bd.escribirMeta("creada", new Date().toISOString());
    bd.escribirMeta("sucio", "0");
  }
}
