-- Avisos que has cerrado: no vuelven mientras su texto sea el mismo (si cambia la situación, el texto cambia)
CREATE TABLE avisos_ocultos (
  clave TEXT PRIMARY KEY,
  ocultado TEXT NOT NULL
);

-- Presupuesto por categorías: cuánto quieres gastar como mucho al mes en cada una
CREATE TABLE limites_categoria (
  categoria_id INTEGER PRIMARY KEY REFERENCES categorias(id) ON DELETE CASCADE,
  limite INTEGER NOT NULL
);

-- Una meta puede ir unida a la cuenta donde apartas su dinero: lo ahorrado sale del saldo de esa cuenta
ALTER TABLE metas ADD COLUMN cuenta_id INTEGER REFERENCES cuentas(id) ON DELETE SET NULL;
