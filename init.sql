CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    customer TEXT NOT NULL,
    status TEXT NOT NULL CONSTRAINT orders_status_check CHECK (status IN ('picking', 'packed', 'delayed', 'dispatched')),
    priority TEXT NOT NULL CONSTRAINT orders_priority_check CHECK (priority IN ('low', 'normal', 'high')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS items (
    id SERIAL PRIMARY KEY,
    order_id INT REFERENCES orders(id) ON DELETE CASCADE,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS status_history (
    id SERIAL PRIMARY KEY,
    order_id INT REFERENCES orders(id) ON DELETE CASCADE,
    status TEXT NOT NULL CONSTRAINT status_history_status_check CHECK (status IN ('picking', 'packed', 'delayed', 'dispatched')),
    timestamp TIMESTAMPTZ NOT NULL
);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS orders_created_at_id_idx ON orders (created_at, id);
CREATE INDEX IF NOT EXISTS orders_status_created_at_id_idx ON orders (status, created_at, id);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);
CREATE INDEX IF NOT EXISTS orders_customer_trgm_idx ON orders USING gin (customer gin_trgm_ops);
CREATE INDEX IF NOT EXISTS items_order_id_idx ON items (order_id);
CREATE INDEX IF NOT EXISTS status_history_order_id_idx ON status_history (order_id);