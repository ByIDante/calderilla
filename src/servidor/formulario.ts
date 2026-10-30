import type { Context } from "hono";
import { leerImporte, leerNumero } from "../dominio/dinero.ts";
import { esFecha } from "../dominio/fechas.ts";

/** Lectura cómoda de los campos de un formulario, aceptando importes con coma o punto. */
export class Formulario {
  readonly #campos: Record<string, string>;

  constructor(campos: Record<string, string>) {
    this.#campos = campos;
  }

  static async de(c: Context): Promise<Formulario> {
    const cuerpo = await c.req.parseBody();
    return new Formulario(Object.fromEntries(Object.entries(cuerpo).filter((e): e is [string, string] => typeof e[1] === "string")));
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
