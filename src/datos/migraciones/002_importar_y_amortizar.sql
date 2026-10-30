-- Importación de extractos del banco y amortizaciones anticipadas de préstamos.

CREATE TABLE importaciones (
  id INTEGER PRIMARY KEY,
  fecha TEXT NOT NULL,
  archivo TEXT,
  cuenta_id INTEGER REFERENCES cuentas(id) ON DELETE SET NULL,
  filas INTEGER NOT NULL,
  nuevas INTEGER NOT NULL
);

-- Recuerda las columnas de cada banco: `firma` son los títulos de las columnas del extracto
CREATE TABLE perfiles_importacion (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  firma TEXT NOT NULL,
  configuracion TEXT NOT NULL
);

-- «Si el concepto contiene X, la categoría es Y»
CREATE TABLE reglas_categoria (
  id INTEGER PRIMARY KEY,
  patron TEXT NOT NULL UNIQUE,
  categoria_id INTEGER NOT NULL REFERENCES categorias(id) ON DELETE CASCADE
);

-- modo 'cuota': baja la cuota y se mantiene el plazo; 'plazo': se mantiene la cuota y se acaba antes
CREATE TABLE amortizaciones (
  id INTEGER PRIMARY KEY,
  prestamo_id INTEGER NOT NULL REFERENCES prestamos(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL,
  importe INTEGER NOT NULL,
  modo TEXT NOT NULL CHECK (modo IN ('cuota', 'plazo'))
);
