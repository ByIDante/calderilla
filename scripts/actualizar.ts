// Lo usa el paquete para Windows (Calderilla.vbs y Actualizar.cmd) antes de abrir la app: si GitHub tiene
// una versión nueva, la instala. Sin conexión, o si algo falla, no pasa nada y se abre la que hay.
import { readFileSync } from "node:fs";
import path from "node:path";
import { esPaquete, instalarVersion, ultimaVersion } from "../src/config/actualizar.ts";

const raiz = path.join(import.meta.dirname, "..");
if (esPaquete(raiz)) {
  const instalada = readFileSync(path.join(raiz, "VERSION"), "utf8").trim();
  const ultima = await ultimaVersion();
  if (!ultima) {
    console.log("No se pudo comprobar si hay una versión nueva (¿sin conexión?).");
  } else if (ultima === instalada) {
    console.log("Calderilla está al día.");
  } else {
    try {
      console.log("Instalando la versión nueva de Calderilla...");
      await instalarVersion(raiz, ultima);
      console.log("Calderilla está al día.");
    } catch (error) {
      console.warn("No se pudo instalar la versión nueva:", (error as Error).message);
    }
  }
}
