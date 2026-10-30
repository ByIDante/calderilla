import type { Context, Hono } from "hono";
import { html } from "hono/html";
import { esFecha, mesDe, type Fecha } from "../../dominio/fechas.ts";
import { finPorCuotas, mensualEn, type Frecuencia } from "../../dominio/recurrencia.ts";
import { actualizarRecurrente, borrarRecurrente, crearRecurrente, leerRecurrentes, terminarRecurrente, type DatosRecurrente } from "../../servicios/finanzas.ts";
import { bd, render, type Estado } from "../app.ts";
import { Formulario, idDe, redirigir } from "../formulario.ts";
import { aviso } from "../vistas/comun.ts";
import { valoresDe, vistaCuadro, vistaFormulario, vistaLista, type Categoria, type Valores } from "../vistas/gastos.ts";

const FRECUENCIAS: Frecuencia[] = ["mensual", "trimestral", "semestral", "anual"];

/** Convierte el formulario en datos válidos, o devuelve qué falla. */
export function leerGasto(f: Formulario, categorias: Categoria[]): { datos: DatosRecurrente } | { error: string } {
  const tipo = f.texto("tipo") === "ingreso" ? "ingreso" : "gasto";
  const nombre = f.texto("nombre");
  const inicio = f.fecha("inicio");
  const esPrestamo = f.casilla("prestamo") && tipo === "gasto";
  const frecuencia = FRECUENCIAS.find((x) => x === f.texto("frecuencia")) ?? "mensual";
  const importe = f.importe("importe");
  const categoriaId = f.entero("categoria");

  if (!nombre) return { error: "Falta el concepto." };
  if (!inicio) return { error: "Falta la fecha del primer cargo (o es incorrecta)." };
  if (categoriaId !== null && !categorias.some((c) => c.id === categoriaId)) return { error: "Esa categoría no existe." };

  let prestamo: DatosRecurrente["prestamo"] = null;
  if (esPrestamo) {
    const capital = f.importe("capital");
    const tin = f.numero("tin");
    const plazo = f.entero("plazo");
    if (!capital || capital <= 0) return { error: "Indica el capital prestado." };
    if (tin === null || tin < 0 || tin > 100) return { error: "Indica el TIN del préstamo (0 si es sin intereses)." };
    if (!plazo || plazo < 1 || plazo > 600) return { error: "Indica el plazo en meses." };
    prestamo = { capital, tin, tae: f.numero("tae"), plazoMeses: plazo, comisionAmortizacion: f.numero("comision") ?? 0, vinculado: f.casilla("vinculado") };
  } else if (importe === null || importe <= 0) {
    return { error: "Indica el importe (mayor que cero)." };
  }

  let fin: Fecha | null = null;
  if (!esPrestamo && f.texto("fin_modo") === "fecha") {
    fin = f.fecha("fin");
    if (!fin) return { error: "Indica la fecha del último cargo." };
    if (fin < inicio) return { error: "La fecha de fin no puede ser anterior al primer cargo." };
  } else if (!esPrestamo && f.texto("fin_modo") === "cuotas") {
    const cuotas = f.entero("cuotas");
    if (!cuotas || cuotas < 1) return { error: "Indica cuántos pagos son." };
    fin = finPorCuotas(inicio, frecuencia, cuotas);
  }

  return {
    datos: {
      tipo,
      nombre,
      categoriaId,
      frecuencia: esPrestamo ? "mensual" : frecuencia,
      inicio,
      fin,
      // Un préstamo siempre es esencial: dejar de pagarlo no es una opción
      esencial: tipo === "gasto" && (esPrestamo || f.casilla("esencial")),
      clase: f.texto("clase") === "estimacion" ? "estimacion" : "fijo",
      nota: f.opcional("nota"),
      importe: importe ?? 0,
      prestamo,
    },
  };
}

function categorias(estado: Estado): Categoria[] {
  return bd(estado).todos<Categoria>("SELECT id, nombre, tipo FROM categorias WHERE archivada = 0 ORDER BY tipo = 'ingreso' DESC, nombre");
}

function valoresNuevos(c: Context, hoy: Fecha): Valores {
  const tipo = c.req.query("tipo") === "ingreso" ? "ingreso" : "gasto";
  return { tipo, frecuencia: "mensual", inicio: hoy, fin_modo: "sin", clase: "fijo", esencial: tipo === "gasto" ? "1" : "", prestamo: c.req.query("prestamo") ? "1" : "", desde: hoy };
}

export function rutasGastos(app: Hono, estado: Estado) {
  app.get("/gastos", (c) => {
    const hoy = estado.hoy();
    const recurrentes = leerRecurrentes(bd(estado));
    const mensual = new Map(recurrentes.map((r) => [r.id, mensualEn(r, r.versiones, mesDe(hoy))]));
    return render(c, estado, { titulo: "Ingresos y gastos", seccion: "gastos" }, vistaLista(recurrentes, hoy, mensual));
  });

  app.get("/gastos/nuevo", (c) => {
    const hoy = estado.hoy();
    const valores = valoresNuevos(c, hoy);
    const titulo = valores.prestamo ? "Nuevo préstamo" : valores.tipo === "ingreso" ? "Nuevo ingreso" : "Nuevo gasto";
    return render(c, estado, { titulo, seccion: "gastos" }, vistaFormulario({ accion: "/gastos", valores, categorias: categorias(estado), editando: null, hoy }));
  });

  app.post("/gastos", async (c) => {
    const f = await Formulario.de(c);
    const lista = categorias(estado);
    const leido = leerGasto(f, lista);
    if ("error" in leido) {
      return render(
        c,
        estado,
        { titulo: "Nuevo", seccion: "gastos" },
        html`${aviso("error", leido.error)}${vistaFormulario({ accion: "/gastos", valores: f.todos(), categorias: lista, editando: null, hoy: estado.hoy() })}`,
      );
    }
    crearRecurrente(bd(estado), leido.datos);
    return redirigir(c, "/gastos", { ok: `Guardado «${leido.datos.nombre}».` });
  });

  app.get("/gastos/:id", (c) => {
    const hoy = estado.hoy();
    const [r] = leerRecurrentes(bd(estado), idDe(c));
    if (!r) return c.notFound();
    return render(c, estado, { titulo: r.nombre, seccion: "gastos" }, vistaFormulario({ accion: `/gastos/${r.id}`, valores: valoresDe(r, hoy), categorias: categorias(estado), editando: r, hoy }));
  });

  app.post("/gastos/:id", async (c) => {
    const id = idDe(c);
    const [r] = leerRecurrentes(bd(estado), id);
    if (!r) return c.notFound();
    const f = await Formulario.de(c);
    const lista = categorias(estado);
    const leido = leerGasto(f, lista);
    const hoy = estado.hoy();
    if ("error" in leido) {
      return render(
        c,
        estado,
        { titulo: r.nombre, seccion: "gastos" },
        html`${aviso("error", leido.error)}${vistaFormulario({ accion: `/gastos/${id}`, valores: f.todos(), categorias: lista, editando: r, hoy })}`,
      );
    }
    actualizarRecurrente(bd(estado), id, leido.datos, f.fecha("desde") ?? hoy);
    return redirigir(c, "/gastos", { ok: `Guardado «${leido.datos.nombre}».` });
  });

  app.post("/gastos/:id/terminar", async (c) => {
    const id = idDe(c);
    const f = await Formulario.de(c);
    const fecha = f.texto("fecha");
    if (!esFecha(fecha)) return redirigir(c, `/gastos/${id}`, { error: "Indica la fecha del último cargo." });
    terminarRecurrente(bd(estado), id, fecha);
    return redirigir(c, "/gastos", { ok: "Hecho: deja de contar a partir de esa fecha." });
  });

  app.post("/gastos/:id/borrar", (c) => {
    borrarRecurrente(bd(estado), idDe(c));
    return redirigir(c, "/gastos", { ok: "Borrado." });
  });

  app.get("/gastos/:id/cuadro", (c) => {
    const [r] = leerRecurrentes(bd(estado), idDe(c));
    if (!r) return c.notFound();
    return render(c, estado, { titulo: `Cuadro de amortización: ${r.nombre}`, seccion: "gastos" }, vistaCuadro(r, estado.hoy()));
  });
}
