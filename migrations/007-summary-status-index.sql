BEGIN;

CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);

COMMIT;
