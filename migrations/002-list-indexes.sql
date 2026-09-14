BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS orders_created_at_id_idx ON orders (created_at, id);
CREATE INDEX IF NOT EXISTS orders_customer_trgm_idx ON orders USING gin (customer gin_trgm_ops);
CREATE INDEX IF NOT EXISTS items_order_id_idx ON items (order_id);
CREATE INDEX IF NOT EXISTS status_history_order_id_idx ON status_history (order_id);

COMMIT;
