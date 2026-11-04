// Lo que hace la página en el móvil (el resto lo hace el service worker): instalar y actualizar el service worker,
// recoger el permiso de Google, subir archivos «en crudo», exportar compartiendo y avisar al volver a la app.
import { CABECERA_CRUDO, type DatosCrudo } from "../crudo.ts";

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const esIphone = "standalone" in navigator;

async function instalar() {
  const hueco = $<HTMLElement>("[data-preparando]");
  if (!("serviceWorker" in navigator)) {
    if (hueco) hueco.textContent = "Este navegador no puede instalar Calderilla: prueba con Chrome o Safari actualizados.";
    return;
  }
  // Cuando una versión nueva (o la primera) toma el control, se recarga para que responda ella
  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
  try {
    const registro = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
    void registro.update().catch(() => {});
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void registro.update().catch(() => {}));
  } catch (error) {
    if (hueco) hueco.textContent = `No se ha podido preparar la app: ${String(error)}`;
  }
}

/** Google vuelve con el permiso detrás de «#»: solo lo ve la página, que se lo pasa al service worker. */
async function vueltaDeGoogle() {
  const hueco = $<HTMLElement>("[data-vuelta-google]");
  if (!hueco) return;
  const datos = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
  history.replaceState(null, "", location.pathname);
  try {
    const respuesta = await fetch("/drive/token", { method: "POST", body: JSON.stringify(datos), headers: { "Content-Type": "application/json" } });
    const resultado = (await respuesta.json()) as { ok: boolean; error?: string; volver: string; seguir?: boolean };
    if (resultado.ok || resultado.seguir) {
      location.replace(resultado.volver);
      return;
    }
    hueco.replaceChildren(
      Object.assign(document.createElement("p"), { className: "mal", textContent: resultado.error ?? "No se ha podido conectar." }),
      Object.assign(document.createElement("a"), { className: "boton boton-principal", href: `/drive/conectar?volver=${encodeURIComponent(resultado.volver)}`, textContent: "Volver a intentarlo" }),
    );
  } catch (error) {
    hueco.textContent = `No se ha podido guardar el permiso: ${String(error)}`;
  }
}

/**
 * Los formularios con archivo (importar un extracto o una copia) mandan el archivo solo, en crudo: en iPhone el
 * service worker recibe vacío el formulario con archivo. Él lo rehace (atender.ts) y la ruta no se entera.
 */
function subirEnCrudo() {
  document.addEventListener(
    "submit",
    async (evento) => {
      const formulario = evento.target as HTMLFormElement;
      if (formulario.enctype !== "multipart/form-data") return;
      evento.preventDefault();
      evento.stopImmediatePropagation();
      const boton = formulario.querySelector<HTMLButtonElement>("button[type=submit], button:not([type])");
      if (boton) boton.disabled = true;
      const datos: DatosCrudo = { campo: "", nombre: "", tipo: "", campos: [] };
      let archivo: File | null = null;
      for (const [nombre, valor] of new FormData(formulario)) {
        if (valor instanceof File) [archivo, datos.campo, datos.nombre, datos.tipo] = [valor, nombre, valor.name, valor.type];
        else datos.campos.push([nombre, valor]);
      }
      const respuesta = await fetch(formulario.action, {
        method: "POST",
        body: archivo ? await archivo.arrayBuffer() : new ArrayBuffer(0),
        headers: { "Content-Type": "application/octet-stream", [CABECERA_CRUDO]: encodeURIComponent(JSON.stringify(datos)) },
      });
      location.assign(respuesta.redirected ? respuesta.url : formulario.action);
    },
    true,
  );
}

/** En iPhone, con la app instalada, las descargas no funcionan: «Exportar» abre el menú de compartir. */
function exportarCompartiendo() {
  if (!esIphone || !("share" in navigator)) return;
  let preparado: Promise<File> | null = null;
  const preparar = () =>
    (preparado ??= fetch("/ajustes/exportar").then(async (r) => new File([await r.blob()], /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? "calderilla.json", { type: "application/json" })));
  // El archivo se prepara al pasar por encima (o al tocar): compartir tiene que salir justo al tocar
  document.addEventListener("pointerdown", (evento) => (evento.target as Element).closest?.('a[href="/ajustes/exportar"]') && void preparar());
  document.addEventListener("click", async (evento) => {
    if (!(evento.target as Element).closest?.('a[href="/ajustes/exportar"]')) return;
    evento.preventDefault();
    try {
      await navigator.share({ files: [await preparar()], title: "Calderilla" });
    } catch (error) {
      if ((error as Error).name !== "AbortError") alert(`No se ha podido exportar: ${String(error)}`);
    } finally {
      preparado = null;
    }
  });
}

/** El indicador de arriba cambia cuando el service worker lo dice (subiendo, guardado…) o se va la conexión. */
function indicador() {
  const poner = (clave: string, texto: string, titulo?: string) => {
    const enlace = $<HTMLElement>("[data-estado-sync]");
    if (!enlace) return;
    enlace.dataset.estadoSync = clave;
    if (titulo) enlace.title = enlace.ariaLabel = titulo;
    const hueco = enlace.querySelector<HTMLElement>("[data-estado-sync-texto]");
    if (hueco) hueco.textContent = texto;
  };
  navigator.serviceWorker?.addEventListener("message", (evento: MessageEvent<{ tipo?: string; clave: string; texto: string; titulo: string }>) => {
    if (evento.data?.tipo === "estado-sync") poner(evento.data.clave, evento.data.texto, evento.data.titulo);
  });
  window.addEventListener("offline", () => poner("sin-conexion", "Sin conexión", "Sin conexión: lo apuntado se queda en el móvil"));
  window.addEventListener("online", () => navigator.serviceWorker?.controller?.postMessage({ tipo: "mirar" }));
}

/**
 * Las barras del sistema (la de la hora arriba y la de los gestos abajo) toman el color de «theme-color». Se pone
 * el de la cabecera tal como sale en pantalla, y se cambia si el móvil pasa a modo oscuro con la app abierta.
 */
function colorDeLasBarras() {
  const poner = () => {
    const cabecera = $(".menu") ?? document.body;
    const color = getComputedStyle(cabecera).backgroundColor;
    if (!color || color === "rgba(0, 0, 0, 0)") return;
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = color;
  };
  poner();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => requestAnimationFrame(poner));
}

/** Al volver a la app se mira si hay cambios de otro equipo; al irse, se sube enseguida lo pendiente. */
function avisarAlServiceWorker() {
  const avisar = (tipo: string) => navigator.serviceWorker?.controller?.postMessage({ tipo });
  document.addEventListener("visibilitychange", () => avisar(document.visibilityState === "visible" ? "mirar" : "guardar-ya"));
  window.addEventListener("pagehide", () => avisar("guardar-ya"));
  setInterval(() => document.visibilityState === "visible" && avisar("mirar"), 60_000);
}

void instalar();
document.addEventListener("DOMContentLoaded", () => {
  colorDeLasBarras();
  void navigator.storage?.persist?.();
  void vueltaDeGoogle();
  subirEnCrudo();
  exportarCompartiendo();
  indicador();
  avisarAlServiceWorker();
});
