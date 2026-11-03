import type { BaseDatos } from "../datos/db.ts";
import { leerPerfil } from "./configuracion.ts";

/*
 * Tu nombre como sale en el banco. Sirve para reconocer lo que te pasas a una cuenta tuya que no importas
 * (de CaixaBank a Trade Republic, por ejemplo): en el banco sale como «hucha · Laura Gomez Ferrer», y sin la
 * otra mitad del traspaso parecería un gasto.
 */

const normalizar = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const palabras = (texto: string) => normalizar(texto).split(/[^a-zñ]+/).filter((p) => p.length >= 2);

/**
 * El nombre que viene en las cuentas traídas del banco: «CaixaBank Laura Gomez Ferrer ···· 1234» sin el banco
 * ni los números. Solo si quedan de 2 a 4 palabras y es el mismo en todas las cuentas que lo traen.
 */
export function titularSugerido(bd: BaseDatos): string | null {
  const candidatos = new Set<string>();
  for (const cuenta of bd.todos<{ nombre: string; entidad: string | null }>("SELECT nombre, entidad FROM cuentas WHERE archivada = 0")) {
    const delBanco = new Set(palabras(cuenta.entidad ?? ""));
    const resto = cuenta.nombre
      .split(/\s+/)
      .filter((p) => /^\p{L}+$/u.test(p) && !delBanco.has(normalizar(p)))
      .join(" ");
    const n = resto.split(" ").filter(Boolean).length;
    if (cuenta.entidad && n >= 2 && n <= 4) candidatos.add(resto);
  }
  return candidatos.size === 1 ? [...candidatos][0]! : null;
}

/** El que pusiste en tu perfil o, si no, el de tus cuentas. */
export function titular(bd: BaseDatos): string | null {
  return leerPerfil(bd).titular.trim() || titularSugerido(bd);
}

/**
 * ¿Es dinero que va o viene de ti mismo? Lo traído del banco es «concepto · quién»: tiene que ser tuyo el «quién»
 * (el recibo de una financiera con «TIT: LAURA GOMEZ» no lo es). En un extracto, que sea una transferencia o un
 * traspaso con tu nombre. Basta con el nombre y el primer apellido (a veces el banco corta el resto).
 */
export function esDelTitular(concepto: string, nombre: string | null): boolean {
  if (!nombre) return false;
  const buscadas = palabras(nombre).filter((p) => p.length >= 3).slice(0, 2);
  if (buscadas.length < 2) return false;
  const partes = concepto.split(" · ");
  if (partes.length === 1 && !/\b(transf\w*|traspaso\w*|trf|envio|enviada|bizum)\b/.test(normalizar(concepto))) return false;
  const enConcepto = new Set(palabras(partes.at(-1)!));
  return buscadas.every((p) => enConcepto.has(p));
}
