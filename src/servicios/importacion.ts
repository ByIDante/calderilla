import type { BaseDatos } from "../datos/db.ts";
import { sumarDias, type Fecha } from "../dominio/fechas.ts";
import { estadoEn, importeEn, ocurrencias } from "../dominio/recurrencia.ts";
import { categoriaPorReglas, huellas, type Configuracion, type Movimiento, type Regla } from "../importar/extracto.ts";
import { leerRecurrentes, type RecurrenteCompleto } from "./finanzas.ts";

export interface Propuesta extends Movimiento {
  huella: string;
  duplicado: boolean;
  categoriaId: number | null;
  /** Gasto o ingreso fijo con el que coincide: ya está contado en el presupuesto. */
  recurrenteId: number | null;
  recurrente: string | null;
}

/** Margen para reconocer un cargo fijo en el extracto: ±5 % del importe y ±5 días de la fecha. */
const MARGEN_IMPORTE = 0.05;
const MARGEN_DIAS = 5;

export function leerReglas(bd: BaseDatos): (Regla & { id: number; categoria: string })[] {
  return bd.todos<{ id: number; patron: string; categoria_id: number; categoria: string }>(
    "SELECT r.id, r.patron, r.categoria_id, c.nombre AS categoria FROM reglas_categoria r JOIN categorias c ON c.id = r.categoria_id ORDER BY r.patron",
  ).map((r) => ({ id: r.id, patron: r.patron, categoriaId: r.categoria_id, categoria: r.categoria }));
}

export function coincidencia(m: Movimiento, recurrentes: readonly RecurrenteCompleto[]): RecurrenteCompleto | null {
  const tipo = m.importe < 0 ? "gasto" : "ingreso";
  const importe = Math.abs(m.importe);
  return (
    recurrentes.find(
      (r) =>
        r.tipo === tipo &&
        estadoEn(r, sumarDias(m.fecha, MARGEN_DIAS)) !== "proximo" &&
        ocurrencias(r, sumarDias(m.fecha, -MARGEN_DIAS), sumarDias(m.fecha, MARGEN_DIAS)).some((fecha) => {
          const previsto = importeEn(r.versiones, fecha);
          return Math.abs(previsto - importe) <= previsto * MARGEN_IMPORTE;
        }),
    ) ?? null
  );
}

export function proponer(bd: BaseDatos, movimientos: readonly Movimiento[], cuentaId: number | null): Propuesta[] {
  const reglas = leerReglas(bd);
  const recurrentes = leerRecurrentes(bd);
  const existentes = new Set(bd.todos<{ hash_dedupe: string }>("SELECT hash_dedupe FROM apuntes WHERE hash_dedupe IS NOT NULL").map((f) => f.hash_dedupe));
  const lista = huellas(movimientos, cuentaId);
  return movimientos.map((m, i) => {
    const recurrente = coincidencia(m, recurrentes);
    return {
      ...m,
      huella: lista[i]!,
      duplicado: existentes.has(lista[i]!),
      categoriaId: recurrente?.categoriaId ?? categoriaPorReglas(m.concepto, reglas),
      recurrenteId: recurrente?.id ?? null,
      recurrente: recurrente?.nombre ?? null,
    };
  });
}

export function importar(
  bd: BaseDatos,
  propuestas: readonly Propuesta[],
  datos: { cuentaId: number | null; archivo: string; hoy: Fecha; perfil: { nombre: string; firma: string; configuracion: Configuracion } | null },
): { nuevas: number; duplicadas: number } {
  return bd.transaccion(() => {
    const nuevas = propuestas.filter((p) => !p.duplicado);
    const { id: importacionId } = bd.ejecutar(
      "INSERT INTO importaciones (fecha, archivo, cuenta_id, filas, nuevas) VALUES (?, ?, ?, ?, ?)",
      datos.hoy,
      datos.archivo,
      datos.cuentaId,
      propuestas.length,
      nuevas.length,
    );
    for (const p of nuevas) {
      bd.ejecutar(
        "INSERT OR IGNORE INTO apuntes (fecha, importe, concepto, categoria_id, cuenta_id, recurrente_id, origen, importacion_id, hash_dedupe) VALUES (?, ?, ?, ?, ?, ?, 'csv', ?, ?)",
        p.fecha,
        p.importe,
        p.concepto,
        p.categoriaId,
        datos.cuentaId,
        p.recurrenteId,
        importacionId,
        p.huella,
      );
    }
    if (datos.perfil) {
      bd.ejecutar(
        "INSERT INTO perfiles_importacion (nombre, firma, configuracion) VALUES (?, ?, ?) ON CONFLICT (nombre) DO UPDATE SET firma = excluded.firma, configuracion = excluded.configuracion",
        datos.perfil.nombre,
        datos.perfil.firma,
        JSON.stringify(datos.perfil.configuracion),
      );
    }
    return { nuevas: nuevas.length, duplicadas: propuestas.length - nuevas.length };
  });
}

/** Formato guardado de un banco cuyo extracto tiene estos mismos títulos de columna. */
export function perfilPorFirma(bd: BaseDatos, firma: string): { nombre: string; configuracion: Configuracion } | null {
  const fila = bd.uno<{ nombre: string; configuracion: string }>("SELECT nombre, configuracion FROM perfiles_importacion WHERE firma = ?", firma);
  return fila ? { nombre: fila.nombre, configuracion: JSON.parse(fila.configuracion) as Configuracion } : null;
}
