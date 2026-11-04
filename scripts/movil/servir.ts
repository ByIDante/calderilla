// Sirve dist-movil/ como Cloudflare Pages, para probar la app del móvil en local: las cabeceras de _headers, las
// direcciones sin «.html» (/privacidad) y, para lo que no existe, la página de arranque.
//
//   node scripts/movil/servir.ts [puerto]
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json",
};

/** Las reglas de _headers: una dirección (o «/*») y sus cabeceras sangradas debajo. */
function leerCabeceras(texto: string): { ruta: string; cabeceras: [string, string][] }[] {
  const reglas: { ruta: string; cabeceras: [string, string][] }[] = [];
  for (const linea of texto.split("\n")) {
    if (!linea.trim() || linea.trim().startsWith("#")) continue;
    if (!/^\s/.test(linea)) reglas.push({ ruta: linea.trim(), cabeceras: [] });
    else reglas.at(-1)?.cabeceras.push(linea.trim().split(/:\s*/, 2) as [string, string]);
  }
  return reglas;
}

export function servir(carpeta: string, puerto: number): Promise<Server> {
  const reglas = leerCabeceras(readFileSync(path.join(carpeta, "_headers"), "utf8"));
  const servidor = createServer((peticion, respuesta) => {
    const ruta = decodeURIComponent(new URL(peticion.url ?? "/", "http://x").pathname);
    const candidatos = [ruta, `${ruta}.html`, path.join(ruta, "index.html")].map((r) => path.join(carpeta, r));
    const archivo = candidatos.find((c) => c.startsWith(carpeta) && existsSync(c) && statSync(c).isFile()) ?? path.join(carpeta, "index.html");
    const cabeceras: Record<string, string> = { "Content-Type": TIPOS[path.extname(archivo)] ?? "application/octet-stream" };
    for (const regla of reglas) {
      if (regla.ruta === ruta || (regla.ruta.endsWith("/*") && ruta.startsWith(regla.ruta.slice(0, -1)))) for (const [nombre, valor] of regla.cabeceras) cabeceras[nombre] = valor;
    }
    respuesta.writeHead(200, cabeceras);
    respuesta.end(readFileSync(archivo));
  });
  return new Promise((listo) => servidor.listen(puerto, "127.0.0.1", () => listo(servidor)));
}

if (import.meta.main) {
  const puerto = Number(process.argv[2] ?? 5199);
  await servir(path.join(import.meta.dirname, "..", "..", "dist-movil"), puerto);
  console.log(`App del móvil en http://localhost:${puerto}`);
}
