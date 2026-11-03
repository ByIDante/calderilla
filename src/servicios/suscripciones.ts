import type { BaseDatos } from "../datos/db.ts";
import type { Centimos } from "../dominio/dinero.ts";
import { sumarMeses, type Fecha } from "../dominio/fechas.ts";
import { estadoEn, importeEn, proximaOcurrencia, VECES_AL_ANIO, type Frecuencia } from "../dominio/recurrencia.ts";
import { leerRecurrentes, type RecurrenteCompleto } from "./finanzas.ts";

/*
 * Tus suscripciones en un sitio: lo que cuestan al mes y al año, cuándo se cobra cada una y cuáles han subido.
 * La app reconoce las conocidas (por el nombre o por el texto con el que salen en el banco) y las de la
 * categoría «Suscripciones»; tú puedes añadir o quitar las que quieras.
 */

/** Servicios que se pagan por suscripción (una palabra del nombre o del texto del banco) */
const CONOCIDAS = new Set([
  "netflix", "spotify", "disney", "hbo", "max", "prime", "crunchyroll", "youtube", "apple", "icloud", "dazn", "movistar", "filmin", "skyshowtime",
  "atresplayer", "audible", "kindle", "xbox", "playstation", "psn", "nintendo", "chatgpt", "openai", "adobe", "microsoft", "dropbox", "deezer",
  "tidal", "twitch", "patreon", "duolingo", "strava", "nordvpn", "canva", "notion",
]);

const palabras = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9+]+/).filter(Boolean);

export interface Suscripcion {
  id: number;
  nombre: string;
  categoria: string | null;
  frecuencia: Frecuencia;
  /** Lo de cada cobro */
  importe: Centimos;
  alAnio: Centimos;
  proximo: Fecha | null;
  desde: Fecha;
  /** La última subida de precio del último año */
  subida: { antes: Centimos; ahora: Centimos; fecha: Fecha } | null;
  /** La propuso la app (no la marcaste tú) */
  automatica: boolean;
}

export interface Suscripciones {
  lista: Suscripcion[];
  /** Gastos fijos pequeños que no son esenciales: quizá alguna lo sea */
  posibles: Suscripcion[];
  alAnio: Centimos;
}

/** Una palabra que es un servicio conocido, o que empieza por uno largo («movistarplus») */
const esConocida = (palabra: string) => CONOCIDAS.has(palabra) || [...CONOCIDAS].some((c) => c.length >= 6 && palabra.startsWith(c));

/** ¿La reconoce la app? Por la categoría «Suscripciones» o por el nombre de un servicio conocido */
export function pareceSuscripcion(r: Pick<RecurrenteCompleto, "nombre" | "patron" | "categoria">): boolean {
  if (r.categoria && palabras(r.categoria).includes("suscripciones")) return true;
  return [...palabras(r.nombre), ...palabras(r.patron ?? "")].some(esConocida);
}

function datos(r: RecurrenteCompleto, hoy: Fecha, automatica: boolean): Suscripcion {
  const importe = importeEn(r.versiones, hoy);
  const versiones = [...r.versiones].sort((a, b) => a.validoDesde.localeCompare(b.validoDesde));
  const hace = sumarMeses(hoy, -12);
  // La última vez que subió de precio, si fue en el último año
  let subida: Suscripcion["subida"] = null;
  for (let i = 1; i < versiones.length; i++) {
    const [antes, ahora] = [versiones[i - 1]!, versiones[i]!];
    if (ahora.validoDesde > hace && ahora.validoDesde <= hoy && ahora.importe > antes.importe) subida = { antes: antes.importe, ahora: ahora.importe, fecha: ahora.validoDesde };
  }
  return {
    id: r.id,
    nombre: r.nombre,
    categoria: r.categoria,
    frecuencia: r.frecuencia,
    importe,
    alAnio: importe * VECES_AL_ANIO[r.frecuencia],
    proximo: proximaOcurrencia(r, hoy),
    desde: r.inicio,
    subida,
    automatica,
  };
}

export function leerSuscripciones(bd: BaseDatos, hoy: Fecha): Suscripciones {
  const marcadas = new Map(bd.todos<{ id: number; suscripcion: number | null }>("SELECT id, suscripcion FROM recurrentes").map((f) => [f.id, f.suscripcion]));
  const fijos = leerRecurrentes(bd).filter((r) => r.tipo === "gasto" && !r.prestamo && estadoEn(r, hoy) !== "finalizado");
  const lista: Suscripcion[] = [];
  const posibles: Suscripcion[] = [];
  for (const r of fijos) {
    const marca = marcadas.get(r.id) ?? null;
    if (marca === 1 || (marca === null && pareceSuscripcion(r))) lista.push(datos(r, hoy, marca === null));
    else if (marca === null && r.clase === "fijo" && !r.esencial && (importeEn(r.versiones, hoy) * VECES_AL_ANIO[r.frecuencia]) / 12 <= 3000) posibles.push(datos(r, hoy, true));
  }
  lista.sort((a, b) => b.alAnio - a.alAnio);
  return { lista, posibles, alAnio: lista.reduce((s, x) => s + x.alAnio, 0) };
}

/** «Es una suscripción» o «no lo es» (lo que dices tú manda sobre lo que reconoce la app) */
export function marcarSuscripcion(bd: BaseDatos, id: number, es: boolean): boolean {
  return bd.ejecutar("UPDATE recurrentes SET suscripcion = ? WHERE id = ? AND tipo = 'gasto'", es ? 1 : 0, id).cambios > 0;
}
