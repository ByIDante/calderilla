import type { Hono } from "hono";
import { html } from "hono/html";
import { importeEditable } from "../../dominio/dinero.ts";
import { formatoFecha, mesDe, nombreMes, primerDia, sumarMesesAMes, ultimoDia } from "../../dominio/fechas.ts";
import { leerCuentas } from "../../servicios/cuentas.ts";
import { bd, render, type Estado } from "../app.ts";
import { Formulario, idDe, redirigir } from "../formulario.ts";
import { botonAccion, campo, casilla, eur, selector, vacio, type Html } from "../vistas/comun.ts";

interface Movimiento {
  id: number;
  fecha: string;
  importe: number;
  concepto: string;
  categoria_id: number | null;
  categoria: string | null;
  tipo_categoria: string | null;
  cuenta: string | null;
  cuenta_id: number | null;
  recurrente: string | null;
  origen: string;
}

interface Categoria {
  id: number;
  nombre: string;
  tipo: string;
}

const ORIGEN: Record<string, string> = { manual: "apuntado", csv: "extracto", banco: "banco" };

/** A dónde volver tras un cambio: la misma lista con sus filtros (solo rutas de esta página). */
function volverA(destino: string): string {
  return destino.startsWith("/movimientos") && !destino.startsWith("//") ? destino : "/movimientos";
}

/** Primeras palabras del concepto, para proponer una regla («COMPRA MERCADONA VALENCIA» → «mercadona valencia»). */
function patronSugerido(concepto: string): string {
  const palabras = concepto
    .toLowerCase()
    .replace(/[^a-záéíóúüñ0-9 ]/gi, " ")
    .split(/\s+/)
    .filter((p) => p.length > 2 && !/^(compra|pago|recibo|transferencia|tarjeta|bizum|de|del|con|en)$/.test(p) && !/^\d+$/.test(p));
  return palabras.slice(0, 2).join(" ");
}

function opcionesCategoria(categorias: Categoria[]) {
  return [["", "Sin categoría"] as const, ...categorias.map((c) => [String(c.id), `${c.nombre}${c.tipo === "ocio" ? " (ocio)" : ""}`] as const)];
}

function formularioMovimiento(accion: string, categorias: Categoria[], cuentas: { id: number; nombre: string }[], m: Partial<Movimiento> & { fecha: string }): Html {
  const gasto = (m.importe ?? -1) < 0;
  return html`<form method="post" action="${accion}" class="formulario">
    <div class="fila-campos">
      ${selector("Tipo", "tipo", [["gasto", "Gasto"], ["ingreso", "Ingreso"]], gasto ? "gasto" : "ingreso")}
      ${campo({ etiqueta: "Importe", nombre: "importe", valor: m.importe === undefined ? "" : importeEditable(Math.abs(m.importe)), sufijo: "€", requerido: true })}
      ${campo({ etiqueta: "Fecha", nombre: "fecha", tipo: "date", valor: m.fecha })}
    </div>
    <div class="fila-campos">
      ${campo({ etiqueta: "Concepto", nombre: "concepto", valor: m.concepto, requerido: true })}
      ${selector("Categoría", "categoria", opcionesCategoria(categorias), m.categoria_id ? String(m.categoria_id) : "")}
      ${selector("Cuenta", "cuenta", [["", "—"], ...cuentas.map((c) => [String(c.id), c.nombre] as const)], m.cuenta_id ? String(m.cuenta_id) : "")}
    </div>
    <div class="botones"><button class="boton boton-principal" type="submit">Guardar</button></div>
  </form>`;
}

function leerMovimiento(f: Formulario, categorias: Categoria[]): { error: string } | { fecha: string; importe: number; concepto: string; categoriaId: number | null; cuentaId: number | null } {
  const importe = f.importe("importe");
  const fecha = f.fecha("fecha");
  const concepto = f.texto("concepto");
  const categoriaId = f.entero("categoria");
  if (!importe || importe <= 0) return { error: "Indica el importe (sin signo; elige si es gasto o ingreso)." };
  if (!fecha) return { error: "Indica la fecha." };
  if (!concepto) return { error: "Indica el concepto." };
  if (categoriaId !== null && !categorias.some((c) => c.id === categoriaId)) return { error: "Esa categoría no existe." };
  return { fecha, importe: f.texto("tipo") === "ingreso" ? importe : -importe, concepto, categoriaId, cuentaId: f.entero("cuenta") };
}

export function rutasMovimientos(app: Hono, estado: Estado) {
  const categorias = () => bd(estado).todos<Categoria>("SELECT id, nombre, tipo FROM categorias WHERE archivada = 0 ORDER BY tipo = 'ingreso', nombre");

  app.get("/movimientos", (c) => {
    const base = bd(estado);
    const hoy = estado.hoy();
    const pedido = c.req.query("mes") ?? "";
    const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(pedido) ? pedido : mesDe(hoy);
    const filtroCategoria = c.req.query("categoria") ?? "";
    const buscar = (c.req.query("buscar") ?? "").trim();
    const condiciones = ["a.fecha BETWEEN ? AND ?"];
    const parametros: (string | number)[] = [primerDia(mes), ultimoDia(mes)];
    if (filtroCategoria === "sin") condiciones.push("a.categoria_id IS NULL");
    else if (/^\d+$/.test(filtroCategoria)) {
      condiciones.push("a.categoria_id = ?");
      parametros.push(Number(filtroCategoria));
    }
    if (buscar) {
      condiciones.push("a.concepto LIKE ?");
      parametros.push(`%${buscar}%`);
    }
    const movimientos = base.todos<Movimiento>(
      `SELECT a.id, a.fecha, a.importe, a.concepto, a.categoria_id, a.cuenta_id, a.origen, c.nombre AS categoria, c.tipo AS tipo_categoria,
              cu.nombre AS cuenta, r.nombre AS recurrente
       FROM apuntes a LEFT JOIN categorias c ON c.id = a.categoria_id LEFT JOIN cuentas cu ON cu.id = a.cuenta_id LEFT JOIN recurrentes r ON r.id = a.recurrente_id
       WHERE ${condiciones.join(" AND ")} ORDER BY a.fecha DESC, a.id DESC`,
      ...parametros,
    );
    const lista = categorias();
    const cuentas = leerCuentas(base, hoy);
    const ingresos = movimientos.filter((m) => m.importe > 0).reduce((s, m) => s + m.importe, 0);
    const gastos = movimientos.filter((m) => m.importe < 0).reduce((s, m) => s - m.importe, 0);
    const porCategoria = new Map<string, number>();
    for (const m of movimientos.filter((x) => x.importe < 0)) porCategoria.set(m.categoria ?? "Sin categoría", (porCategoria.get(m.categoria ?? "Sin categoría") ?? 0) - m.importe);
    const sinCategoria = movimientos.filter((m) => !m.categoria_id).length;
    const consulta = new URLSearchParams({ mes, ...(filtroCategoria ? { categoria: filtroCategoria } : {}), ...(buscar ? { buscar } : {}) }).toString();
    const aqui = `/movimientos?${consulta}`;

    return render(
      c,
      estado,
      { titulo: `Movimientos de ${nombreMes(mes)}`, seccion: "movimientos" },
      html`
        <div class="botones bloque">
          <a class="boton" href="/movimientos?mes=${sumarMesesAMes(mes, -1)}">← ${nombreMes(sumarMesesAMes(mes, -1))}</a>
          ${mes < mesDe(hoy) ? html`<a class="boton" href="/movimientos?mes=${sumarMesesAMes(mes, 1)}">${nombreMes(sumarMesesAMes(mes, 1))} →</a>` : ""}
          <a class="boton" href="/importar">Importar un extracto</a>
        </div>
        <p class="apagado">
          Aquí está todo lo que has apuntado, importado o traído del banco. Si un movimiento está en la categoría equivocada, cámbiala en su desplegable. Si se repite (el
          mismo comercio cada mes), entra en él y crea una regla para que la próxima vez se categorice solo.
        </p>
        <div class="cifras">
          <div class="cifra"><div class="cifra-etiqueta">Entradas</div><div class="cifra-valor positivo">${eur(ingresos)}</div></div>
          <div class="cifra"><div class="cifra-etiqueta">Salidas</div><div class="cifra-valor">${eur(gastos)}</div></div>
          <div class="cifra"><div class="cifra-etiqueta">Sin categoría</div><div class="cifra-valor">${sinCategoria}</div></div>
        </div>
        <section class="tarjeta">
          <form method="get" action="/movimientos" class="fila-campos">
            <input type="hidden" name="mes" value="${mes}" />
            ${selector("Categoría", "categoria", [["", "Todas"], ["sin", "Sin categoría"], ...lista.map((x) => [String(x.id), x.nombre] as const)], filtroCategoria)}
            ${campo({ etiqueta: "Buscar en el concepto", nombre: "buscar", valor: buscar, marcador: "mercadona, bizum…" })}
            <div class="campo"><label>&nbsp;</label><button class="boton" type="submit">Filtrar</button></div>
          </form>
          ${movimientos.length
            ? html`<div class="tabla-contenedor">
                <table>
                  <thead><tr><th>Fecha</th><th>Concepto</th><th class="numero">Importe</th><th>Categoría</th><th></th></tr></thead>
                  <tbody>
                    ${movimientos.map(
                      (m) => html`<tr>
                        <td>${formatoFecha(m.fecha)}</td>
                        <td>
                          <a href="/movimientos/${m.id}?volver=${encodeURIComponent(aqui)}">${m.concepto}</a>
                          <div class="apagado pequeno">${[m.cuenta, ORIGEN[m.origen] ?? m.origen, m.recurrente ? `es «${m.recurrente}» (gasto fijo, ya contado)` : null].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td class="numero ${m.importe > 0 ? "positivo" : ""}">${eur(m.importe)}</td>
                        <td>
                          <form method="post" action="/movimientos/${m.id}/categoria">
                            <input type="hidden" name="volver" value="${aqui}" />
                            <select name="categoria" data-enviar-al-cambiar aria-label="Categoría de ${m.concepto}">
                              ${opcionesCategoria(lista).map(([v, t]) => html`<option value="${v}" ${v === (m.categoria_id ? String(m.categoria_id) : "") ? html`selected` : ""}>${t}</option>`)}
                            </select>
                            <noscript><button class="boton boton-pequeno" type="submit">Guardar</button></noscript>
                          </form>
                        </td>
                        <td>${botonAccion(`/movimientos/${m.id}/borrar`, "Borrar", { estilo: "enlace", confirmar: "¿Borrar este movimiento?", campos: { volver: aqui } })}</td>
                      </tr>`,
                    )}
                  </tbody>
                </table>
              </div>`
            : vacio("No hay movimientos con estos filtros.")}
        </section>
        <div class="rejilla">
          <section class="tarjeta">
            <h2>Gastos por categoría</h2>
            ${porCategoria.size
              ? html`<ul class="lista-plana">
                  ${[...porCategoria].sort((a, b) => b[1] - a[1]).map(([nombre, total]) => html`<li><span>${nombre}</span><span class="numero">${eur(total)}</span></li>`)}
                </ul>`
              : html`<p class="apagado">Sin gastos este mes.</p>`}
          </section>
          <section class="tarjeta">
            <h2>Apuntar un movimiento</h2>
            ${formularioMovimiento("/movimientos", lista, cuentas, { fecha: mes === mesDe(hoy) ? hoy : ultimoDia(mes) })}
          </section>
        </div>
      `,
    );
  });

  app.post("/movimientos", async (c) => {
    const f = await Formulario.de(c);
    const leido = leerMovimiento(f, categorias());
    if ("error" in leido) return redirigir(c, "/movimientos", { error: leido.error });
    bd(estado).ejecutar(
      "INSERT INTO apuntes (fecha, importe, concepto, categoria_id, cuenta_id, origen) VALUES (?, ?, ?, ?, ?, 'manual')",
      leido.fecha,
      leido.importe,
      leido.concepto,
      leido.categoriaId,
      leido.cuentaId,
    );
    return redirigir(c, `/movimientos?mes=${mesDe(leido.fecha)}`, { ok: "Movimiento apuntado." });
  });

  app.get("/movimientos/:id", (c) => {
    const base = bd(estado);
    const m = base.uno<Movimiento>(
      `SELECT a.*, c.nombre AS categoria, c.tipo AS tipo_categoria, cu.nombre AS cuenta, r.nombre AS recurrente FROM apuntes a
       LEFT JOIN categorias c ON c.id = a.categoria_id LEFT JOIN cuentas cu ON cu.id = a.cuenta_id LEFT JOIN recurrentes r ON r.id = a.recurrente_id WHERE a.id = ?`,
      idDe(c),
    );
    if (!m) return c.notFound();
    const volver = volverA(c.req.query("volver") ?? `/movimientos?mes=${mesDe(m.fecha)}`);
    const lista = categorias();
    return render(
      c,
      estado,
      { titulo: m.concepto, seccion: "movimientos" },
      html`
        <p><a href="${volver}">← Volver a los movimientos</a></p>
        <section class="tarjeta">
          <h2>Editar</h2>
          ${m.origen !== "manual" ? html`<p class="apagado pequeno">Viene ${m.origen === "banco" ? "del banco" : "de un extracto"}: si lo cambias, no se volverá a importar encima.</p>` : ""}
          ${formularioMovimiento(`/movimientos/${m.id}?volver=${encodeURIComponent(volver)}`, lista, leerCuentas(base, estado.hoy()), m)}
        </section>
        <section class="tarjeta">
          <h2>Que se categorice solo la próxima vez</h2>
          <p class="apagado">Crea una regla: los movimientos que importes cuyo concepto contenga este texto irán a la categoría que elijas.</p>
          <form method="post" action="/movimientos/reglas" class="formulario">
            <input type="hidden" name="volver" value="${volver}" />
            <div class="fila-campos">
              ${campo({ etiqueta: "Si el concepto contiene", nombre: "patron", valor: patronSugerido(m.concepto), requerido: true })}
              ${selector("Categoría", "categoria", opcionesCategoria(lista).slice(1), m.categoria_id ? String(m.categoria_id) : String(lista[0]?.id ?? ""))}
            </div>
            ${casilla("Aplicarla también a los movimientos que ya tengo con ese texto", "aplicar", true)}
            <div class="botones"><button class="boton boton-principal" type="submit">Crear regla</button></div>
          </form>
        </section>
      `,
    );
  });

  app.post("/movimientos/reglas", async (c) => {
    const f = await Formulario.de(c);
    const patron = f.texto("patron").toLowerCase();
    const categoria = f.entero("categoria");
    const volver = volverA(f.texto("volver"));
    if (!patron || !categoria) return redirigir(c, volver, { error: "Indica el texto y la categoría." });
    const base = bd(estado);
    base.ejecutar("INSERT INTO reglas_categoria (patron, categoria_id) VALUES (?, ?) ON CONFLICT (patron) DO UPDATE SET categoria_id = excluded.categoria_id", patron, categoria);
    let aplicados = 0;
    if (f.casilla("aplicar")) {
      // Los cargos de gastos fijos conservan su categoría
      aplicados = base.ejecutar("UPDATE apuntes SET categoria_id = ? WHERE recurrente_id IS NULL AND lower(concepto) LIKE ?", categoria, `%${patron}%`).cambios;
    }
    return redirigir(c, volver, { ok: `Regla «${patron}» creada${aplicados ? ` y aplicada a ${aplicados} movimientos` : ""}.` });
  });

  app.post("/movimientos/:id", async (c) => {
    const id = idDe(c);
    const volver = volverA(c.req.query("volver") ?? "/movimientos");
    const leido = leerMovimiento(await Formulario.de(c), categorias());
    if ("error" in leido) return redirigir(c, `/movimientos/${id}`, { error: leido.error });
    bd(estado).ejecutar(
      "UPDATE apuntes SET fecha = ?, importe = ?, concepto = ?, categoria_id = ?, cuenta_id = ? WHERE id = ?",
      leido.fecha,
      leido.importe,
      leido.concepto,
      leido.categoriaId,
      leido.cuentaId,
      id,
    );
    return redirigir(c, volver, { ok: "Movimiento guardado." });
  });

  app.post("/movimientos/:id/categoria", async (c) => {
    const f = await Formulario.de(c);
    const categoria = f.entero("categoria");
    if (categoria !== null && !categorias().some((x) => x.id === categoria)) return redirigir(c, volverA(f.texto("volver")), { error: "Esa categoría no existe." });
    bd(estado).ejecutar("UPDATE apuntes SET categoria_id = ? WHERE id = ?", categoria, idDe(c));
    return redirigir(c, volverA(f.texto("volver")));
  });

  app.post("/movimientos/:id/borrar", async (c) => {
    const volver = volverA((await Formulario.de(c)).texto("volver"));
    bd(estado).ejecutar("DELETE FROM apuntes WHERE id = ?", idDe(c));
    return redirigir(c, volver, { ok: "Movimiento borrado." });
  });
}
