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

function htmxPrueba() {
  const formulario = $<HTMLFormElement>("[data-htmx-prueba]");
  formulario?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const respuesta = await fetch("/cabeceras/enviado", { method: "POST", body: new URLSearchParams(new FormData(formulario) as any), headers: { "HX-Request": "true" } });
    $<HTMLElement>("[data-resultado-fetch]")!.innerHTML = await respuesta.text();
  });
}

function subirCrudo() {
  const entrada = $<HTMLInputElement>("[data-subir-crudo]");
  entrada?.addEventListener("change", async () => {
    const archivo = entrada.files?.[0];
    if (!archivo) return;
    const respuesta = await fetch("/subir/crudo", { method: "POST", body: await archivo.arrayBuffer(), headers: { "Content-Type": "application/octet-stream", "X-Archivo": encodeURIComponent(archivo.name) } });
    $<HTMLElement>("[data-resultado-crudo]")!.innerHTML = `<p class="ok">Respuesta: ${await respuesta.text()} (el archivo pesaba ${archivo.size} bytes)</p>`;
  });
}

function compartir() {
  const preparar = $<HTMLButtonElement>("[data-preparar-archivo]");
  const boton = $<HTMLButtonElement>("[data-compartir-archivo]");
  const resultado = $<HTMLElement>("[data-resultado-compartir]");
  let archivo: File | null = null;
  preparar?.addEventListener("click", async () => {
    const texto = await (await fetch("/compartir/archivo")).text();
    archivo = new File([texto], "calderilla-prueba.json", { type: "application/json" });
    if (boton) boton.disabled = false;
    if (resultado) resultado.textContent = `Preparado: ${archivo.size} bytes. ¿Se puede compartir? ${navigator.canShare?.({ files: [archivo] }) ?? "no se sabe"}`;
  });
  // El segundo toque conserva el «gesto del usuario» que exige compartir
  boton?.addEventListener("click", async () => {
    if (!archivo) return;
    try {
      await navigator.share({ files: [archivo], title: "Calderilla" });
      if (resultado) resultado.textContent = "Compartido.";
    } catch (error) {
      if (resultado) resultado.textContent = `No se pudo compartir: ${String(error)}`;
    }
  });
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
document.addEventListener("DOMContentLoaded", () => {
  persistir();
  htmxPrueba();
  subirCrudo();
  compartir();
  vueltaDeGoogle();
});
