import { html } from "hono/html";
import type { LineaPresupuesto } from "../../servicios/presupuesto.ts";
import { barra, campo, eur, eurR, type Html } from "./comun.ts";

/** Barras de lo gastado frente al límite de cada categoría que tiene límite. */
export function barrasPresupuesto(lineas: readonly LineaPresupuesto[]): Html {
  const conLimite = lineas.filter((l) => l.limite);
  return html`${conLimite.map(
    (l) => html`<div class="bloque">
      <div class="tarjeta-cabecera" style="margin-bottom:0">
        <span>${l.nombre}</span>
        <span class="numero ${l.gastado > l.limite! ? "negativo" : ""}">${eur(l.gastado)} de ${eurR(l.limite!)}</span>
      </div>
      ${barra(l.gastado, l.limite!, `Gastado en ${l.nombre}`, { limite: true })}
      ${l.proyeccion !== null && l.gastado > 0 && l.gastado <= l.limite! ? html`<p class="apagado pequeno" style="margin:0">A este ritmo, unos ${eurR(l.proyeccion)} a final de mes.</p>` : ""}
    </div>`,
  )}`;
}

export function tarjetaPresupuesto(lineas: readonly LineaPresupuesto[], volver: string): Html {
  const conLimite = lineas.filter((l) => l.limite);
  const sinLimite = lineas.filter((l) => !l.limite && l.gastado > 0);
  return html`<section class="tarjeta" id="presupuesto">
    <h2>Presupuesto por categorías</h2>
    <p class="apagado pequeno">
      Lo que gastas en cosas que varían (comida, gasolina, restaurantes…) frente al máximo que te has puesto. Cuenta lo que apuntas o importas del banco; los cargos de tus
      gastos fijos no, porque ya están en el presupuesto general.
    </p>
    ${conLimite.length ? barrasPresupuesto(lineas) : html`<p>Aún no has puesto ningún límite.</p>`}
    ${sinLimite.length
      ? html`<p class="apagado pequeno">Sin límite: ${sinLimite.map((l) => `${l.nombre} ${eurR(l.gastado)}`).join(" · ")}</p>`
      : ""}
    <details ${conLimite.length ? "" : html`open`}>
      <summary class="boton">Poner o cambiar límites</summary>
      <form method="post" action="/presupuesto" class="formulario" style="margin-top:12px">
        <input type="hidden" name="volver" value="${volver}" />
        <div class="fila-campos">
          ${lineas.map((l) =>
            campo({
              etiqueta: l.nombre,
              nombre: `limite_${l.categoriaId}`,
              valor: l.limite ? String(l.limite / 100).replace(".", ",") : "",
              sufijo: "€",
              marcador: l.sugerido ? String(Math.round(l.sugerido / 100)) : "",
              ayuda: l.sugerido ? `En tus gastos estimas ${eurR(l.sugerido)} al mes.` : undefined,
            }),
          )}
        </div>
        <p class="apagado pequeno">Deja vacío lo que no quieras limitar.</p>
        <div class="botones"><button class="boton boton-principal" type="submit">Guardar límites</button></div>
      </form>
    </details>
  </section>`;
}
