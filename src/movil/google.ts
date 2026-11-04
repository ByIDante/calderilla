// Entrar con Google desde el navegador, sin servidor: Google devuelve el permiso (un «token» de una hora) en la
// dirección de vuelta, y la página se lo pasa al service worker.

/** El cliente de Google Cloud de Calderilla. Es público: solo sirve desde calderilla-app.pages.dev. */
export const CLIENTE_GOOGLE = "748824298141-oqh0c3tthp9elfd0bfukk83607otuoa1.apps.googleusercontent.com";
/** Ver y cambiar archivos del Drive: hace falta para usar la carpeta que crea rclone o Google Drive para ordenador. */
export const PERMISO_DRIVE = "https://www.googleapis.com/auth/drive";
export const VUELTA = "/drive/vuelta";

export interface PermisoGoogle {
  token: string;
  /** Cuándo deja de valer (ms), con un minuto de margen. */
  caduca: number;
}

/**
 * La página de Google para dar permiso. `silencioso`: si ya lo diste y sigues con la sesión abierta, vuelve sin
 * preguntar nada (para renovar el permiso al abrir la app).
 */
export function urlDeAcceso(origen: string, estado: string, silencioso: boolean): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: CLIENTE_GOOGLE,
    redirect_uri: `${origen}${VUELTA}`,
    response_type: "token",
    scope: PERMISO_DRIVE,
    state: estado,
    include_granted_scopes: "true",
    ...(silencioso && { prompt: "none" }),
  }).toString();
  return url.toString();
}

/** Lo que llega en la dirección de vuelta (#access_token=…&state=…). */
export function leerVuelta(datos: Record<string, string>, esperado: string | undefined, ahora: number): { permiso: PermisoGoogle } | { error: string; silencioso?: true } {
  if (!esperado || datos.state !== esperado) return { error: "Esa respuesta de Google no es de esta petición. Vuelve a conectar." };
  if (datos.error) {
    // Al renovar sin preguntar: Google necesita que entres o aceptes otra vez
    if (["interaction_required", "login_required", "consent_required", "account_selection_required"].includes(datos.error)) return { error: "Hay que volver a conectar Google Drive.", silencioso: true };
    if (datos.error === "access_denied") return { error: "No has dado permiso a Calderilla para usar tu Google Drive." };
    return { error: `Google ha respondido «${datos.error}». Vuelve a intentarlo.` };
  }
  if (!datos.access_token) return { error: "Google no ha devuelto el permiso. Vuelve a intentarlo." };
  if (!(datos.scope ?? "").split(" ").includes(PERMISO_DRIVE)) return { error: "Falta el permiso de Google Drive: al conectar, marca la casilla que da acceso a Drive." };
  return { permiso: { token: datos.access_token, caduca: ahora + (Number(datos.expires_in ?? 3600) - 60) * 1000 } };
}
