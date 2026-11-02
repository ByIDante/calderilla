# Calderilla

Web local para llevar el control de tu economía: ingresos, gastos fijos y a plazos, cuánto puedes gastar en ocio y qué hacer con lo que te sobra.

- **Gastos fijos y a plazos.** El coche a 250 €/mes durante 5 años se apunta una vez y, cuando acaba, pasa solo a «Finalizados». Los gastos anuales (seguros, IBI, ITV…) se reparten mes a mes. Si cambia un importe, los meses anteriores conservan el que tenían.
- **Cobros cada 15 días y pagas extra.** Una vez al mes, cada semana, cada 2 semanas o dos veces al mes, y con pagas extra en los meses que elijas (junio y diciembre, cada 2 meses…). Todo se reparte para que el presupuesto sea igual cada mes, y la app te enseña mes a mes lo que cobras de verdad.
- **Resumen del mes.** Muestra lo que entra, lo que sale y lo que sobra, con gráficos y una tabla de cierres.
- **Ocio.** Calcula cuánto te queda este mes para ocio y explica de dónde sale la cifra.
- **Calculadora.** Cambia cualquier número (tu sueldo, un gasto, lo que tienes ahorrado, una meta…) y mira cómo quedarían el ocio, el ahorro y tu etapa. Es solo para probar: no se guarda nada.
- **Escalera de inversión.** Según tus gastos y lo que te sobra, te dice en qué etapa estás y qué hacer. Cuando cumples los requisitos, pasas a la siguiente etapa o se desbloquean más opciones.
- **Cartera.** Fondos, ETF, acciones, cripto y divisas, con su valor y lo que ganas o pierdes. Los precios se actualizan solos con fuentes gratuitas, y también puedes ponerlos a mano.
- **Tus movimientos.** Importa el extracto del banco (CSV o Excel) o conecta el banco para que traiga saldos y movimientos solo.

Funciona en tu ordenador, sin cuentas ni suscripciones. **No usa IA ni necesita una cuenta de Claude:** las recomendaciones son reglas fijas. Las diseñaron en octubre de 2026 varios agentes especializados (un gestor de inversiones, un investigador de integraciones y un «abogado del diablo» que atacó el diseño).

> Herramienta informativa: no es asesoramiento financiero personalizado ni regulado por la CNMV. Las reglas sugieren; comprueba siempre las condiciones y la fiscalidad antes de decidir.

## Instalar

### Windows, sin instalar nada (la forma fácil)

[**Descarga Calderilla para Windows**](https://github.com/ByIDante/calderilla/releases/latest/download/Calderilla-Windows.zip). No hace falta cuenta de GitHub, ni Node, ni Git: el ZIP lo lleva todo dentro.

1. Descomprímelo donde quieras, por ejemplo en `Documentos`.
2. Abre **`Crear acceso directo.cmd`** con doble clic. Si Windows avisa de que viene de internet, pulsa **Más información → Ejecutar de todas formas**. Te deja «Calderilla» en el escritorio.
3. Ábrela desde el escritorio. La primera vez te pide una carpeta para tus datos.

Cada vez que la abres busca si hay una versión nueva y la instala sola. Si está abierta mucho tiempo, también mira cada 6 horas y te avisa con un botón para reiniciar e instalarla.

### Windows, con Node

Necesitas **Node.js 24 o superior** ([nodejs.org](https://nodejs.org), versión LTS).

1. Descarga el código: en GitHub, botón **Code → Download ZIP**, y descomprímelo; o, si tienes git, ejecuta `git clone`.
2. Abre la carpeta y haz doble clic en **`Calderilla.cmd`**. La primera vez instala lo necesario (tarda un minuto); después se abre el navegador.
3. Para salir, cierra la ventana negra. Si quieres abrirla con un clic, crea un acceso directo a `Calderilla.cmd` en el escritorio.

### Linux o macOS

Con Node.js 24 o superior:

```bash
npm ci
npm start
```

La app escucha solo en `http://127.0.0.1:5180`, así que nadie de tu red puede verla.

### Abrirla sin terminal

- **Windows:** haz doble clic una vez en **`Crear acceso directo.cmd`** y tendrás «Calderilla» en el escritorio, que la abre sin la ventana negra.
- **Linux:** ejecuta una vez `bash scripts/acceso-linux.sh` y la tendrás en el menú de aplicaciones y en el escritorio.

Para cerrarla, usa **Ajustes → Cerrar Calderilla**: guarda todo antes de salir. Si la abres cuando ya está abierta, solo se abre la pestaña. Lo que va pasando se apunta en `calderilla.log`, dentro de la carpeta de ajustes de cada ordenador.

### Actualizar

- **Windows:** **el acceso directo del escritorio busca e instala la versión nueva cada vez que abres Calderilla**. Sin conexión, se abre igual. El ZIP de la forma fácil lo hace solo; si instalaste con Node, necesitas [Git](https://git-scm.com/download/win) (opciones por defecto). También puedes hacerlo a mano con **`Actualizar.cmd`**.
- **Linux:** `git pull` en la carpeta del programa.

Si se instala una versión nueva mientras Calderilla está abierta, aparece un aviso con el botón **Reiniciar**: guarda todo, se cierra y se vuelve a abrir con la versión nueva.

Tus datos no se tocan al actualizar: están en tu carpeta de datos, no en la del programa.

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

## ¿Dónde apunto cada cosa?

| Qué | Dónde |
|---|---|
| Nómina, alquiler, recibos, el préstamo del coche | Ingresos y gastos |
| Una nómina que cobras cada 15 días o cada semana | Ingresos y gastos, en «Cada cuánto»: dos veces al mes, cada 2 semanas o cada semana |
| Las pagas extra (14 pagas, una extra cada 2 meses…) | En el mismo ingreso: «¿Cobras pagas extra?» y eliges los meses y el importe |
| Tu cuenta de Trade Republic u otra cuenta que paga intereses | Cuentas, tipo «Cuenta remunerada», con su TAE |
| Lo que traspasas cada mes a esa cuenta o a un fondo | Cuentas → Ahorro automático. **No es un gasto**: es ahorro |
| Los intereses que te paga la cuenta | No hace falta: aparecen al actualizar el saldo (la app te enseña la estimación) |
| Fondos, ETF, acciones, cripto, divisas | Inversiones |
| Gastos sueltos de ocio | Ocio, o importando el extracto del banco |

**¿Y si un mes no hago la aportación?** No rompe nada.

- La escalera mira tus saldos reales: el objetivo sigue igual y la fecha estimada se retrasa un poco.
- No hace falta recuperarlo al mes siguiente.
- Al cerrar el mes pones 0 en esa aportación y queda marcada con ✗.
- Solo si en 2 de los 3 últimos cierres ahorras menos de lo previsto, la app baja el presupuesto de ocio hasta que cuadre.

Si la aportación va a un fondo, al cerrar el mes se apunta la compra sola: las participaciones se calculan con el último precio, o las pones tú.

## Cobros que no son uno al mes y pagas extra

- **Cada cuánto.** Además de una vez al mes (o cada 3, 6 o 12 meses), un ingreso o un gasto puede llegar **dos veces al mes** (el día del primer cobro y 15 días después: el 1 y el 16, el 15 y el 30…), **cada 2 semanas** (26 al año: dos meses al año llegan 3) o **cada semana** (52 al año). Cuenta su media: 800 € dos veces al mes son 1.600 € al mes.
- **Pagas extra.** En un ingreso puedes añadir hasta 3, cada una con sus meses (junio y diciembre, julio y diciembre, cada 3 meses, cada 2 meses o los que elijas), su importe y un nombre. Si dejas el importe vacío, es como un cobro normal y sube cuando sube tu sueldo.
- **Se reparten entre los 12 meses**, como los gastos anuales: 14 pagas de 1.500 € cuentan 1.750 € todos los meses. Así el ocio y el ahorro no suben y bajan según el mes. El mes de la paga extra cobras más, pero ese dinero ya contaba repartido en los demás.
- **Dónde se ve.**
  - Mientras rellenas el formulario, te dice cuánto cuenta al mes.
  - La ficha de cada ingreso desglosa el año: cobros, pagas extra, total y lo que cuenta cada mes.
  - En **Ingresos y gastos → Tus ingresos mes a mes** ves, para los próximos 12 meses, lo que cobras de verdad, lo que cuenta tu presupuesto y la diferencia.
  - El Resumen te avisa el mes que cobras de más.
- **Cierres.** Al medir lo que ahorraste de verdad, se tiene en cuenta lo que el presupuesto ya ha contado de tus pagas extra y aún no has cobrado. Sin eso, los meses sin extra parecería que ahorras menos y se bajaría el ocio sin motivo.
- **Al importar** se reconoce la nómina de junio aunque llegue con la extra sumada o en otro movimiento, y «Buscar en mis movimientos» encuentra lo que se cobra cada semana, cada 2 semanas o dos veces al mes.

## Calculadora

Sirve para comprobar los números y para preguntarte «¿y si…?». Parte de tus datos de verdad y nada de lo que cambies se guarda: «Volver a mis números» lo deja todo como estaba.

- **Botones «¿Y si…?»:** «Me suben el sueldo un 5 %», «Todo sube un 10 %» (menos las cuotas de los préstamos), «Quito lo no esencial» y «Me quedo sin ingresos». Rellenan la prueba y se suman a lo que ya hayas cambiado.
- **Lo que puedes cambiar:**
  - el importe de cada ingreso y gasto, o quitarlo;
  - cuánto adelantar de un préstamo, y si reduces el plazo o la cuota;
  - hasta 3 ingresos o gastos de prueba;
  - el dinero de tus cuentas y lo ya gastado en ocio;
  - tus metas, o una de prueba;
  - en «Las reglas (avanzado)», cuánto se ahorra de cada 100 € que te sobran en cada etapa, el ocio mínimo, el colchón y los meses del fondo de emergencia.
- **Lo que ves:**
  - cada cifra **ahora** y **con tu prueba**, con la diferencia y la pantalla en la que aparece;
  - si cambiarías de etapa;
  - cuántos meses aguantarías si dejaras de cobrar, pagando solo lo esencial con lo que tienes en las cuentas;
  - al adelantar un préstamo, los intereses que te ahorras (también contando la comisión), la fecha de fin o la cuota nueva y si la regla dice que compensa;
  - **los próximos 2 años:** un gráfico con lo que tendrías ahorrado y cuándo llegas al colchón, al fondo de emergencia, a invertir y a cada meta. Si gastas más de lo que ingresas, también cuándo te quedarías sin dinero en las cuentas. Supone que cada mes ahorras lo que pide la regla (cambiando de etapa cuando toca) y no cuenta intereses ni la bolsa;
  - el cálculo del ocio paso a paso, con tus números y con los de la prueba.
- **Mismas cuentas.** Usa las mismas fórmulas que el resto de la app: sin cambios, sale exactamente lo mismo que en el Resumen y en Ocio.

## Cuánto puedo gastar en ocio

1. Lo que te sobra = ingresos − gastos esenciales − gastos no esenciales.
2. A eso se le resta el ahorro que pide tu etapa (80 % de lo que sobra al empezar, 50 % al invertir) y lo que piden tus metas. Lo que queda es tu ocio, con un mínimo del 5 % de tus ingresos.
3. Una vez al mes, en **Cuentas y cierres**, apuntas los saldos y cierras el mes. Si en 2 de los 3 últimos cierres ahorraste menos de lo previsto, hay gastos sin apuntar y el ocio baja hasta que cuadre.
4. La mitad de lo que no gastes pasa al mes siguiente.
5. Cuando terminas un préstamo, su cuota va entera a ahorro durante 3 meses antes de repartirse.

## Precios, extractos y bancos

Todo esto es gratis y funciona solo con conexión a internet, sin cuentas de pago ni de Claude. Lo que se vincula (claves, bancos) se guarda en cada ordenador por separado, en **Ajustes → Servicios vinculados**.

- **Precios automáticos.** En cada inversión, busca por ISIN, ticker o nombre y elige el resultado.
  - ETF, acciones y muchos fondos (con su identificador de Morningstar) salen de Yahoo Finance.
  - Las criptomonedas salen de CoinGecko. Funciona sin clave; con una clave Demo gratuita admite más consultas.
  - Los tipos de cambio salen del Banco Central Europeo.
  - Se actualizan al abrir la app cada 12 horas, y con el botón «Actualizar precios».
  - Yahoo no es una API oficial y algunos fondos españoles no aparecen: el precio manual funciona siempre, y si pones uno a mano para un día, ese día gana el tuyo.
- **Importar un extracto** (Ocio → Importar, o Ajustes). Sirve para cualquier banco:
  - Sube el CSV o Excel. La primera vez se adivinan las columnas y las puedes corregir; el formato se recuerda.
  - Los cargos de tus gastos fijos se reconocen y no se cuentan dos veces: por el texto con el que aparecen en el banco (aunque cambie el importe) o, si no se sabe, por importe (±5 %) y fecha (±5 días).
  - El resto se categoriza con reglas del tipo «si el concepto contiene *mercadona* → Alimentación», que puedes ampliar.
  - Si subes el mismo extracto dos veces, no se duplica nada.
  - Lo que pasas de una cuenta tuya a otra (de BBVA a Trade Republic, por ejemplo) se reconoce como **traspaso** cuando están importadas las dos: no cuenta ni como gasto ni como ingreso. En cada movimiento se puede marcar o desmarcar a mano.
- **Encontrado en tus movimientos** (Ingresos y gastos → Buscar en mis movimientos). No hace falta apuntar a mano lo que ya está en tus extractos. Calderilla busca lo que se repite y te lo propone; **nada se crea sin que lo confirmes**:
  - **Gastos e ingresos que se repiten** cada mes, cada 2, 3 o 6 meses o cada año: alquiler, suscripciones, la luz, el seguro, la nómina… Si ya lo tienes apuntado, se une a él; si podría ser uno tuyo (misma categoría, importe parecido), te pregunta. Las subidas de precio se guardan con su fecha, sin cambiar los meses pasados. Lo que se cobra cada 2 meses se apunta como mensual estimado, a mitad de importe.
  - **Gasto variable de cada mes** (súper, gasolina…): lo normal de los últimos meses completos que has importado, como estimación de cada categoría.
  - **Traspasos de cada mes a otra cuenta tuya**, como ahorro automático.
  - **Precios que han cambiado** en tus gastos fijos.
  - **Pagas extra:** si la nómina de un mes llega doble, o con otro movimiento aparte, se propone con sus pagas extra. Si solo se ve la de verano porque lo importado no llega a diciembre, también se propone la de diciembre. Si la nómina ya la tienes apuntada, se proponen las pagas que le faltan.
  - Hacen falta al menos 3 cargos para reconocer algo mensual; un seguro o un impuesto que solo aparece una vez se pregunta como posible anual. Lo que ignores no vuelve a salir.
- **Conectar el banco** (Ajustes → Bancos). Se hace con [Enable Banking](https://enablebanking.com):
  - **Qué necesitas:** una cuenta gratuita y una aplicación registrada en su web, que te da un ID y un archivo de clave `.pem`. Después autorizas cada banco desde su propia app o web.
  - **Coste:** es gratis para uso personal («modo restringido»: solo lee tus propias cuentas).
  - **Qué trae:** saldos y movimientos, cada 12 horas y con un botón. No puede mover dinero.
  - **Renovación:** el permiso dura como mucho 180 días; la app avisa 14 días antes de que caduque.
  - **Bancos:** en octubre de 2026 su lista de España incluía CaixaBank, BBVA, Santander y Sabadell. ING, Openbank, Revolut y Trade Republic no estaban: para esos, importa el extracto.
  - **Dos ordenadores:** algunos bancos solo permiten una sesión por persona, así que vincular el mismo banco en los dos ordenadores puede desconectar uno.
- **Préstamos.** Si amortizas antes de tiempo, apúntalo en el préstamo y elige si reduces la cuota o el plazo. La app recalcula el cuadro, la fecha de fin y los intereses que te ahorras.
- **Perfil de riesgo.** En Ajustes → Perfil hay un cuestionario de 5 preguntas. Tu perfil es el menor entre el riesgo que aguantas y el que te puedes permitir.

## Desarrollo

```bash
npm run dev        # arranca y se reinicia al cambiar el código
npm test           # tests (node:test)
npm run typecheck  # comprobación de tipos
npm run revisar-pantallas -- capturas   # revisa todas las páginas en móvil, tablet, portátil y pantallas grandes
npm run probar-recorridos -- capturas   # apunta pagas extra y juega con la Calculadora en el navegador, comprobando los números
npm run paquete-windows                  # crea dist/Calderilla-Windows.zip (con Node y dependencias dentro)
```

`paquete-windows` empaqueta el último commit (hay que tenerlo todo en commit) con Node 24 para Windows, comprobado con las sumas de nodejs.org, y las dependencias ya instaladas. Para que la gente lo descargue, súbelo a una release de GitHub con el nombre `Calderilla-Windows.zip`: el enlace de «la forma fácil» siempre apunta a la última. Solo hace falta un paquete nuevo si cambia la versión de Node; el código se actualiza solo desde la rama `main`, y las dependencias se reinstalan si cambia `package-lock.json`.

`probar-recorridos` usa los mismos datos de ejemplo y hace con Playwright lo que haría una persona, comprobando las cifras en pantalla:
- apunta un cobro dos veces al mes y una nómina con pagas extra, y mira lo que cuentan al mes, el desglose y el mes a mes;
- encuentra en los movimientos una nómina con su paga extra y la acepta;
- en la Calculadora:
  - sube el sueldo, quita un gasto, añade otro y una meta, y cambia una regla;
  - prueba los botones «¿Y si…?» y adelanta parte del préstamo del coche;
  - mira la proyección a 2 años;
- comprueba que después el Resumen y Ocio siguen igual y que no se ha guardado nada.

Si algo no cuadra, termina con error.

`revisar-pantallas` arranca la app con datos de ejemplo en una carpeta temporal y la abre con Playwright en el Chrome del sistema (390, 820, 1366, 1920 y 2560 px, y en modo oscuro a 390 y 1366). Avisa si:
- la página se desplaza de lado, algo se sale de su tarjeta o una tabla no cabe;
- un texto baja de línea antes de tiempo;
- la sección actual queda fuera del menú;
- en el móvil hay botones demasiado pequeños para el dedo;
- un texto casi no se lee contra su fondo (contraste menor de 3 a 1).

Guarda capturas de las pantallas principales en la carpeta que le digas (las de modo oscuro empiezan por `oscuro-`).

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
  precios/                precios (Yahoo Finance, CoinGecko) y tipos de cambio (BCE)
  importar/               lectura de extractos CSV y Excel
  bancos/                 conexión con Enable Banking
  servidor/               rutas, vistas y seguridad de la web local
test/                     tests (sin red: las respuestas de las APIs están grabadas)
```
