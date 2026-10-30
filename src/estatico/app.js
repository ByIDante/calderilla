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
    const apilado = datos.apilado === true;
    // Colores en orden fijo (paleta validada): hasta 6 series; el resto se agrupa en «Otras» antes de llegar aquí
    const series = datos.series.map((serie, i) => ({
      label: serie.nombre,
      data: serie.valores,
      backgroundColor: color(`--serie-${(i % 6) + 1}`),
      borderColor: apilado ? color("--superficie") : color(`--serie-${(i % 6) + 1}`),
      borderRadius: apilado ? 0 : 4,
      borderSkipped: "start",
      maxBarThickness: 28,
      borderWidth: datos.tipo === "line" ? 2 : apilado ? 1 : 0,
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
        scales: horizontal
          ? { x: { ...ejeValor, stacked: apilado }, y: { ...ejeCategoria, stacked: apilado } }
          : { x: { ...ejeCategoria, stacked: apilado }, y: { ...ejeValor, stacked: apilado } },
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

// Los enlaces a otras webs (el banco, fuentes de datos…) se abren en una pestaña nueva: Calderilla se queda en la suya
function enlacesExternos(raiz) {
  for (const enlace of raiz.querySelectorAll("a[href]")) {
    if (enlace.origin && enlace.origin !== location.origin) {
      enlace.target = "_blank";
      enlace.rel = "noopener noreferrer";
    }
  }
}

// Mientras autorizas en la pestaña del banco, esta pregunta cada 2 s si ya ha terminado y se actualiza sola
let esperando = null;
function esperarAutorizacion(raiz) {
  const aviso = raiz.querySelector?.("[data-esperar-autorizacion]") ?? document.querySelector("[data-esperar-autorizacion]");
  clearInterval(esperando);
  if (!aviso) return;
  const token = aviso.dataset.esperarAutorizacion;
  esperando = setInterval(async () => {
    if (!document.body.contains(aviso)) return clearInterval(esperando);
    try {
      const respuesta = await (await fetch(`/bancos/autorizacion/${token}`)).json();
      if (respuesta.estado === "pendiente") return;
      clearInterval(esperando);
      const consulta = new URLSearchParams();
      if (respuesta.ok) consulta.set("ok", respuesta.ok);
      if (respuesta.error) consulta.set("error", respuesta.error);
      if (respuesta.estado === "desconocida") consulta.set("error", "La autorización ha caducado. Vuelve a conectar el banco.");
      location.href = `/bancos?${consulta}`;
    } catch {
      // Sin respuesta (p. ej. Calderilla reiniciándose): se vuelve a intentar
    }
  }, 2000);
}

// Página de «Reiniciando…»: en cuanto responde la Calderilla nueva se vuelve a la app (si se está
// instalando una versión nueva puede tardar más de lo normal)
function esperarVuelta(raiz) {
  if (!(raiz.querySelector?.("[data-esperar-vuelta]") ?? document.querySelector("[data-esperar-vuelta]"))) return;
  const inicio = Date.now();
  const intentar = async () => {
    try {
      // Los primeros instantes aún contesta la anterior, que está cerrándose
      if (Date.now() - inicio > 2000 && (await fetch("/", { cache: "no-store" })).ok) {
        location.href = "/";
        return;
      }
    } catch {
      // Todavía no ha vuelto
    }
    setTimeout(intentar, 1000);
  };
  setTimeout(intentar, 1000);
}

// Cambiar la categoría de varios movimientos a la vez: las casillas de la lista van al formulario de la
// barra (atributo form). «Marcar todos», cuántos hay marcados y mayúsculas + clic para marcar un tramo
const casillasDe = (formulario) => [...document.querySelectorAll(`input[type="checkbox"][form="${formulario.id}"]`)];
function contarMarcados(formulario) {
  const casillas = casillasDe(formulario);
  const marcados = casillas.filter((x) => x.checked).length;
  const texto = formulario.querySelector("[data-cuenta-marcados]");
  if (texto) texto.textContent = marcados ? `${marcados} ${marcados === 1 ? "marcado" : "marcados"}` : "Marca los que quieras y cámbiales la categoría a la vez";
  const todos = formulario.querySelector("[data-marcar-todos]");
  if (todos) {
    todos.checked = marcados > 0 && marcados === casillas.length;
    todos.indeterminate = marcados > 0 && marcados < casillas.length;
  }
  const boton = formulario.querySelector('button[type="submit"]');
  if (boton) boton.disabled = marcados === 0;
}
function prepararSeleccion(raiz) {
  for (const formulario of raiz.querySelectorAll?.("form[data-seleccion-masiva]") ?? []) contarMarcados(formulario);
}
document.addEventListener("change", (evento) => {
  const casilla = evento.target;
  if (casilla.matches?.("[data-marcar-todos]")) {
    for (const x of casillasDe(casilla.form)) x.checked = casilla.checked;
    contarMarcados(casilla.form);
  } else if (casilla.form?.matches("[data-seleccion-masiva]")) {
    contarMarcados(casilla.form);
  }
});
let ultimaMarcada = null;
document.addEventListener("click", (evento) => {
  const casilla = evento.target;
  if (!casilla.matches?.('input[type="checkbox"][form]') || !casilla.form?.matches("[data-seleccion-masiva]")) return;
  if (evento.shiftKey && ultimaMarcada?.form === casilla.form && document.body.contains(ultimaMarcada)) {
    const casillas = casillasDe(casilla.form);
    const [desde, hasta] = [casillas.indexOf(ultimaMarcada), casillas.indexOf(casilla)].sort((a, b) => a - b);
    for (const x of casillas.slice(desde, hasta + 1)) x.checked = casilla.checked;
    contarMarcados(casilla.form);
  }
  ultimaMarcada = casilla;
});

// Tarjetas plegables con data-recordar-plegado: se recuerda si las dejaste cerradas
function recordarPlegado(raiz) {
  for (const detalle of raiz.querySelectorAll?.("details[data-recordar-plegado]") ?? []) {
    const clave = `calderilla:plegado:${detalle.dataset.recordarPlegado}`;
    try {
      if (localStorage.getItem(clave) === "cerrado") detalle.open = false;
    } catch {
      // Sin almacenamiento, se queda como venga
    }
    detalle.addEventListener("toggle", () => {
      try {
        localStorage.setItem(clave, detalle.open ? "abierto" : "cerrado");
      } catch {
        // Igual que arriba
      }
    });
  }
}

// Tablas que en el móvil se ven como fichas: cada celda lleva el nombre de su columna
function etiquetarTablas(raiz) {
  for (const tabla of raiz.querySelectorAll?.("table.tabla-apilable") ?? []) {
    const nombres = [...tabla.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    for (const fila of tabla.querySelectorAll("tbody tr, tfoot tr")) {
      // Cuenta las columnas que ocupa cada celda (colspan) para dar a cada una el nombre de la suya
      let columna = 0;
      for (const celda of fila.children) {
        const ocupa = Number(celda.getAttribute("colspan") ?? 1);
        if (ocupa === 1 && nombres[columna] && !celda.hasAttribute("data-etiqueta")) celda.setAttribute("data-etiqueta", nombres[columna]);
        columna += ocupa;
      }
    }
  }
}

// En pantallas estrechas el menú es una fila que se desliza: que se vea la sección en la que estás
function menuALaVista(raiz) {
  const actual = raiz.querySelector?.('.menu a[aria-current="page"]');
  const fila = actual?.closest("ul");
  if (!fila || fila.scrollWidth <= fila.clientWidth) return;
  const caja = fila.getBoundingClientRect();
  const enlace = actual.getBoundingClientRect();
  fila.scrollLeft += enlace.left - caja.left - (caja.width - enlace.width) / 2;
}

function preparar(raiz) {
  menuALaVista(raiz);
  recordarPlegado(raiz);
  etiquetarTablas(raiz);
  pintarGraficos(raiz);
  actualizarDependientes(document);
  enlacesExternos(raiz);
  esperarAutorizacion(raiz);
  esperarVuelta(raiz);
  prepararSeleccion(raiz);
}

document.addEventListener("change", () => actualizarDependientes(document));
// Formularios marcados con data-mantener-posicion: al volver a la misma página, se queda donde estabas
const CLAVE_POSICION = "calderilla:posicion";
document.addEventListener("submit", (evento) => {
  if (!evento.target.closest?.("[data-mantener-posicion]")) return;
  try {
    sessionStorage.setItem(CLAVE_POSICION, JSON.stringify({ ruta: location.pathname, y: window.scrollY }));
  } catch {
    // Sin almacenamiento solo se pierde la comodidad
  }
});
function recuperarPosicion() {
  try {
    const guardada = JSON.parse(sessionStorage.getItem(CLAVE_POSICION) ?? "null");
    sessionStorage.removeItem(CLAVE_POSICION);
    // Después de que htmx haga su propio desplazamiento al cambiar la página
    if (guardada && guardada.ruta === location.pathname) setTimeout(() => window.scrollTo(0, guardada.y), 0);
  } catch {
    // Igual que arriba
  }
}
document.addEventListener("htmx:afterSettle", recuperarPosicion);
document.addEventListener("DOMContentLoaded", recuperarPosicion);

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
