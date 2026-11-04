// En el móvil no hay cookies (un service worker no puede ponerlas), así que la protección frente a otras webs es:
// - solo se atiende lo de esta misma dirección (lo demás no pasa por el service worker);
// - nada se abre dentro de otra página (marcos);
// - un cambio (POST) tiene que venir de una página de Calderilla: lo dice su cabecera Origin o su referrer.
// Las peticiones de htmx y fetch que no vienen de nuestras páginas ni siquiera llegan al service worker.

export interface PeticionVista {
  method: string;
  /** «navigate» cuando es una página entera (y no htmx o fetch). */
  mode?: string;
  destination: string;
  referrer: string;
  headers: Headers;
}

const MARCOS = new Set(["iframe", "frame", "embed", "object", "fencedframe"]);

/** Por qué no se atiende esta petición, o null si se atiende. */
export function motivoParaRechazar(peticion: PeticionVista, origen: string): string | null {
  if (MARCOS.has(peticion.destination)) return "Calderilla no se puede abrir dentro de otra página.";
  if (peticion.method === "GET" || peticion.method === "HEAD") return null;
  if (peticion.headers.get("origin") === origen || peticion.referrer.startsWith(`${origen}/`)) return null;
  return "Este cambio no viene de una página de Calderilla, así que no se ha hecho.";
}

/** Las mismas cabeceras que pone el PC (src/servidor/seguridad.ts), para cada respuesta del service worker. */
export const CABECERAS_SEGURIDAD: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; form-action 'self'",
};
