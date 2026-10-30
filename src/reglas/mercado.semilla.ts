// Datos de mercado con los que arranca la app. Son solo valores iniciales: en Ajustes → Datos de mercado se
// actualizan, y una versión nueva del programa nunca pisa un dato que hayas cambiado tú.
// Comprobados el 30/10/2026 por el agente de diseño; cada uno lleva su fuente.

export interface DatoSemilla {
  clave: string;
  nombre: string;
  tipo: "referencia" | "cuenta" | "letras" | "tramos" | "limite";
  valor: unknown;
  fuente: string;
  comprobado: string;
  finPromocion?: string;
  nota?: string;
}

export const MERCADO_SEMILLA: DatoSemilla[] = [
  {
    clave: "bce_deposito",
    nombre: "Tipo de la facilidad de depósito del BCE",
    tipo: "referencia",
    valor: 2.5,
    fuente: "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/key_ecb_interest_rates/html/index.en.html",
    comprobado: "2026-10-30",
    nota: "Desde el 16/09/2026. Falta confirmar la reunión del 29/10/2026.",
  },
  {
    clave: "cuenta_openbank",
    nombre: "Openbank",
    tipo: "cuenta",
    valor: 3.25,
    fuente: "https://www.helpmycash.com/cuentas/cuentas-remuneradas/",
    comprobado: "2026-10-30",
    nota: "12 meses, clientes nuevos; FGD español",
  },
  {
    clave: "cuenta_trade_republic",
    nombre: "Trade Republic",
    tipo: "cuenta",
    valor: 3.04,
    fuente: "https://www.helpmycash.com/cuentas/cuentas-remuneradas/",
    comprobado: "2026-10-30",
    nota: "hasta 50.000 €, clientes nuevos; parte del efectivo puede ir a fondos monetarios, que no tienen garantía",
  },
  {
    clave: "cuenta_b100",
    nombre: "B100",
    tipo: "cuenta",
    valor: 2.75,
    fuente: "https://www.helpmycash.com/cuentas/cuentas-remuneradas/",
    comprobado: "2026-10-30",
    nota: "FGD español",
  },
  {
    clave: "letras_12m",
    nombre: "Letras del Tesoro a 12 meses",
    tipo: "letras",
    valor: 3.0,
    fuente: "https://www.tesoro.es/deuda-publica/subastas/resultado-ultimas-subastas/letras-del-tesoro",
    comprobado: "2026-10-30",
    nota: "Subasta del 06/10/2026: 2,999 % de media. Próxima subasta: 03/11/2026.",
  },
  {
    clave: "irpf_ahorro",
    nombre: "Tramos del IRPF del ahorro",
    tipo: "tramos",
    valor: [
      { hasta: 6000, tipo: 19 },
      { hasta: 50000, tipo: 21 },
      { hasta: 200000, tipo: 23 },
      { hasta: 300000, tipo: 27 },
      { hasta: null, tipo: 30 },
    ],
    fuente: "https://guiafiscal.es/irpf/tramos-irpf-2026/",
    comprobado: "2026-10-30",
    nota: "Ley 7/2024. Navarra y País Vasco tienen los suyos.",
  },
  {
    clave: "plan_pensiones_individual",
    nombre: "Aportación máxima a un plan individual",
    tipo: "limite",
    valor: 1500,
    fuente: "https://guiafiscal.es/irpf/plan-de-pensiones-limite-aportacion-2026/",
    comprobado: "2026-10-30",
    nota: "O el 30 % de los rendimientos netos del trabajo, lo que sea menor.",
  },
  {
    clave: "plan_pensiones_empresa",
    nombre: "Aportación adicional a un plan de empresa",
    tipo: "limite",
    valor: 8500,
    fuente: "https://guiafiscal.es/irpf/plan-de-pensiones-limite-aportacion-2026/",
    comprobado: "2026-10-30",
    nota: "10.000 € en total con el individual.",
  },
  {
    clave: "fgd_limite",
    nombre: "Fondo de Garantía de Depósitos",
    tipo: "limite",
    valor: 100000,
    fuente: "https://www.fgd.es/",
    comprobado: "2026-10-30",
    nota: "Por persona y entidad.",
  },
];
