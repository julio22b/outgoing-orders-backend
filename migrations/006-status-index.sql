BEGIN;

CREATE INDEX IF NOT EXISTS orders_status_created_at_id_idx ON orders (status, created_at, id);

COMMIT;
