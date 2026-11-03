import { html } from "hono/html";
import { formatoFecha } from "../../dominio/fechas.ts";
import { NOMBRE_FRECUENCIA } from "../../dominio/recurrencia.ts";
import type { Suscripcion, Suscripciones } from "../../servicios/suscripciones.ts";
import { botonAccion, cifra, eur, eurR, vacio, type Html } from "./comun.ts";

/*
 * Tus suscripciones: cuánto cuestan al mes y al año, cuándo se cobra cada una y cuáles han subido.
 */

function filas(lista: readonly Suscripcion[], boton: (s: Suscripcion) => Html): Html {
  return html`<div class="tabla-contenedor">
    <table class="tabla-apilable tabla-acciones">
      <thead><tr><th>Suscripción</th><th class="numero">Cada cobro</th><th class="numero">Al año</th><th>Próximo cobro</th><th></th></tr></thead>
      <tbody>
        ${lista.map(
          (s) => html`<tr>
            <td>
              <a href="/gastos/${s.id}">${s.nombre}</a>
              <div class="apagado pequeno">${[s.categoria, `desde el ${formatoFecha(s.desde)}`].filter(Boolean).join(" · ")}</div>
              ${s.subida
                ? html`<div class="pequeno negativo">
                    Subió de ${eur(s.subida.antes)} a ${eur(s.subida.ahora)} el ${formatoFecha(s.subida.fecha)} (+${eurR((s.subida.ahora - s.subida.antes) * (s.alAnio / s.importe))} al año)
                  </div>`
                : ""}
            </td>
            <td class="numero">${eur(s.importe)} <span class="apagado pequeno">${NOMBRE_FRECUENCIA[s.frecuencia]}</span></td>
            <td class="numero">${eur(s.alAnio)}</td>
            <td>${s.proximo ? formatoFecha(s.proximo) : "—"}</td>
            <td class="celda-boton">${boton(s)}</td>
          </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

const marcar = (s: Suscripcion, es: boolean, texto: string) => botonAccion(`/gastos/${s.id}/suscripcion`, texto, { pequeno: true, mantenerPosicion: true, campos: { es: es ? "1" : "0" } });

export function vistaSuscripciones(d: Suscripciones): Html {
  const subidas = d.lista.filter((s) => s.subida);
  return html`
    <div class="botones bloque">
      <a class="boton" href="/gastos">← Ingresos y gastos</a>
      <a class="boton" href="/gastos/detectar">¿Te falta alguna? Búscala en tus movimientos</a>
    </div>
    ${d.lista.length
      ? html`<div class="cifras">
            ${cifra("Al mes", eurR(Math.round(d.alAnio / 12)), "contando las anuales repartidas")}
            ${cifra("Al año", eurR(d.alAnio))}
            ${cifra("Suscripciones", String(d.lista.length), subidas.length ? `${subidas.length} ${subidas.length === 1 ? "ha subido" : "han subido"} este año` : undefined)}
          </div>
          <section class="tarjeta">
            <h2>Lo que pagas</h2>
            <p class="apagado">
              ¿Las usas todas? Dar de baja una que no usas te ahorra lo de «Al año». Para quitarla de tus gastos, entra en ella y pon la fecha del último cargo: su
              historial se conserva.
            </p>
            ${filas(d.lista, (s) => marcar(s, false, "No es una suscripción"))}
          </section>`
      : html`<section class="tarjeta">
          ${vacio("No hay ninguna suscripción entre tus gastos fijos. Si pagas alguna, apúntala en Ingresos y gastos o búscala en tus movimientos.")}
        </section>`}
    ${d.posibles.length
      ? html`<section class="tarjeta">
          <h2>¿Alguna de estas también?</h2>
          <p class="apagado">Gastos fijos pequeños que no son esenciales. Si alguno es una suscripción, añádelo para verlo aquí con las demás.</p>
          ${filas(d.posibles, (s) => marcar(s, true, "Es una suscripción"))}
        </section>`
      : ""}
  `;
}
