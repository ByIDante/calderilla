import type { Hono } from "hono";
import { html } from "hono/html";
import { bd, render } from "../../servidor/estado.ts";
import { botonAccion, eur, vacio } from "../../servidor/vistas/comun.ts";
import type { EstadoMovil } from "../estado.ts";
import { estadoIndicador } from "../vistas.ts";

/** Las secciones que no caben en la barra de abajo. */
const MAS: [string, string, string][] = [
  ["/gastos", "Ingresos y gastos", "Lo fijo: nómina, alquiler, préstamos, suscripciones…"],
  ["/cuentas", "Cuentas y cierres", "Saldos y el cierre de cada mes"],
  ["/inversiones", "Inversiones", "Tu cartera y la escalera"],
  ["/metas", "Metas", "Lo que estás ahorrando para algo"],
  ["/calculadora", "Calculadora", "¿Y si…? Prueba cambios sin guardarlos"],
  ["/anio", "Tu año en cifras", "Lo que entró y salió, mes a mes"],
  ["/importar", "Importar un extracto", "CSV o Excel de tu banco"],
  ["/ajustes", "Ajustes", "Tu perfil, este móvil y las copias"],
];

/** Lo diario en el móvil: apuntar un gasto en dos toques, y «Más» para el resto. */
export function rutasApuntar(app: Hono, estado: EstadoMovil) {
  app.get("/apuntar", (c) => {
    const base = bd(estado);
    const hoy = estado.hoy();
    // Las categorías que más usas en los gastos de los últimos tres meses, primero
    const categorias = base.todos<{ id: number; nombre: string }>(
      `SELECT c.id, c.nombre FROM categorias c
       LEFT JOIN apuntes a ON a.categoria_id = c.id AND a.importe < 0 AND a.fecha >= date(?, '-90 days')
       WHERE c.archivada = 0 AND c.tipo != 'ingreso'
       GROUP BY c.id ORDER BY count(a.id) DESC, c.tipo != 'ocio', c.nombre`,
      hoy,
    );
    const conceptos = base.todos<{ concepto: string }>(
      `SELECT concepto FROM apuntes WHERE origen = 'manual' AND importe < 0 AND fecha >= date(?, '-180 days')
       GROUP BY concepto ORDER BY count(*) DESC, max(fecha) DESC LIMIT 20`,
      hoy,
    );
    const deHoy = base.todos<{ id: number; importe: number; concepto: string; categoria: string | null }>(
      "SELECT a.id, a.importe, a.concepto, c.nombre AS categoria FROM apuntes a LEFT JOIN categorias c ON c.id = a.categoria_id WHERE a.fecha = ? ORDER BY a.id DESC LIMIT 8",
      hoy,
    );
    return render(
      c,
      estado,
      { titulo: "Apuntar un gasto", seccion: "apuntar" },
      html`<form method="post" action="/ocio/apunte" class="formulario apuntar">
          <input type="hidden" name="volver" value="/apuntar" />
          <label class="apuntar-importe" for="apuntar-importe">
            <span class="sr">Importe</span>
            <input id="apuntar-importe" type="text" name="importe" inputmode="decimal" autocomplete="off" placeholder="0,00" required autofocus />
            <span aria-hidden="true">€</span>
          </label>
          <div class="campo">
            <label for="apuntar-concepto">Concepto</label>
            <input id="apuntar-concepto" type="text" name="concepto" list="apuntar-conceptos" autocomplete="off" placeholder="¿En qué?" />
            <datalist id="apuntar-conceptos">${conceptos.map((c) => html`<option value="${c.concepto}"></option>`)}</datalist>
          </div>
          <fieldset class="apuntar-categorias">
            <legend>Categoría</legend>
            ${categorias.map(
              (cat, i) => html`<input type="radio" id="cat-${cat.id}" name="categoria" value="${cat.id}" ${i === 0 ? "checked" : ""} /><label for="cat-${cat.id}">${cat.nombre}</label>`,
            )}
          </fieldset>
          <details class="apuntar-fecha">
            <summary>Fue otro día</summary>
            <div class="campo"><label for="apuntar-dia">Fecha</label><input id="apuntar-dia" type="date" name="fecha" value="${hoy}" max="${hoy}" /></div>
          </details>
          <button class="boton boton-principal apuntar-guardar" type="submit">Apuntar</button>
        </form>
        <section class="tarjeta">
          <h2>Hoy</h2>
          ${deHoy.length
            ? html`<ul class="lista-plana">
                ${deHoy.map((a) => html`<li><a href="/movimientos/${a.id}">${a.concepto}</a><span class="numero">${eur(-a.importe)}${a.categoria ? html` <span class="apagado pequeno">${a.categoria}</span>` : ""}</span></li>`)}
              </ul>`
            : vacio("Aún no has apuntado nada hoy.")}
          <p class="apagado pequeno">¿Un ingreso o un traspaso? Apúntalo en <a href="/movimientos">Movimientos</a>.</p>
        </section>`,
    );
  });

  app.get("/mas", (c) => {
    const indicador = estadoIndicador(estado, true);
    const local = estado.sync!.estadoLocal();
    return render(
      c,
      estado,
      { titulo: "Más", seccion: "mas" },
      html`<ul class="lista-mas">
          ${MAS.map(([ruta, nombre, detalle]) => html`<li><a href="${ruta}"><b>${nombre}</b><span class="apagado pequeno">${detalle}</span></a></li>`)}
        </ul>
        <section class="tarjeta">
          <h2>Guardado en Drive</h2>
          <p>${indicador.titulo}.</p>
          <ul class="lista-plana">
            <li><span>Carpeta</span><span>${estado.ajustes.carpetaRuta ?? "?"}</span></li>
            <li><span>Cambios sin guardar en Drive</span><span>${local.sucio ? "sí" : "no"}</span></li>
          </ul>
          <div class="botones bloque">${botonAccion("/ajustes/copiar", "Guardar copia ahora")} <a class="boton" href="/ajustes/copias">Copias de seguridad</a></div>
        </section>`,
    );
  });
}
