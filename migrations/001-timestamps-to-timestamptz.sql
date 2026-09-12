BEGIN;

ALTER TABLE orders
    ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING created_at AT TIME ZONE current_setting('TimeZone');

ALTER TABLE status_history
    ALTER COLUMN timestamp TYPE TIMESTAMPTZ
    USING timestamp AT TIME ZONE current_setting('TimeZone');

COMMIT;
