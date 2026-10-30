// Comportamiento de las páginas: gráficos y campos que se muestran u ocultan. Se vuelve a ejecutar cada vez
// que htmx cambia el contenido (navegación con hx-boost).

function color(variable) {
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
}

const formatoEuros = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

function pintarGraficos(raiz) {
  if (!window.Chart) return;
  for (const lienzo of raiz.querySelectorAll("canvas[data-grafico]")) {
    if (lienzo.dataset.pintado) continue;
    const fuente = document.getElementById(lienzo.dataset.grafico);
    if (!fuente) continue;
    const datos = JSON.parse(fuente.textContent);
    lienzo.dataset.pintado = "1";
    const series = datos.series.map((serie, i) => ({
      label: serie.nombre,
      data: serie.valores,
      backgroundColor: color(`--serie-${i + 1}`),
      borderColor: color(`--serie-${i + 1}`),
      borderRadius: 4,
      borderSkipped: "start",
      maxBarThickness: 28,
      borderWidth: datos.tipo === "line" ? 2 : 0,
      pointRadius: datos.tipo === "line" ? 4 : 0,
      tension: 0,
    }));
    const horizontal = datos.horizontal === true;
    // Barras horizontales: la altura crece con el número de categorías para no dejar barras sueltas en un lienzo enorme
    if (horizontal) lienzo.parentElement.style.height = `${70 + datos.etiquetas.length * 40}px`;
    const ejeValor = {
      grid: { color: color("--rejilla") },
      border: { color: color("--eje") },
      ticks: { color: color("--apagado"), callback: (v) => formatoEuros.format(v) },
    };
    const ejeCategoria = { grid: { display: false }, border: { color: color("--eje") }, ticks: { color: color("--apagado") } };
    new window.Chart(lienzo, {
      type: datos.tipo ?? "bar",
      data: { labels: datos.etiquetas, datasets: series },
      options: {
        indexAxis: horizontal ? "y" : "x",
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: series.length > 1, position: "top", align: "start", labels: { color: color("--tinta-suave"), boxWidth: 12, boxHeight: 12 } },
          tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${formatoEuros.format(c.parsed[horizontal ? "x" : "y"])}` } },
        },
        scales: horizontal ? { x: ejeValor, y: ejeCategoria } : { x: ejeCategoria, y: ejeValor },
      },
    });
  }
}

function cumple(condicion) {
  const [id, valor] = condicion.split("=");
  const campo = document.getElementById(id);
  if (!campo) return null;
  if (campo.type === "checkbox") return campo.checked;
  return valor === undefined ? Boolean(campo.value) : valor.split("|").includes(campo.value);
}

// Muestra u oculta bloques según otro campo: data-mostrar-si="id[=valor|valor]" o data-ocultar-si="id[=valor]".
// Los campos ocultos se desactivan para que no se envíen.
function actualizarDependientes(raiz) {
  const bloques = [...raiz.querySelectorAll("[data-mostrar-si], [data-ocultar-si]")];
  for (const bloque of bloques) {
    const mostrar = bloque.dataset.mostrarSi ? cumple(bloque.dataset.mostrarSi) : true;
    const ocultar = bloque.dataset.ocultarSi ? cumple(bloque.dataset.ocultarSi) : false;
    if (mostrar === null || ocultar === null) continue;
    bloque.classList.toggle("oculto", !(mostrar && !ocultar));
  }
  // Un campo dentro de cualquier bloque oculto (aunque esté anidado) queda desactivado
  for (const bloque of bloques) {
    for (const entrada of bloque.querySelectorAll("input, select")) entrada.disabled = Boolean(entrada.closest(".oculto"));
  }
}

function preparar(raiz) {
  pintarGraficos(raiz);
  actualizarDependientes(document);
}

document.addEventListener("change", () => actualizarDependientes(document));
// Desplegables que guardan al cambiar (p. ej. la categoría de un movimiento)
document.addEventListener("change", (evento) => {
  if (evento.target.matches?.("select[data-enviar-al-cambiar]")) evento.target.form?.requestSubmit();
});
// ✕ de los avisos que solo se esconden hasta recargar
document.addEventListener("click", (evento) => {
  const boton = evento.target.closest?.("[data-cerrar-aviso]");
  if (boton) boton.closest(".aviso")?.remove();
});
document.addEventListener("DOMContentLoaded", () => preparar(document));
document.addEventListener("htmx:load", (evento) => preparar(evento.target));
