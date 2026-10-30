import type { BaseDatos } from "../datos/db.ts";
import { esClaveParametro, parametrosPorDefecto, type Parametros } from "../reglas/parametros.ts";
import type { Estabilidad, Perfil, PerfilRiesgo, ProductoMercado } from "../reglas/tipos.ts";

export interface PerfilCompleto extends Perfil {
  situacionLaboral: "asalariado" | "autonomo" | "funcionario" | "otra";
  comunidad: string;
}

const PERFIL_POR_DEFECTO: PerfilCompleto = {
  estabilidad: "normal",
  riesgo: "moderado",
  tipoMarginal: null,
  tipoRescate: null,
  aportacionEmpresa: 0,
  situacionLaboral: "asalariado",
  comunidad: "",
};

export function leerPerfil(bd: BaseDatos): PerfilCompleto {
  const filas = bd.todos<{ clave: string; valor: string | null }>("SELECT clave, valor FROM perfil");
  const guardado = Object.fromEntries(filas.map((fila) => [fila.clave, fila.valor === null ? null : JSON.parse(fila.valor)])) as Partial<PerfilCompleto>;
  return { ...PERFIL_POR_DEFECTO, ...guardado };
}

export function guardarPerfil(bd: BaseDatos, perfil: Partial<PerfilCompleto>) {
  bd.transaccion(() => {
    for (const [clave, valor] of Object.entries(perfil)) {
      bd.ejecutar("INSERT INTO perfil (clave, valor) VALUES (?, ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor", clave, JSON.stringify(valor ?? null));
    }
  });
}

export function perfilConfigurado(bd: BaseDatos): boolean {
  return (bd.uno<{ n: number }>("SELECT count(*) AS n FROM perfil")?.n ?? 0) > 0;
}

export const ESTABILIDADES: Estabilidad[] = ["estable", "normal", "inestable"];
export const RIESGOS: PerfilRiesgo[] = ["conservador", "moderado", "dinamico", "agresivo"];

export function leerParametros(bd: BaseDatos): Parametros {
  const parametros = parametrosPorDefecto();
  for (const { clave, valor } of bd.todos<{ clave: string; valor: number }>("SELECT clave, valor FROM parametros")) {
    if (esClaveParametro(clave)) parametros[clave] = valor;
  }
  return parametros;
}

export function guardarParametros(bd: BaseDatos, cambios: Partial<Parametros>) {
  const defecto = parametrosPorDefecto();
  bd.transaccion(() => {
    for (const [clave, valor] of Object.entries(cambios)) {
      if (!esClaveParametro(clave) || valor === undefined) continue;
      // Si vuelve al valor por defecto se borra, para que futuras mejoras del programa le lleguen
      if (valor === defecto[clave]) bd.ejecutar("DELETE FROM parametros WHERE clave = ?", clave);
      else bd.ejecutar("INSERT INTO parametros (clave, valor) VALUES (?, ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor", clave, valor);
    }
  });
}

export interface DatoMercado {
  clave: string;
  nombre: string;
  tipo: "referencia" | "cuenta" | "letras" | "tramos" | "limite";
  valor: unknown;
  fuente: string | null;
  comprobado: string;
  finPromocion: string | null;
  nota: string | null;
  origen: "semilla" | "usuario";
}

export function leerMercado(bd: BaseDatos): DatoMercado[] {
  return bd
    .todos<{ clave: string; nombre: string; tipo: DatoMercado["tipo"]; valor: string; fuente: string | null; comprobado: string; fin_promocion: string | null; nota: string | null; origen: DatoMercado["origen"] }>(
      "SELECT * FROM datos_mercado ORDER BY tipo, nombre",
    )
    .map((fila) => ({ ...fila, valor: JSON.parse(fila.valor) as unknown, finPromocion: fila.fin_promocion }));
}

export function productoDe(dato: DatoMercado): ProductoMercado {
  return { nombre: dato.nombre, tae: Number(dato.valor), comprobado: dato.comprobado, finPromocion: dato.finPromocion, nota: dato.nota };
}

export function limiteFgd(datos: DatoMercado[]): number {
  const dato = datos.find((d) => d.clave === "fgd_limite");
  return Math.round(Number(dato?.valor ?? 100000) * 100);
}
