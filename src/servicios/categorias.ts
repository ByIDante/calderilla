import type { BaseDatos } from "../datos/db.ts";
import { sumarDias, type Fecha } from "../dominio/fechas.ts";
import { claveConcepto } from "../importar/periodicos.ts";

/*
 * Categoría por parecido: si ya pusiste categoría a movimientos con el mismo texto (los Bizums a un amigo, los
 * cargos de Steam…), se propone la misma para los que aún no la tienen. Tú confirmas, y si quieres se crea una
 * regla para que los siguientes se categoricen solos.
 */

export interface PropuestaCategoria {
  /** Signo y clave del concepto: identifica el grupo */
  clave: string;
  nombre: string;
  categoriaId: number;
  categoria: string;
  apunteIds: number[];
  ejemplo: string;
  /** Cuántos del grupo ya tienen esa categoría */
  apoyos: number;
  /** Texto para una regla que reconozca a todos (null si no hay uno común) */
  regla: string | null;
  /** La regla vale solo para pagos o solo para cobros, como el grupo */
  signo: "gasto" | "ingreso";
}

const normalizar = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * El texto de la regla: el trozo del concepto que va de la primera a la última palabra de la clave, tal cual
 * (en un Bizum es «jordi;puig», no «jordi puig»), si sale en todos los conceptos del grupo.
 */
function textoRegla(clave: string, conceptos: readonly string[]): string | null {
  const [primera, ...resto] = clave.split(" ");
  const ultima = resto.at(-1) ?? primera!;
  const ejemplo = normalizar(conceptos[0]!);
  const inicio = ejemplo.indexOf(primera!);
  const fin = ejemplo.indexOf(ultima, inicio) + ultima.length;
  if (inicio < 0 || fin <= inicio) return null;
  const trozo = ejemplo.slice(inicio, fin);
  return trozo.length >= 4 && conceptos.every((c) => normalizar(c).includes(trozo)) ? trozo : null;
}

/** Lo traído del banco de una persona: «concepto · Nombre;Apellidos» */
const dePersona = (concepto: string) => (concepto.split(" · ").at(-1) ?? "").includes(";");
const capitalizar = (texto: string) => texto.replace(/(^|\s)(\p{L})/gu, (_, espacio: string, letra: string) => espacio + letra.toUpperCase());

/**
 * El nombre del grupo y el texto de su regla. De una persona, su nombre y primer apellido («Jordi Puig»). De un
 * comercio, su primera palabra si solo sale en sus movimientos («Fnac», no «Fnac San», que es la tienda); si
 * también sale en otros («restaurante»), las dos.
 */
function nombreYRegla(palabras: string, conceptos: readonly string[], otros: readonly string[][]): { nombre: string; regla: string | null } {
  const primera = palabras.split(" ")[0]!;
  if (!dePersona(conceptos[0]!) && primera !== palabras && !otros.some((p) => p.includes(primera))) {
    const regla = textoRegla(primera, conceptos);
    if (regla) return { nombre: capitalizar(primera), regla };
  }
  return { nombre: capitalizar(palabras), regla: textoRegla(palabras, conceptos) };
}

/** Grupos de movimientos sin categoría cuyo texto ya categorizaste (como mínimo 2 de cada 3 veces igual). */
export function proponerCategorias(bd: BaseDatos, hoy: Fecha): PropuestaCategoria[] {
  const apuntes = bd.todos<{ id: number; importe: number; concepto: string; categoria_id: number | null; categoria: string | null }>(
    `SELECT a.id, a.importe, a.concepto, a.categoria_id, c.nombre AS categoria FROM apuntes a LEFT JOIN categorias c ON c.id = a.categoria_id
     WHERE coalesce(a.traspaso, 0) = 0 AND a.fecha >= ?`,
    sumarDias(hoy, -450),
  );
  const grupos = new Map<string, typeof apuntes>();
  // Las palabras de cada movimiento, por su clave: para saber si una palabra solo sale en un grupo
  const palabrasDe = new Map<string, string[][]>();
  for (const a of apuntes) {
    const { clave, palabras } = claveConcepto(a.concepto);
    if (!clave) continue;
    const id = `${a.importe < 0 ? "-" : "+"}:${clave}`;
    grupos.set(id, [...(grupos.get(id) ?? []), a]);
    palabrasDe.set(clave, [...(palabrasDe.get(clave) ?? []), palabras]);
  }
  const propuestas: PropuestaCategoria[] = [];
  for (const [clave, lista] of grupos) {
    const sin = lista.filter((a) => a.categoria_id === null);
    const con = lista.filter((a) => a.categoria_id !== null);
    if (!sin.length || !con.length) continue;
    const veces = new Map<number, number>();
    for (const a of con) veces.set(a.categoria_id!, (veces.get(a.categoria_id!) ?? 0) + 1);
    const [categoriaId, apoyos] = [...veces].sort((x, y) => y[1] - x[1])[0]!;
    if (apoyos * 3 < con.length * 2) continue;
    const palabra = clave.split(":")[1]!;
    const otros = [...palabrasDe].filter(([otra]) => otra !== palabra).flatMap(([, lista]) => lista);
    const { nombre, regla } = nombreYRegla(palabra, lista.map((a) => a.concepto), otros);
    const signo = clave.startsWith("+") ? "ingreso" : "gasto";
    propuestas.push({
      clave,
      // Lo que te llega y lo que pagas a la misma persona son grupos distintos: que se note cuál es cuál
      nombre: signo === "ingreso" ? `${nombre} (lo que te llega)` : nombre,
      categoriaId,
      categoria: con.find((a) => a.categoria_id === categoriaId)!.categoria!,
      apunteIds: sin.map((a) => a.id),
      ejemplo: sin[0]!.concepto,
      apoyos,
      regla,
      signo,
    });
  }
  return propuestas.sort((a, b) => b.apunteIds.length - a.apunteIds.length);
}

/** Pone la categoría a los movimientos de las propuestas elegidas (y, si se pide, crea su regla). */
export function aplicarCategorias(bd: BaseDatos, hoy: Fecha, elegidas: readonly { clave: string; categoriaId: number; regla: boolean }[]): number {
  const propuestas = new Map(proponerCategorias(bd, hoy).map((p) => [p.clave, p]));
  return bd.transaccion(() => {
    let n = 0;
    for (const e of elegidas) {
      const p = propuestas.get(e.clave);
      if (!p) continue;
      for (const id of p.apunteIds) n += bd.ejecutar("UPDATE apuntes SET categoria_id = ? WHERE id = ? AND categoria_id IS NULL", e.categoriaId, id).cambios;
      if (e.regla && p.regla) {
        bd.ejecutar(
          "INSERT INTO reglas_categoria (patron, categoria_id, signo) VALUES (?, ?, ?) ON CONFLICT (patron, signo) DO UPDATE SET categoria_id = excluded.categoria_id",
          p.regla,
          e.categoriaId,
          p.signo,
        );
      }
    }
    return n;
  });
}
