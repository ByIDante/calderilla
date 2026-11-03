// Sirve dist-prueba/ como lo haría Cloudflare Pages (lo que no existe devuelve index.html), para probar en local.
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const raiz = path.join(import.meta.dirname, "..", "dist-prueba");
const puerto = Number(process.argv[2] ?? 5199);
const TIPOS: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".png": "image/png", ".webmanifest": "application/manifest+json", ".map": "application/json" };
createServer((peticion, respuesta) => {
  const ruta = decodeURIComponent(new URL(peticion.url ?? "/", "http://x").pathname);
  let archivo = path.join(raiz, ruta);
  if (!archivo.startsWith(raiz) || !existsSync(archivo) || statSync(archivo).isDirectory()) archivo = path.join(raiz, "index.html");
  respuesta.writeHead(200, { "Content-Type": TIPOS[path.extname(archivo)] ?? "application/octet-stream", "Cache-Control": ruta === "/sw.js" ? "no-cache" : "max-age=600" });
  respuesta.end(readFileSync(archivo));
}).listen(puerto, "127.0.0.1", () => console.log(`http://localhost:${puerto}`));
