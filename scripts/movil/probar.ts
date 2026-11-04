// Prueba la app del móvil ya construida (dist-movil) en el Chrome del sistema, como un Android, con un Google y
// un Google Drive falsos: la primera vez, apuntar, que llegue a Drive y al PC, sin conexión, un conflicto y una
// versión nueva. No toca tus datos ni tu Drive. Construye ella misma las dos versiones que usa y, al acabar,
// deja dist-movil como estaba antes de la versión nueva.
//
//   node scripts/movil/probar.ts [--copia ruta/a/una/copia.db] [--capturas carpeta]
//
// Con --copia, en lugar de los datos de ejemplo usa esa copia (por ejemplo, una COPIA de las tuyas): así se ve que
// tus datos de verdad se abren bien en el móvil. Solo se lee; tu carpeta no se toca.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, devices, type Route } from "playwright-core";
import { driveFalso } from "../../test/ayuda-carpetas.ts";
import { sembrarEjemplo } from "../ejemplo.ts";
import { revisar } from "../revision.ts";

const raiz = path.join(import.meta.dirname, "..", "..");
const SALIDA = path.join(raiz, "dist-movil");
const carpeta = mkdtempSync(path.join(os.tmpdir(), "calderilla-probar-movil-"));
process.env.CALDERILLA_CONFIG_DIR = carpeta;
const { BaseDatos } = await import("../../src/datos/db.ts");
const { leerNombre, nombreCopia, marcaDe } = await import("../../src/datos/copias.ts");
const { prepararBase } = await import("../../src/servicios/semillas.ts");
const { servir } = await import("./servir.ts");

const construir = (version: string) => execFileSync(process.execPath, [path.join(import.meta.dirname, "construir.ts"), version], { stdio: "ignore" });
const primera = `prueba-${Date.now()}`;
const nueva = `${primera}-nueva`;
construir(primera);

const fallos: string[] = [];
// En GitHub Actions, cada fallo sale además como aviso en la propia ejecución (se ve sin abrir el registro)
const enGithub = Boolean(process.env.GITHUB_ACTIONS);
const avisarEnGithub = (texto: string) => enGithub && console.log(`::error title=Prueba de la app del móvil::${texto.replace(/\n/g, "%0A")}`);
process.on("uncaughtException", (error) => {
  avisarEnGithub(`Se ha parado: ${error.message}`);
  throw error;
});
const comprobar = (cierto: boolean, texto: string) => {
  console.log(`  ${cierto ? "✓" : "✗"} ${texto}`);
  if (!cierto) {
    fallos.push(texto);
    avisarEnGithub(texto);
  }
};
async function hasta(condicion: () => boolean | Promise<boolean>, ms = 10_000) {
  for (const fin = Date.now() + ms; Date.now() < fin; await new Promise((r) => setTimeout(r, 200))) if (await condicion()) return true;
  return false;
}

// El Drive falso, con la copia que dejó el PC: la de ejemplo o la que se pase con --copia
const drive = driveFalso();
const copias = drive.carpeta("copias", drive.carpeta("Calderilla"));
const copiaPropia = process.argv.includes("--copia") ? process.argv[process.argv.indexOf("--copia") + 1] : null;
if (!copiaPropia) {
  const pc = new BaseDatos(path.join(carpeta, "pc.db"));
  prepararBase(pc);
  await sembrarEjemplo(pc);
  pc.escribirMeta("equipo_nombre", "Portátil");
  pc.copiarA(path.join(carpeta, "copia.db"));
  pc.cerrar();
}
drive.archivo(nombreCopia(1, "20261029100000", "aaaaaaaa", null), copias, readFileSync(copiaPropia ?? path.join(carpeta, "copia.db")));
/** Abre una copia de Drive como lo haría el PC. */
function abrirEnElPc(nombre: string) {
  const archivo = [...drive.archivos.values()].find((a) => a.name === nombre && !a.trashed)!;
  const ruta = path.join(carpeta, `${Math.random()}.db`);
  writeFileSync(ruta, archivo.bytes);
  return new BaseDatos(ruta);
}

const servidor = await servir(SALIDA, 5197);
const base = "http://localhost:5197";
const navegador = await chromium.launch({ channel: "chrome" });
const contexto = await navegador.newContext({ ...devices["Pixel 7"] });
// Google da el permiso sin preguntar; Drive es el falso (también para lo que pide el service worker)
await contexto.route("https://accounts.google.com/**", (ruta: Route) => {
  const url = new URL(ruta.request().url());
  const vuelta = `${url.searchParams.get("redirect_uri")}#access_token=bueno&expires_in=3599&token_type=Bearer&scope=${encodeURIComponent(url.searchParams.get("scope")!)}&state=${url.searchParams.get("state")}`;
  return ruta.fulfill({ status: 302, headers: { location: vuelta } });
});
await contexto.route("https://www.googleapis.com/**", async (ruta: Route) => {
  const peticion = ruta.request();
  const cabeceras = peticion.headers();
  const respuesta = await drive.pedir(peticion.url(), {
    method: peticion.method(),
    headers: { Authorization: cabeceras.authorization ?? "", "Content-Type": cabeceras["content-type"] ?? "" },
    body: peticion.postDataBuffer() ?? undefined,
  });
  await ruta.fulfill({ status: respuesta.status, headers: { ...Object.fromEntries(respuesta.headers), "access-control-allow-origin": "*" }, body: Buffer.from(await respuesta.arrayBuffer()) });
});
const pagina = await contexto.newPage();
const errores: string[] = [];
pagina.on("pageerror", (error) => errores.push(error.message));
// Los «¿Seguro?» de los botones se aceptan, como haría quien los pulsa
pagina.on("dialog", (dialogo) => void dialogo.accept());
const texto = async () => ((await pagina.textContent("body")) ?? "").replace(/\s+/g, " ");

console.log("La primera vez");
await pagina.goto(base);
await pagina.waitForSelector("text=Conecta tu Google Drive", { timeout: 20_000 });
comprobar(true, "se instala el service worker y la app pide conectar Drive");
await pagina.click("text=Conectar con Google Drive");
await pagina.waitForSelector("text=¿Dónde están tus copias?", { timeout: 15_000 });
comprobar(/Calderilla\/copias/.test(await texto()), "vuelve de Google con el permiso y enseña la carpeta de copias del PC");
await pagina.fill("input[name=nombre]", "Móvil de pruebas");
await pagina.click("button:has-text('Empezar')");
await pagina.waitForURL(/\/\?ok=/, { timeout: 15_000 });
comprobar(/Datos cargados desde «Calderilla\/copias»/.test(await texto()), "se trae los datos del PC");

console.log("Todas las pantallas");
// Se recorren todos los enlaces de la app: ninguno puede dar error
const vistas = new Set<string>();
const pendientes = ["/"];
const rotas: string[] = [];
while (pendientes.length && vistas.size < 150) {
  const ruta = pendientes.shift()!;
  if (vistas.has(ruta)) continue;
  vistas.add(ruta);
  const respuesta = await pagina.goto(`${base}${ruta}`);
  if (!respuesta || respuesta.status() >= 400 || /Algo ha fallado/.test(await texto())) rotas.push(`${ruta} (${respuesta?.status()})`);
  const enlaces = await pagina.$$eval("a[href^='/']", (as) => as.map((a) => a.getAttribute("href")!));
  for (const enlace of enlaces) if (!/^\/(estatico|drive\/conectar|privacidad|condiciones|ajustes\/exportar)/.test(enlace) && !vistas.has(enlace.split("#")[0]!)) pendientes.push(enlace.split("#")[0]!);
}
comprobar(rotas.length === 0 && vistas.size > 30, `${vistas.size} pantallas sin errores${rotas.length ? `; fallan: ${rotas.join(", ")}` : ""}`);

console.log("Las pantallas en el móvil, en claro y en oscuro");
// Lo mismo que revisar-pantallas: nada se sale, se lee bien y se puede pulsar con el dedo
const capturas = process.argv.includes("--capturas") ? path.resolve(process.argv[process.argv.indexOf("--capturas") + 1]!) : null;
const problemas: string[] = [];
// También con una letra más ancha (DejaVu Sans, la de los ejecutores de GitHub): en algunos móviles no cabe lo mismo
for (const [oscuro, letra] of [[false, null], [true, null], [false, "DejaVu Sans"]] as const) {
  await pagina.emulateMedia({ colorScheme: oscuro ? "dark" : "light" });
  for (const ruta of ["/", "/ocio", "/apuntar", "/movimientos", "/mas", "/gastos", "/ajustes"]) {
    await pagina.goto(`${base}${ruta}`);
    if (letra) await pagina.addStyleTag({ content: `* { font-family: "${letra}" !important; }` });
    for (const problema of await pagina.evaluate(revisar)) problemas.push(`${oscuro ? "oscuro " : ""}${letra ? `${letra} ` : ""}${ruta}: ${problema}`);
    // La barra de la hora del sistema, del color de la cabecera (también en modo oscuro)
    const barras = await pagina.evaluate(() => ({ cabecera: getComputedStyle(document.querySelector(".menu")!).backgroundColor, metas: [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content) }));
    if (!barras.metas.length || barras.metas.some((c) => c !== barras.cabecera)) problemas.push(`${oscuro ? "oscuro " : ""}${ruta}: la barra del sistema (${barras.metas.join(", ")}) no es del color de la cabecera (${barras.cabecera})`);
    if (capturas && !letra) await pagina.screenshot({ path: path.join(capturas, `${oscuro ? "oscuro-" : ""}${ruta === "/" ? "resumen" : ruta.slice(1)}.png`), fullPage: true });
  }
}
await pagina.emulateMedia({ colorScheme: "light" });
comprobar(problemas.length === 0, `sin problemas de tamaño, contraste ni dedos${problemas.length ? `:\n    ${problemas.join("\n    ")}` : ""}`);

console.log("Apuntar");
await pagina.goto(`${base}/ocio`);
await pagina.fill("form[action='/ocio/apunte'] input[name=importe]", "12,50");
await pagina.fill("form[action='/ocio/apunte'] input[name=concepto]", "Cine con amigos");
await pagina.click("form[action='/ocio/apunte'] button[type=submit]");
await pagina.waitForURL(/ok=/);
comprobar(/Apuntado: 12,50\s€/.test(await texto()), "apuntar un gasto de ocio");
const subida = () => drive.nombres(copias).filter((n) => leerNombre(n) && leerNombre(n)!.equipo !== "aaaaaaaa");
const conElGasto = (concepto: string) => subida().find((n) => abrirEnElPc(n).uno("SELECT 1 FROM apuntes WHERE concepto = ?", concepto) !== undefined);
comprobar(await hasta(() => Boolean(conElGasto("Cine con amigos"))), "a los pocos segundos sube a Drive una copia del móvil, y el PC la abre con el gasto dentro");
const delMovil = conElGasto("Cine con amigos")!;

console.log("Cerrar y sin conexión");
const cdp = await contexto.newCDPSession(pagina);
await cdp.send("ServiceWorker.enable");
await cdp.send("ServiceWorker.stopAllWorkers");
await pagina.goto(`${base}/ocio`);
comprobar(/Cine con amigos/.test(await texto()), "con el service worker parado y vuelto a arrancar, el gasto sigue");
await contexto.setOffline(true);
await pagina.goto(`${base}/movimientos`);
comprobar(/Cine con amigos/.test(await texto()), "sin conexión también se abre");
await pagina.goto(`${base}/ocio`);
await pagina.fill("form[action='/ocio/apunte'] input[name=importe]", "3");
await pagina.fill("form[action='/ocio/apunte'] input[name=concepto]", "Café sin conexión");
await pagina.click("form[action='/ocio/apunte'] button[type=submit]");
await pagina.waitForURL(/ok=/);
comprobar(/Apuntado: 3,00\s€/.test(await texto()), "y se puede apuntar sin conexión");
await contexto.setOffline(false);
await pagina.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
comprobar(await hasta(() => subida().some((n) => n !== delMovil && abrirEnElPc(n).uno("SELECT 1 FROM apuntes WHERE concepto = 'Café sin conexión'") !== undefined)), "al volver la conexión, se sube");

console.log("Un conflicto");
// El móvil apunta algo y, antes de que lo suba, el PC guarda un cambio sobre la misma copia
const ultima = leerNombre(subida().sort().at(-1)!)!;
await pagina.goto(`${base}/ocio`);
await pagina.fill("form[action='/ocio/apunte'] input[name=importe]", "8");
await pagina.fill("form[action='/ocio/apunte'] input[name=concepto]", "Cena en el móvil");
await pagina.click("form[action='/ocio/apunte'] button[type=submit]");
await pagina.waitForURL(/ok=/);
const cambiada = abrirEnElPc(ultima.archivo);
cambiada.ejecutar("INSERT INTO cuentas (nombre, tipo) VALUES ('Cuenta nueva del PC', 'corriente')");
cambiada.copiarA(path.join(carpeta, "pc-2.db"));
cambiada.cerrar();
drive.archivo(nombreCopia(ultima.gen + 1, marcaDe(new Date()), "aaaaaaaa", ultima.id), copias, readFileSync(path.join(carpeta, "pc-2.db")));
await hasta(async () => {
  await pagina.goto(`${base}/movimientos`);
  return pagina.url().includes("/ajustes/conflicto");
});
comprobar(/Este móvil \(con cambios sin guardar\)/.test(await texto()), "el móvil enseña el conflicto con sus dos versiones");
comprobar(/Cuenta: Cuenta nueva del PC/.test(await texto()), "y lo que solo está en la del PC");
await pagina.locator("article.version", { hasText: "Este móvil" }).locator("button").click();
await pagina.waitForURL(/ok=Conflicto/);
comprobar(true, "quedarse con la del móvil lo resuelve");

console.log("Una versión nueva");
// Al cambiar de versión la página se recarga sola: si coincide con una visita, se vuelve a intentar
const version = async () => {
  try {
    await pagina.goto(`${base}/ajustes`);
    return /Versión de la app\s*(\S+)/.exec(await texto())?.[1];
  } catch {
    return undefined;
  }
};
const antes = await version();
construir(nueva);
await pagina.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());
comprobar(await hasta(async () => (await pagina.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))), 15_000), "el móvil descarga la versión nueva");
await pagina.goto(`${base}/`);
comprobar(/Hay una versión nueva de Calderilla/.test(await texto()), "y lo avisa en la banda");
await pagina.goto(`${base}/reiniciar`);
await Promise.all([pagina.waitForEvent("load", { timeout: 15_000 }).catch(() => {}), pagina.click("button:has-text('Actualizar ahora')")]);
let despues: string | undefined;
await hasta(async () => (despues = await version()) === nueva, 15_000);
comprobar(antes === primera && despues === nueva, `al aceptar, la app pasa a la versión nueva (${antes} → ${despues})`);
const conDatos = async () => {
  try {
    return /Cine con amigos/.test(await (await pagina.goto(`${base}/movimientos`))!.text());
  } catch {
    return false;
  }
};
comprobar(await hasta(conDatos), "con los datos de antes");

comprobar(errores.length === 0, `sin errores en las páginas${errores.length ? `: ${errores.join("; ")}` : ""}`);
await navegador.close();
servidor.close();
rmSync(carpeta, { recursive: true, force: true });
console.log(fallos.length ? `\n${fallos.length} fallos` : "\nTodo bien");
process.exitCode = fallos.length ? 1 : 0;
