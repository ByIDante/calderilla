// yahoo-finance2 en el móvil: Yahoo no deja consultarlo desde un navegador. Sus precios llegan del ordenador.
const AVISO = "Los precios de Yahoo se actualizan desde el ordenador.";

export default class YahooFinance {
  constructor(_opciones?: unknown) {}

  async search(): Promise<never> {
    throw new Error(AVISO);
  }

  async chart(): Promise<never> {
    throw new Error(AVISO);
  }
}
