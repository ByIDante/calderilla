import type { Context } from "hono";
import { leerImporte, leerNumero } from "../dominio/dinero.ts";
import { esFecha } from "../dominio/fechas.ts";

/** Lectura cómoda de los campos de un formulario, aceptando importes con coma o punto. */
export class Formulario {
  readonly #campos: Record<string, string>;
  /** Todos los valores de los campos que se repiten (p. ej. varias casillas con el mismo nombre) */
  readonly #listas: Record<string, string[]>;

  constructor(campos: Record<string, string>, listas: Record<string, string[]> = {}) {
    this.#campos = campos;
    this.#listas = listas;
  }

  static async de(c: Context): Promise<Formulario> {
    const cuerpo = await c.req.parseBody({ all: true });
    const campos: Record<string, string> = {};
    const listas: Record<string, string[]> = {};
    for (const [nombre, valor] of Object.entries(cuerpo)) {
      const textos = (Array.isArray(valor) ? valor : [valor]).filter((v): v is string => typeof v === "string");
      if (!textos.length) continue;
      listas[nombre] = textos;
      // Si un campo se repite, como campo suelto vale el último (como hasta ahora)
      campos[nombre] = textos.at(-1)!;
    }
    return new Formulario(campos, listas);
  }

  /** Los números enteros de un campo que se repite (las casillas marcadas de una lista) */
  enteros(nombre: string): number[] {
    return (this.#listas[nombre] ?? []).filter((v) => /^\d+$/.test(v)).map(Number);
  }

  texto(nombre: string): string {
    return (this.#campos[nombre] ?? "").trim();
  }

  opcional(nombre: string): string | null {
    return this.texto(nombre) || null;
  }

  importe(nombre: string): number | null {
    return leerImporte(this.texto(nombre));
  }

  numero(nombre: string): number | null {
    return leerNumero(this.texto(nombre));
  }

  entero(nombre: string): number | null {
    const valor = this.numero(nombre);
    return valor === null ? null : Math.round(valor);
  }

  fecha(nombre: string): string | null {
    const valor = this.texto(nombre);
    return esFecha(valor) ? valor : null;
  }

  casilla(nombre: string): boolean {
    return this.texto(nombre) === "1";
  }

  todos(): Record<string, string> {
    return { ...this.#campos };
  }
}

export function redirigir(c: Context, ruta: string, mensaje?: { ok?: string; error?: string }) {
  const parametros = new URLSearchParams();
  if (mensaje?.ok) parametros.set("ok", mensaje.ok);
  if (mensaje?.error) parametros.set("error", mensaje.error);
  const consulta = parametros.toString();
  return c.redirect(consulta ? `${ruta}${ruta.includes("?") ? "&" : "?"}${consulta}` : ruta, 303);
}

export function idDe(c: Context): number {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) throw new Error("Identificador no válido.");
  return id;
}
