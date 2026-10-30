-- Importes en céntimos (enteros); fechas "AAAA-MM-DD"; meses "AAAA-MM"; porcentajes como 3.04.

-- Estado de la sincronización de esta copia (no dispara los avisos de cambio)
CREATE TABLE meta (
  clave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE TABLE categorias (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL CHECK (tipo IN ('esencial', 'ocio', 'otro', 'ingreso')),
  archivada INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE cuentas (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('corriente', 'remunerada', 'monetario', 'deposito', 'letras', 'broker', 'efectivo', 'plan_pensiones', 'otra')),
  entidad TEXT,
  moneda TEXT NOT NULL DEFAULT 'EUR',
  tae REAL,
  vencimiento TEXT,
  archivada INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE saldos (
  id INTEGER PRIMARY KEY,
  cuenta_id INTEGER NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL,
  saldo INTEGER NOT NULL,
  origen TEXT NOT NULL DEFAULT 'manual',
  UNIQUE (cuenta_id, fecha)
);

CREATE TABLE recurrentes (
  id INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('ingreso', 'gasto')),
  nombre TEXT NOT NULL,
  categoria_id INTEGER REFERENCES categorias(id),
  frecuencia TEXT NOT NULL CHECK (frecuencia IN ('mensual', 'trimestral', 'semestral', 'anual')),
  inicio TEXT NOT NULL,
  fin TEXT,
  esencial INTEGER NOT NULL DEFAULT 0,
  clase TEXT NOT NULL DEFAULT 'fijo' CHECK (clase IN ('fijo', 'estimacion')),
  nota TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cada cambio de importe es una versión nueva: los meses anteriores conservan el importe que tenían
CREATE TABLE recurrentes_importes (
  id INTEGER PRIMARY KEY,
  recurrente_id INTEGER NOT NULL REFERENCES recurrentes(id) ON DELETE CASCADE,
  valido_desde TEXT NOT NULL,
  importe INTEGER NOT NULL,
  UNIQUE (recurrente_id, valido_desde)
);

CREATE TABLE prestamos (
  id INTEGER PRIMARY KEY,
  recurrente_id INTEGER NOT NULL UNIQUE REFERENCES recurrentes(id) ON DELETE CASCADE,
  capital INTEGER NOT NULL,
  tin REAL NOT NULL,
  tae REAL,
  plazo_meses INTEGER NOT NULL,
  primera_cuota TEXT NOT NULL,
  comision_amortizacion REAL NOT NULL DEFAULT 0,
  vinculado INTEGER NOT NULL DEFAULT 0
);

-- Gastos e ingresos sueltos; importe negativo = gasto
CREATE TABLE apuntes (
  id INTEGER PRIMARY KEY,
  fecha TEXT NOT NULL,
  importe INTEGER NOT NULL,
  concepto TEXT NOT NULL,
  categoria_id INTEGER REFERENCES categorias(id),
  cuenta_id INTEGER REFERENCES cuentas(id) ON DELETE SET NULL,
  recurrente_id INTEGER REFERENCES recurrentes(id) ON DELETE SET NULL,
  origen TEXT NOT NULL DEFAULT 'manual',
  importacion_id INTEGER,
  id_externo TEXT,
  hash_dedupe TEXT UNIQUE
);
CREATE INDEX apuntes_fecha ON apuntes (fecha);

CREATE TABLE activos (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  isin TEXT,
  simbolo TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('fondo', 'etf', 'accion', 'cripto', 'divisa', 'otro')),
  renta TEXT NOT NULL DEFAULT 'variable' CHECK (renta IN ('variable', 'fija', 'monetario')),
  moneda TEXT NOT NULL DEFAULT 'EUR',
  especulativo INTEGER NOT NULL DEFAULT 0,
  fuente_precio TEXT NOT NULL DEFAULT 'manual',
  simbolo_fuente TEXT,
  archivado INTEGER NOT NULL DEFAULT 0
);

-- importe = euros pagados (compra) o cobrados (venta), con comisiones incluidas
CREATE TABLE movimientos_cartera (
  id INTEGER PRIMARY KEY,
  activo_id INTEGER NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('compra', 'venta')),
  cantidad REAL NOT NULL,
  importe INTEGER NOT NULL
);

-- Precio por unidad en la moneda del activo
CREATE TABLE precios (
  activo_id INTEGER NOT NULL REFERENCES activos(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL,
  precio REAL NOT NULL,
  fuente TEXT NOT NULL,
  obtenido TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (activo_id, fecha, fuente)
);

-- Cuántas unidades de la moneda da 1 euro (1 € = 1,08 USD → 1.08)
CREATE TABLE tipos_cambio (
  fecha TEXT NOT NULL,
  moneda TEXT NOT NULL,
  por_euro REAL NOT NULL,
  fuente TEXT NOT NULL,
  PRIMARY KEY (fecha, moneda, fuente)
);

CREATE TABLE metas (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  objetivo INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  ahorrado INTEGER NOT NULL DEFAULT 0,
  cumplida INTEGER NOT NULL DEFAULT 0
);

-- Foto congelada de cada mes cerrado: el resumen de meses pasados sale de aquí
CREATE TABLE cierres_mes (
  mes TEXT PRIMARY KEY,
  cerrado TEXT NOT NULL,
  ingresos INTEGER NOT NULL,
  gastos_esenciales INTEGER NOT NULL,
  gastos_no_esenciales INTEGER NOT NULL,
  ahorro_plan INTEGER NOT NULL,
  ahorro_real INTEGER,
  patrimonio INTEGER NOT NULL,
  liquidez_libre INTEGER NOT NULL,
  fondo_objetivo INTEGER NOT NULL,
  ocio_plan INTEGER NOT NULL,
  ocio_gastado INTEGER NOT NULL,
  ocio_sobrante INTEGER NOT NULL,
  etapa TEXT NOT NULL,
  resumen TEXT
);

CREATE TABLE datos_mercado (
  clave TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('referencia', 'cuenta', 'letras', 'tramos', 'limite')),
  valor TEXT NOT NULL,
  fuente TEXT,
  comprobado TEXT NOT NULL,
  fin_promocion TEXT,
  nota TEXT,
  origen TEXT NOT NULL DEFAULT 'semilla'
);

CREATE TABLE parametros (
  clave TEXT PRIMARY KEY,
  valor REAL NOT NULL
);

CREATE TABLE perfil (
  clave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE TABLE historial_etapas (
  id INTEGER PRIMARY KEY,
  fecha TEXT NOT NULL,
  etapa TEXT NOT NULL
);
