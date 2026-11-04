// La parte de la prueba que corre en la página (no en el service worker): registrar el service worker, pedir
// almacenamiento persistente, subir en crudo, compartir, recoger el permiso de Google y avisar de versiones nuevas.
export {};

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const navegador = navigator as Navigator & { standalone?: boolean };

async function registrar() {
  if (!("serviceWorker" in navigator)) {
    document.body.insertAdjacentHTML("afterbegin", `<p class="mal">Este navegador no tiene service workers.</p>`);
    return;
  }
  const registro = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  // La primera vez, cuando el service worker toma el control, se recarga para que sea él quien responda
  if (!navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
  }
  vigilarVersion(registro);
}

function vigilarVersion(registro: ServiceWorkerRegistration) {
  const aviso = $<HTMLElement>("[data-version-nueva]");
  const boton = $<HTMLButtonElement>("[data-activar-version]");
  const mostrar = () => {
    if (!registro.waiting) {
      if (aviso) aviso.textContent = "No hay versión nueva (o aún se está descargando).";
      return;
    }
    if (aviso) aviso.textContent = "Hay una versión nueva lista.";
    if (boton) {
      boton.hidden = false;
      boton.onclick = () => registro.waiting?.postMessage({ tipo: "activar" });
    }
  };
  registro.addEventListener("updatefound", () => registro.installing?.addEventListener("statechange", mostrar));
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (boton && !boton.hidden) location.reload();
  });
  registro.update().catch(() => {}).finally(mostrar);
}

async function persistir() {
  const hueco = $<HTMLElement>("[data-persistir]");
  const pedido = await navigator.storage?.persist?.().catch(() => null);
  if (hueco) hueco.textContent = `La página pidió almacenamiento persistente: ${String(pedido)} · instalada como app: ${String(navegador.standalone ?? matchMedia("(display-mode: standalone)").matches)}`;
}

// Tras guardar con htmx el navegador tiene que quedarse en la dirección nueva (en la app instalada no hay barra para verla)
function direccion() {
  const hueco = $<HTMLElement>("[data-direccion]");
  if (!hueco) return;
  const ahora = location.pathname + location.search;
  const igual = ahora === hueco.dataset.esperada;
  hueco.innerHTML = `<p class="${igual ? "ok" : "mal"}">${igual ? "✓" : "✗"} La dirección ahora es ${ahora}</p>`;
}

// El formulario normal lleva el tamaño del archivo, para que el service worker compruebe que le llega entero
function medir() {
  const entrada = $<HTMLInputElement>("[data-medir]");
  entrada?.addEventListener("change", () => {
    const tamano = entrada.form?.querySelector<HTMLInputElement>("input[name=tamano]");
    if (tamano) tamano.value = String(entrada.files?.[0]?.size ?? "");
  });
}

function subirCrudo() {
  const entrada = $<HTMLInputElement>("[data-subir-crudo]");
  entrada?.addEventListener("change", async () => {
    const archivo = entrada.files?.[0];
    const hueco = $<HTMLElement>("[data-resultado-crudo]")!;
    if (!archivo) return;
    try {
      const respuesta = await fetch("/subir/crudo", { method: "POST", body: await archivo.arrayBuffer(), headers: { "Content-Type": "application/octet-stream", "X-Archivo": encodeURIComponent(archivo.name) } });
      const llego: { nombre: string; bytes: number } = await respuesta.json();
      hueco.innerHTML =
        llego.bytes === archivo.size && llego.nombre === archivo.name
          ? `<p class="ok">✓ Ha llegado entero: «${llego.nombre}», ${llego.bytes} bytes</p>`
          : `<p class="mal">✗ Ha llegado «${llego.nombre}» con ${llego.bytes} bytes, y pesaba ${archivo.size}</p>`;
    } catch (error) {
      hueco.innerHTML = `<p class="mal">✗ No se pudo subir: ${String(error)}</p>`;
    }
  });
}

// Los archivos se preparan al abrir la página: compartir exige que se llame justo al tocar el botón
async function compartir() {
  const preparado = $<HTMLElement>("[data-preparado]");
  if (!preparado) return;
  const archivos: Record<string, File> = {
    json: new File([await (await fetch("/compartir/archivo")).text()], "calderilla-prueba.json", { type: "application/json" }),
    csv: new File([await (await fetch("/compartir/archivo.csv")).text()], "calderilla-prueba.csv", { type: "text/csv" }),
  };
  const puede = "share" in navigator;
  preparado.textContent = puede ? "Listo para compartir." : "Este navegador no tiene el menú de compartir.";
  for (const boton of document.querySelectorAll<HTMLButtonElement>("[data-compartir]")) {
    const tipo = boton.dataset.compartir!;
    const resultado = $<HTMLElement>(`[data-resultado-compartir="${tipo}"]`)!;
    boton.disabled = !puede;
    boton.addEventListener("click", async () => {
      try {
        await navigator.share({ files: [archivos[tipo]!], title: "Calderilla" });
        resultado.innerHTML = `<span class="ok">✓ Compartido</span>`;
      } catch (error) {
        const nombre = (error as Error).name;
        resultado.innerHTML =
          nombre === "AbortError"
            ? `<span class="ok">✓ Salió el menú y lo cerraste: funciona</span>`
            : nombre === "NotAllowedError"
              ? `<span class="mal">✗ El móvil no deja compartir este tipo de archivo (${String(error)})</span>`
              : `<span class="mal">✗ No se pudo compartir: ${String(error)}</span>`;
      }
    });
  }
}

async function vueltaDeGoogle() {
  const hueco = $<HTMLElement>("[data-vuelta-google]");
  if (!hueco) return;
  const datos = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
  history.replaceState(null, "", location.pathname);
  const respuesta = await fetch("/drive/token", { method: "POST", body: JSON.stringify(datos), headers: { "Content-Type": "application/json" } });
  const resultado = await respuesta.json();
  hueco.innerHTML = resultado.ok ? `<span class="ok">Conectado. <a href="/drive">Seguir con la prueba</a></span>` : `<span class="mal">No se pudo: ${resultado.error}</span>`;
}

registrar();
// htmx cambia la página sin recargarla: la dirección se vuelve a mirar al terminar (sea cual sea el orden de los dos avisos)
document.addEventListener("htmx:pushedIntoHistory", direccion);
document.addEventListener("htmx:afterSettle", () => setTimeout(direccion, 50));
document.addEventListener("DOMContentLoaded", () => {
  persistir();
  direccion();
  medir();
  subirCrudo();
  compartir();
  vueltaDeGoogle();
});
