# Calderilla

Web local para llevar el control de tu economía: ingresos, gastos fijos y a plazos, cuánto puedes gastar en ocio y qué hacer con lo que te sobra.

- **Gastos fijos y a plazos.** El coche a 250 €/mes durante 5 años se apunta una vez y, cuando acaba, pasa solo a «Finalizados». Los gastos anuales (seguros, IBI, ITV…) se reparten mes a mes. Si cambia un importe, los meses anteriores conservan el que tenían.
- **Resumen del mes.** Muestra lo que entra, lo que sale y lo que sobra, con gráficos y una tabla de cierres.
- **Ocio.** Calcula cuánto te queda este mes para ocio y explica de dónde sale la cifra.
- **Escalera de inversión.** Según tus gastos y lo que te sobra, te dice en qué etapa estás y qué hacer. Cuando cumples los requisitos, pasas a la siguiente etapa o se desbloquean más opciones.
- **Cartera.** Fondos, ETF, acciones, cripto y divisas, con su valor y lo que ganas o pierdes.

Funciona en tu ordenador, sin cuentas ni suscripciones. **No usa IA ni necesita una cuenta de Claude:** las recomendaciones son reglas fijas. Las diseñaron en octubre de 2026 varios agentes especializados (un gestor de inversiones, un investigador de integraciones y un «abogado del diablo» que atacó el diseño).

> Herramienta informativa: no es asesoramiento financiero personalizado ni regulado por la CNMV. Las reglas sugieren; comprueba siempre las condiciones y la fiscalidad antes de decidir.

## Instalar

Necesitas **Node.js 24 o superior** ([nodejs.org](https://nodejs.org), versión LTS).

### Windows

1. Descarga el código: en GitHub, botón **Code → Download ZIP**, y descomprímelo; o, si tienes git, ejecuta `git clone`.
2. Abre la carpeta y haz doble clic en **`Calderilla.cmd`**. La primera vez instala lo necesario (tarda un minuto); después se abre el navegador.
3. Para salir, cierra la ventana negra. Si quieres abrirla con un clic, crea un acceso directo a `Calderilla.cmd` en el escritorio.

### Linux o macOS

```bash
npm ci
npm start
```

La app escucha solo en `http://127.0.0.1:5180`, así que nadie de tu red puede verla.

## Tus datos

La primera vez te pide una **carpeta de datos**. Elige una que se sincronice entre tus ordenadores, como Google Drive, Dropbox, OneDrive o Syncthing, por ejemplo `G:\Mi unidad\Calderilla`. En el otro ordenador, elige la misma carpeta y se cargarán tus datos.

- **Cómo se guarda.** Cada ordenador trabaja sobre su propia copia. Unos segundos después de cada cambio, y al cerrar, deja en `copias/` una copia nueva que **nunca sobrescribe** las anteriores.
- **Si guardas en dos ordenadores a la vez.** Calderilla te avisa y eliges con qué versión sigues. No mezcla nada por su cuenta, y la otra versión queda apartada en la carpeta, sin borrarse.
- **Copias de seguridad.** Esas copias ya hacen de copia de seguridad: se guarda todo de la última semana, una copia por día del último mes y una por mes del último año. En Ajustes también puedes exportarlo todo a JSON.
- **Nada va a GitHub.** Ni tus datos ni tus claves se suben, y `.gitignore` y un hook de git lo impiden. Los ajustes de cada ordenador (carpeta de datos y claves) están en `%APPDATA%\calderilla` en Windows, `~/.config/calderilla` en Linux y `~/Library/Application Support/calderilla` en macOS.

## La escalera de inversión

La etapa actual es la primera cuyo requisito aún no cumples:

| Etapa | Estás en ella si… | La regla sugiere |
|---|---|---|
| 1. Cuadrar gastos | Gastas más de lo que ingresas | Recortar, empezando por lo no esencial |
| 2. Colchón | Tienes menos de un mes de gastos esenciales (mínimo 1.000 €) | Apartar en la cuenta corriente o remunerada |
| 3. Deuda cara | Alguna deuda tiene una TAE del 7 % o más | Pagar de más la de mayor TAE |
| 4. Fondo de emergencia | Tienes menos de 3, 6 o 9 meses de gastos esenciales, según la estabilidad de tus ingresos | Cuenta remunerada o fondo monetario |
| 5. Metas cercanas | Una meta a menos de 3 años no llega a tiempo | Cambiar la fecha o el importe (nunca bolsa) |
| 6. Invertir | Has cumplido todo lo anterior | Aportación automática a fondos indexados según tu perfil |

Tu «por debajo de X € mejor una cuenta remunerada» es la etapa 4, y la X sale de tus gastos: 6 meses × tus gastos esenciales. Para volver a una etapa ya superada tienes que bajar del 80 % de su objetivo, así que un mes flojo no deshace el plan.

En «Invertir» se desbloquean más opciones cuando cumples cada requisito:

- **Plan de pensiones de empresa:** si tu empresa aporta. Este se desbloquea antes, al completar el colchón.
- **Letras del Tesoro o depósitos:** si te sobra liquidez varios meses seguidos.
- **Plan de pensiones individual:** si tu tipo marginal de IRPF compensa. Te enseña el ahorro en euros.
- **Amortizar deuda barata:** si te ahorra más que lo que da el dinero sin riesgo.
- **Parte especulativa (cripto y divisas):** con un tope según tu perfil.
- **Reequilibrar la cartera:** primero con las aportaciones y, si no basta, con traspasos entre fondos, que no tributan.

Cada recomendación tiene un **«¿Por qué?»** con la fórmula y los números. Los umbrales se cambian en **Ajustes → Parámetros**.

Los tipos de interés de cuentas y Letras, los tramos del IRPF y los límites de los planes de pensiones están en **Ajustes → Datos de mercado**. Cada dato lleva su fuente y la fecha en que se comprobó. Si un dato tiene más de 90 días, la app te pide verificarlo y deja de usarlo para recomendar. Una versión nueva del programa nunca pisa un dato que hayas cambiado tú.

## Cuánto puedo gastar en ocio

1. Lo que te sobra = ingresos − gastos esenciales − gastos no esenciales.
2. A eso se le resta el ahorro que pide tu etapa (80 % de lo que sobra al empezar, 50 % al invertir) y lo que piden tus metas. Lo que queda es tu ocio, con un mínimo del 5 % de tus ingresos.
3. Una vez al mes, en **Cuentas y cierres**, apuntas los saldos y cierras el mes. Si en 2 de los 3 últimos cierres ahorraste menos de lo previsto, hay gastos sin apuntar y el ocio baja hasta que cuadre.
4. La mitad de lo que no gastes pasa al mes siguiente.
5. Cuando terminas un préstamo, su cuota va entera a ahorro durante 3 meses antes de repartirse.

## Desarrollo

```bash
npm run dev        # arranca y se reinicia al cambiar el código
npm test           # tests (node:test)
npm run typecheck  # comprobación de tipos
```

- **Ejecución:** Node ejecuta el TypeScript directamente, sin compilar.
- **Servidor web:** Hono, con plantillas HTML y htmx; los gráficos son de Chart.js.
- **Base de datos:** `node:sqlite`, que viene con Node.
- **Tests:** cada push los pasa en GitHub Actions, en Linux y en Windows.

```
src/
  main.ts                 arranque y navegador
  config/ajustes.ts       ajustes de este ordenador
  datos/                  base de datos, migraciones y sincronización por copias
  dominio/                dinero, fechas, recurrencias y préstamos (sistema francés)
  reglas/                 escalera, deudas, ocio, parámetros y datos de mercado iniciales
  servicios/              lectura y escritura de los datos para las reglas y las pantallas
  servidor/               rutas, vistas y seguridad de la web local
test/                     tests
```
