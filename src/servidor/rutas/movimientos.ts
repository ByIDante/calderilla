import type { Hono } from "hono";
import { html } from "hono/html";
import { importeEditable } from "../../dominio/dinero.ts";
import { formatoFecha, mesDe, nombreMes, primerDia, sumarMesesAMes, ultimoDia } from "../../dominio/fechas.ts";
import { estadoEn } from "../../dominio/recurrencia.ts";
import { claveConcepto } from "../../importar/periodicos.ts";
import { leerCuentas } from "../../servicios/cuentas.ts";
import { leerRecurrentes } from "../../servicios/finanzas.ts";
import { guardarLimites, presupuestoPorCategoria } from "../../servicios/presupuesto.ts";
import { bd, render, type Estado } from "../app.ts";
import { Formulario, idDe, redirigir } from "../formulario.ts";
import { botonAccion, campo, casilla, eur, selector, vacio, type Html } from "../vistas/comun.ts";
import { tarjetaPresupuesto } from "../vistas/presupuesto.ts";

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
  recurrente_id: number | null;
  origen: string;
  traspaso: number | null;
  vinculo_manual: number;
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
    // Banco (entidad de la cuenta) y, dentro de él, una cuenta concreta
    const banco = c.req.query("banco") ?? "";
    const filtroCuenta = c.req.query("cuenta") ?? "";
    const tipo = c.req.query("tipo") === "gastos" ? "gastos" : c.req.query("tipo") === "ingresos" ? "ingresos" : "";
    const condiciones = ["a.fecha BETWEEN ? AND ?"];
    const parametros: (string | number)[] = [primerDia(mes), ultimoDia(mes)];
    if (banco === "sin") condiciones.push("(a.cuenta_id IS NULL OR coalesce(cu.entidad, '') = '')");
    else if (banco) {
      condiciones.push("cu.entidad = ?");
      parametros.push(banco);
    }
    if (/^\d+$/.test(filtroCuenta)) {
      condiciones.push("a.cuenta_id = ?");
      parametros.push(Number(filtroCuenta));
    }
    // Las cifras de arriba (entradas, salidas, sin categoría) solo dependen del mes y del banco
    const condicionesCifras = [...condiciones];
    const parametrosCifras = [...parametros];
    if (tipo === "gastos") condiciones.push("a.importe < 0");
    if (tipo === "ingresos") condiciones.push("a.importe > 0");
    if (filtroCategoria === "sin") condiciones.push("a.categoria_id IS NULL");
    else if (/^\d+$/.test(filtroCategoria)) {
      condiciones.push("a.categoria_id = ?");
      parametros.push(Number(filtroCategoria));
    }
    if (buscar) {
      condiciones.push("a.concepto LIKE ?");
      parametros.push(`%${buscar}%`);
    }
    const cuentas = leerCuentas(base, hoy);
    const movimientos = base.todos<Movimiento>(
      `SELECT a.id, a.fecha, a.importe, a.concepto, a.categoria_id, a.cuenta_id, a.origen, a.traspaso, a.recurrente_id, a.vinculo_manual,
              c.nombre AS categoria, c.tipo AS tipo_categoria, cu.nombre AS cuenta, r.nombre AS recurrente
       FROM apuntes a LEFT JOIN categorias c ON c.id = a.categoria_id LEFT JOIN cuentas cu ON cu.id = a.cuenta_id LEFT JOIN recurrentes r ON r.id = a.recurrente_id
       WHERE ${condiciones.join(" AND ")} ORDER BY a.fecha DESC, a.id DESC`,
      ...parametros,
    );
    const lista = categorias();
    const cifras = base.uno<{ ingresos: number | null; gastos: number | null; sin: number }>(
      // Los traspasos entre tus cuentas no son ni entradas ni salidas de verdad
      `SELECT sum(CASE WHEN a.importe > 0 THEN a.importe END) AS ingresos, -sum(CASE WHEN a.importe < 0 THEN a.importe END) AS gastos,
              count(CASE WHEN a.categoria_id IS NULL THEN 1 END) AS sin
       FROM apuntes a LEFT JOIN cuentas cu ON cu.id = a.cuenta_id WHERE coalesce(a.traspaso, 0) = 0 AND ${condicionesCifras.join(" AND ")}`,
      ...parametrosCifras,
    );
    const ingresos = cifras?.ingresos ?? 0;
    const gastos = cifras?.gastos ?? 0;
    const porCategoria = new Map<string, number>();
    for (const m of movimientos.filter((x) => x.importe < 0 && x.traspaso !== 1)) porCategoria.set(m.categoria ?? "Sin categoría", (porCategoria.get(m.categoria ?? "Sin categoría") ?? 0) - m.importe);
    const sinCategoria = cifras?.sin ?? 0;
    const filtros = { ...(tipo ? { tipo } : {}), ...(banco ? { banco } : {}), ...(/^\d+$/.test(filtroCuenta) ? { cuenta: filtroCuenta } : {}), ...(filtroCategoria ? { categoria: filtroCategoria } : {}), ...(buscar ? { buscar } : {}) };
    const enlace = (cambios: Record<string, string>) => {
      const p = new URLSearchParams({ mes, ...filtros, ...cambios });
      for (const [k, v] of [...p]) if (!v) p.delete(k);
      return `/movimientos?${p}`;
    };
    const aqui = enlace({});

    // Pestañas de bancos: cuántos movimientos tiene cada uno este mes
    const porBanco = new Map(
      base
        .todos<{ entidad: string; n: number }>(
          `SELECT coalesce(nullif(cu.entidad, ''), '') AS entidad, count(*) AS n FROM apuntes a LEFT JOIN cuentas cu ON cu.id = a.cuenta_id
           WHERE a.fecha BETWEEN ? AND ? GROUP BY 1`,
          primerDia(mes),
          ultimoDia(mes),
        )
        .map((f) => [f.entidad, f.n]),
    );
    const bancos = [...new Set(cuentas.map((x) => x.entidad).filter((e): e is string => Boolean(e)))].sort((a, b) => a.localeCompare(b, "es"));
    const totalMes = [...porBanco.values()].reduce((s, n) => s + n, 0);
    const cuentasDelBanco = banco && banco !== "sin" ? cuentas.filter((x) => x.entidad === banco) : [];
    const saldoBanco = cuentasDelBanco.reduce((s, x) => s + x.saldo, 0);

    return render(
      c,
      estado,
      { titulo: `Movimientos de ${nombreMes(mes)}`, seccion: "movimientos" },
      html`
        <div class="botones bloque">
          <a class="boton" href="${enlace({ mes: sumarMesesAMes(mes, -1) })}">← ${nombreMes(sumarMesesAMes(mes, -1))}</a>
          ${mes < mesDe(hoy) ? html`<a class="boton" href="${enlace({ mes: sumarMesesAMes(mes, 1) })}">${nombreMes(sumarMesesAMes(mes, 1))} →</a>` : ""}
          <a class="boton" href="/importar">Importar un extracto</a>
        </div>
        <p class="apagado">
          Aquí está todo lo que has apuntado, importado o traído del banco. Si un movimiento está en la categoría equivocada, cámbiala en su desplegable; para cambiar
          varios a la vez, márcalos y elige la categoría arriba de la lista. Si se repite (el mismo comercio cada mes), entra en él y crea una regla para que la próxima
          vez se categorice solo.
        </p>
        ${bancos.length
          ? html`<nav class="pestanas" aria-label="Elegir banco">
              <a href="${enlace({ banco: "", cuenta: "" })}" aria-current="${banco ? "false" : "true"}">Todos<span class="numero-pestana">${totalMes}</span></a>
              ${bancos.map(
                (b) => html`<a href="${enlace({ banco: b, cuenta: "" })}" aria-current="${banco === b ? "true" : "false"}">${b}<span class="numero-pestana">${porBanco.get(b) ?? 0}</span></a>`,
              )}
              ${porBanco.get("") ? html`<a href="${enlace({ banco: "sin", cuenta: "" })}" aria-current="${banco === "sin" ? "true" : "false"}">Sin banco<span class="numero-pestana">${porBanco.get("")}</span></a>` : ""}
            </nav>
            ${cuentasDelBanco.length > 1
              ? html`<nav class="pestanas pestanas-secundarias" aria-label="Elegir cuenta">
                  <a href="${enlace({ cuenta: "" })}" aria-current="${filtroCuenta ? "false" : "true"}">Todas sus cuentas</a>
                  ${cuentasDelBanco.map((x) => html`<a href="${enlace({ cuenta: String(x.id) })}" aria-current="${filtroCuenta === String(x.id) ? "true" : "false"}">${x.nombre}</a>`)}
                </nav>`
              : ""}`
          : ""}
        <div class="cifras">
          ${cuentasDelBanco.length ? html`<div class="cifra"><div class="cifra-etiqueta">Saldo en ${banco}</div><div class="cifra-valor">${eur(saldoBanco)}</div></div>` : ""}
          <a class="cifra" href="${enlace({ tipo: tipo === "ingresos" ? "" : "ingresos" })}" aria-current="${tipo === "ingresos" ? "true" : "false"}">
            <div class="cifra-etiqueta">Entradas</div><div class="cifra-valor positivo">${eur(ingresos)}</div>
            <div class="cifra-nota">${tipo === "ingresos" ? "Ver todos" : "Ver solo las entradas"}</div>
          </a>
          <a class="cifra" href="${enlace({ tipo: tipo === "gastos" ? "" : "gastos" })}" aria-current="${tipo === "gastos" ? "true" : "false"}">
            <div class="cifra-etiqueta">Salidas</div><div class="cifra-valor">${eur(gastos)}</div>
            <div class="cifra-nota">${tipo === "gastos" ? "Ver todos" : "Ver solo las salidas"}</div>
          </a>
          <a class="cifra" href="${enlace({ categoria: filtroCategoria === "sin" ? "" : "sin" })}" aria-current="${filtroCategoria === "sin" ? "true" : "false"}">
            <div class="cifra-etiqueta">Sin categoría</div><div class="cifra-valor">${sinCategoria}</div>
            <div class="cifra-nota">${filtroCategoria === "sin" ? "Ver todos" : sinCategoria ? "Ver cuáles y ponérsela" : "Todos tienen categoría"}</div>
          </a>
        </div>
        ${banco || filtroCuenta ? "" : tarjetaPresupuesto(presupuestoPorCategoria(base, mes, hoy), aqui)}
        <section class="tarjeta">
          <nav class="pestanas pestanas-secundarias" aria-label="Qué movimientos mostrar">
            <a href="${enlace({ tipo: "" })}" aria-current="${tipo ? "false" : "true"}">Todos</a>
            <a href="${enlace({ tipo: "gastos" })}" aria-current="${tipo === "gastos" ? "true" : "false"}">Solo gastos</a>
            <a href="${enlace({ tipo: "ingresos" })}" aria-current="${tipo === "ingresos" ? "true" : "false"}">Solo ingresos</a>
          </nav>
          <form method="get" action="/movimientos" class="fila-campos">
            <input type="hidden" name="mes" value="${mes}" />
            ${banco ? html`<input type="hidden" name="banco" value="${banco}" />` : ""}
            ${tipo ? html`<input type="hidden" name="tipo" value="${tipo}" />` : ""}
            ${/^\d+$/.test(filtroCuenta) ? html`<input type="hidden" name="cuenta" value="${filtroCuenta}" />` : ""}
            ${selector("Categoría", "categoria", [["", "Todas"], ["sin", "Sin categoría"], ...lista.map((x) => [String(x.id), x.nombre] as const)], filtroCategoria)}
            ${campo({ etiqueta: "Buscar en el concepto", nombre: "buscar", valor: buscar, marcador: "mercadona, bizum…" })}
            <div class="campo"><label>&nbsp;</label><button class="boton" type="submit">Filtrar</button></div>
          </form>
          ${movimientos.length
            ? html`<form id="cambio-masivo" method="post" action="/movimientos/categoria" class="barra-masiva" data-mantener-posicion data-seleccion-masiva>
                  <input type="hidden" name="volver" value="${aqui}" />
                  <label class="elegir-todos"><input type="checkbox" data-marcar-todos /> Marcar todos (${movimientos.length})</label>
                  <span class="apagado pequeno" data-cuenta-marcados>Marca los que quieras y cámbiales la categoría a la vez</span>
                  <div class="barra-masiva-accion">
                    <select name="categoria" aria-label="Categoría nueva para los marcados" required>
                      <option value="" selected disabled>Categoría nueva…</option>
                      <option value="sin">Sin categoría</option>
                      ${opcionesCategoria(lista).slice(1).map(([v, t]) => html`<option value="${v}">${t}</option>`)}
                    </select>
                    <button class="boton boton-pequeno" type="submit">Cambiar categoría</button>
                  </div>
                </form>
                <div class="tabla-contenedor">
                <table class="tabla-acciones tabla-apilable tabla-movimientos">
                  <thead><tr><th class="m-elegir" aria-label="Marcar"></th><th>Fecha</th><th>Concepto</th><th class="numero">Importe</th><th>Categoría</th><th></th></tr></thead>
                  <tbody>
                    ${movimientos.map(
                      (m) => html`<tr>
                        <td class="m-elegir">
                          <label class="elegir"><input type="checkbox" name="ids" value="${m.id}" form="cambio-masivo" aria-label="Marcar ${m.concepto}" /></label>
                        </td>
                        <td class="m-fecha">${formatoFecha(m.fecha)}</td>
                        <td class="m-concepto">
                          <a href="/movimientos/${m.id}?volver=${encodeURIComponent(aqui)}">${m.concepto}</a>
                          <div class="apagado pequeno">
                            ${[m.cuenta, ORIGEN[m.origen] ?? m.origen, m.recurrente ? `es «${m.recurrente}» (gasto fijo, ya contado)` : null, m.traspaso === 1 ? "traspaso entre tus cuentas (no cuenta como gasto ni ingreso)" : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </td>
                        <td class="numero m-importe ${m.importe > 0 ? "positivo" : ""}">${eur(m.importe)}</td>
                        <td class="m-categoria">
                          <form method="post" action="/movimientos/${m.id}/categoria" data-mantener-posicion>
                            <input type="hidden" name="volver" value="${aqui}" />
                            <select name="categoria" data-enviar-al-cambiar aria-label="Categoría de ${m.concepto}">
                              ${opcionesCategoria(lista).map(([v, t]) => html`<option value="${v}" ${v === (m.categoria_id ? String(m.categoria_id) : "") ? html`selected` : ""}>${t}</option>`)}
                            </select>
                            <noscript><button class="boton boton-pequeno" type="submit">Guardar</button></noscript>
                          </form>
                        </td>
                        <td class="celda-boton m-borrar">
                          ${botonAccion(`/movimientos/${m.id}/borrar`, "Borrar", { estilo: "peligro", pequeno: true, mantenerPosicion: true, confirmar: "¿Borrar este movimiento?", campos: { volver: aqui } })}
                        </td>
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

  app.post("/presupuesto", async (c) => {
    const f = await Formulario.de(c);
    const limites = new Map<number, number | null>();
    for (const categoria of categorias().filter((x) => x.tipo !== "ingreso")) {
      const texto = f.texto(`limite_${categoria.id}`);
      const valor = texto ? f.importe(`limite_${categoria.id}`) : null;
      if (texto && (valor === null || valor < 0)) return redirigir(c, volverA(f.texto("volver")), { error: `El límite de ${categoria.nombre} no es un número.` });
      limites.set(categoria.id, valor);
    }
    guardarLimites(bd(estado), limites);
    return redirigir(c, `${volverA(f.texto("volver"))}#presupuesto`, { ok: "Límites guardados." });
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
    const fijos = leerRecurrentes(base).filter((r) => r.tipo === (m.importe < 0 ? "gasto" : "ingreso") && (r.id === m.recurrente_id || estadoEn(r, m.fecha) !== "finalizado"));
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
          <h2>¿Es un gasto fijo o un traspaso?</h2>
          <p class="apagado">
            Si es el cargo de un gasto o ingreso fijo (el alquiler, Netflix, la nómina…), únelo a él: ya está contado en tu presupuesto y no se suma otra vez. Si es dinero
            que pasas de una cuenta tuya a otra, márcalo como traspaso: no es ni gasto ni ingreso.
          </p>
          <form method="post" action="/movimientos/${m.id}/vinculo" class="formulario">
            <input type="hidden" name="volver" value="${volver}" />
            ${selector(
              m.importe < 0 ? "Gasto fijo" : "Ingreso fijo",
              "recurrente",
              [["", m.importe < 0 ? "Ninguno: es un gasto suelto" : "Ninguno"], ...fijos.map((r) => [String(r.id), r.nombre] as const)],
              m.recurrente_id ? String(m.recurrente_id) : "",
            )}
            ${casilla("Es un traspaso entre mis cuentas (no cuenta como gasto ni ingreso)", "traspaso", m.traspaso === 1)}
            <div class="botones"><button class="boton" type="submit">Guardar</button></div>
          </form>
        </section>
        <section class="tarjeta">
          <h2>Que se categorice solo la próxima vez</h2>
          <p class="apagado">Crea una regla: los movimientos que importes cuyo concepto contenga este texto irán a la categoría que elijas.</p>
          <form method="post" action="/movimientos/reglas" class="formulario">
            <input type="hidden" name="volver" value="${volver}" />
            <div class="fila-campos">
              ${campo({ etiqueta: "Si el concepto contiene", nombre: "patron", valor: claveConcepto(m.concepto).clave, requerido: true })}
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

  // Varios movimientos a la vez (va antes de /movimientos/:id para que «categoria» no se tome por un id)
  app.post("/movimientos/categoria", async (c) => {
    const f = await Formulario.de(c);
    const volver = volverA(f.texto("volver"));
    const ids = f.enteros("ids");
    const sin = f.texto("categoria") === "sin";
    const categoria = sin ? undefined : categorias().find((x) => x.id === f.entero("categoria"));
    if (!ids.length) return redirigir(c, volver, { error: "Marca primero los movimientos que quieres cambiar." });
    if (!sin && !categoria) return redirigir(c, volver, { error: "Elige la categoría nueva." });
    const base = bd(estado);
    const cambiados = base.transaccion(() => ids.reduce((total, id) => total + base.ejecutar("UPDATE apuntes SET categoria_id = ? WHERE id = ?", categoria?.id ?? null, id).cambios, 0));
    const cuantos = `${cambiados} ${cambiados === 1 ? "movimiento" : "movimientos"}`;
    return redirigir(c, volver, { ok: categoria ? `${cuantos} ahora en «${categoria.nombre}».` : `${cuantos} ahora sin categoría.` });
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

  // Unir a mano un movimiento a su gasto fijo (o separarlo) y marcarlo como traspaso: la detección lo respeta
  app.post("/movimientos/:id/vinculo", async (c) => {
    const f = await Formulario.de(c);
    const id = idDe(c);
    const volver = volverA(f.texto("volver"));
    const base = bd(estado);
    const m = base.uno<{ importe: number; recurrente_id: number | null; traspaso: number | null; traspaso_par: number | null }>(
      "SELECT importe, recurrente_id, traspaso, traspaso_par FROM apuntes WHERE id = ?",
      id,
    );
    if (!m) return c.notFound();
    const traspaso = f.casilla("traspaso");
    const elegido = traspaso ? null : f.entero("recurrente");
    if (elegido !== null && !leerRecurrentes(base, elegido).some((r) => r.tipo === (m.importe < 0 ? "gasto" : "ingreso"))) {
      return redirigir(c, `/movimientos/${id}?volver=${encodeURIComponent(volver)}`, { error: "Ese gasto fijo no existe." });
    }
    // Solo se toca lo que cambias: guardar sin cambios no debe fijar nada a mano
    base.transaccion(() => {
      if (elegido !== m.recurrente_id) base.ejecutar("UPDATE apuntes SET recurrente_id = ?, vinculo_manual = 1 WHERE id = ?", elegido, id);
      if (traspaso !== (m.traspaso === 1)) {
        base.ejecutar("UPDATE apuntes SET traspaso = ?, traspaso_par = NULL WHERE id = ?", traspaso ? 1 : 0, id);
        // Si dices que no es un traspaso, su pareja de la otra cuenta tampoco
        if (!traspaso && m.traspaso_par !== null) base.ejecutar("UPDATE apuntes SET traspaso = 0, traspaso_par = NULL WHERE id = ?", m.traspaso_par);
      }
    });
    return redirigir(c, volver, { ok: "Movimiento guardado." });
  });

  app.post("/movimientos/:id/borrar", async (c) => {
    const volver = volverA((await Formulario.de(c)).texto("volver"));
    bd(estado).ejecutar("DELETE FROM apuntes WHERE id = ?", idDe(c));
    return redirigir(c, volver, { ok: "Movimiento borrado." });
  });
}
