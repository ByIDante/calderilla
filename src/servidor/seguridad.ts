import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";

export const COOKIE = "calderilla";

/**
 * La app solo escucha en 127.0.0.1, pero cualquier web abierta en el navegador podría intentar enviarle
 * formularios (CSRF) o leerla cambiando su DNS para apuntar aquí (DNS rebinding). Por eso:
 * - solo se aceptan peticiones dirigidas a 127.0.0.1 o localhost con nuestro puerto;
 * - los cambios (POST…) deben venir de la propia app (cabecera Origin) y traer el token de este arranque,
 *   guardado en una cookie SameSite=Strict que otras webs no pueden enviar.
 *
 * Algunos envíos de formulario normales (los que suben archivos) llegan con «Origin: null» si el navegador
 * aplica una política de privacidad estricta. Se aceptan: la cookie SameSite=Strict sigue siendo obligatoria
 * y ninguna otra web puede mandarla.
 */
export function seguridad(puerto: number, token: string): MiddlewareHandler {
  const hosts = new Set([`127.0.0.1:${puerto}`, `localhost:${puerto}`]);
  const origenes = new Set([...hosts].map((host) => `http://${host}`));
  return async (c, next) => {
    if (!hosts.has(c.req.header("host") ?? "")) return c.text("Host no permitido", 403);
    const lectura = c.req.method === "GET" || c.req.method === "HEAD";
    if (!lectura) {
      const origen = c.req.header("origin");
      if (origen && origen !== "null" && !origenes.has(origen)) return c.text("Origen no permitido", 403);
      if (getCookie(c, COOKIE) !== token) {
        return c.text("La sesión ha caducado (¿se reinició Calderilla?). Vuelve atrás, recarga la página y repite el cambio.", 403);
      }
    } else if (getCookie(c, COOKIE) !== token) {
      setCookie(c, COOKIE, token, { httpOnly: true, sameSite: "Strict", path: "/" });
    }
    c.header("X-Frame-Options", "DENY");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "same-origin");
    c.header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; form-action 'self'");
    await next();
  };
}
