# Outgoing Orders — Backend

REST API and real-time WebSocket server for the WMS Outgoing Orders Dashboard. Built with Node.js, Express, PostgreSQL, and Socket.io.

## Live API

`https://outgoing-orders-backend.onrender.com`

> **Note:** This service runs on Render's free tier and may take 30–60 seconds to respond on the first request after a period of inactivity. Subsequent requests are fast.

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express
- **Language:** TypeScript
- **Database:** PostgreSQL
- **Real-time:** Socket.io
- **Containerization:** Docker

## Features

- RESTful API for full CRUD on outgoing orders
- Server-side filtering, sorting and keyset (cursor) pagination, with a separate endpoint for summary counts
- Real-time event broadcasting via Socket.io — all connected clients receive live updates when orders are created, updated, or deleted
- Relational schema with cascade deletes — items and status history are automatically cleaned up when an order is deleted
- Database transactions on multi-table writes to ensure data integrity

## API Endpoints

| Method | Endpoint             | Description                                                 |
| ------ | -------------------- | ----------------------------------------------------------- |
| GET    | `/orders`            | List orders: filtered, sorted, cursor-paginated (see below) |
| GET    | `/orders/summary`    | Order counts by status for the same filters                 |
| GET    | `/orders/:id`        | Get a single order                                          |
| POST   | `/orders`            | Create a new order                                          |
| PUT    | `/orders/:id`        | Update an order                                             |
| DELETE | `/orders/:id`        | Delete an order                                             |
| PATCH  | `/orders/:id/status` | Update the status of an order                               |

## Listing Orders

`GET /orders` returns one page at a time. Filtering, sorting and paging all happen in Postgres, so a response never holds more than `limit` orders.

```
GET /orders?status=picking,packed&priority=high&search=acme&from=2026-09-01T04:00:00Z&to=2026-09-08T04:00:00Z&sort=createdAt&dir=desc&limit=50
```

| Parameter     | Default     | Description                                                                                                                                                                                                                    |
| ------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `status`      | all         | `picking`, `packed`, `delayed`, `dispatched`. Comma-separated (`status=picking,packed`), repeated (`status=picking&status=packed`), or both.                                                                                   |
| `priority`    | all         | `low`, `normal`, `high`. Same format as `status`.                                                                                                                                                                              |
| `search`      | none        | `123` or `ORD-123` matches that order id exactly. Anything else is a case-insensitive substring match on the customer name.                                                                                                    |
| `from` / `to` | none        | ISO-8601 date-times **with an offset** (`Z` or `-04:00`). `from` is inclusive, `to` is exclusive. Bare dates like `2026-09-01` are rejected: which day they mean depends on a time zone, so send local midnight as an instant. |
| `sort`        | `createdAt` | `createdAt` or `id`.                                                                                                                                                                                                           |
| `dir`         | `desc`      | `desc` or `asc`.                                                                                                                                                                                                               |
| `limit`       | `50`        | 1–200.                                                                                                                                                                                                                         |
| `cursor`      | none        | The `nextCursor` from the previous response.                                                                                                                                                                                   |

```json
{
    "data": [
        {
            "id": 99850,
            "customer": "Evergreen Wholesale",
            "status": "picking",
            "priority": "low",
            "createdAt": "2026-09-10T20:41:37.680Z",
            "items": ["Strapping Band 12mm", "First Aid Kit Small"],
            "statusHistory": [{ "status": "picking", "timestamp": "2026-09-10T16:41:37.68-04:00" }]
        }
    ],
    "nextCursor": "eyJzb3J0RmllbGQiOiJjcmVhdGVkQXQiLCJzb3J0RGlyZWN0aW9uIjoiZGVzYyIs..."
}
```

`nextCursor` is `null` on the last page. Invalid parameters return `400` with `{ "message": "..." }` explaining what was wrong.

### Pagination: keyset, not pages

The list uses keyset (cursor) pagination instead of `OFFSET` and page numbers. The cursor records the last row's sort value plus its `id`, and the next page is fetched with `WHERE (created_at, id) < (cursor) ORDER BY created_at DESC, id DESC`, served by an index on `(created_at, id)`. The `id` breaks ties: without it, orders sharing a timestamp would be skipped or repeated at a page boundary.

`OFFSET 90000` makes Postgres walk and discard 90,000 rows before returning anything, so it gets slower the deeper you go. A cursor seeks straight to its position, so every page costs the same. Measured on 100k orders:

| Page                          | Query time |
| ----------------------------- | ---------- |
| First page                    | 0.2 ms     |
| Row 90,000 via keyset cursor  | 0.3 ms     |
| Row 90,000 via `OFFSET 90000` | 10.8 ms    |

**The tradeoff: there is no jumping to page 47.** There are no page numbers, only "next". Clients page with "load more" or infinite scroll, which is what a virtualized list wants anyway. In exchange, pages are stable while data changes: a new order never shifts later pages by one the way it does with `OFFSET`, so nothing is skipped or shown twice.

- Treat the cursor as opaque; its format may change.
- A cursor is only valid for the `sort` and `dir` it was issued with. Changing either returns `400`, so drop the cursor and start from the first page. Do the same when filters change.

### Summary Counts

`GET /orders/summary` returns exact counts:

```json
{ "total": 100000, "byStatus": { "picking": 12999, "packed": 12000, "delayed": 5000, "dispatched": 70001 } }
```

It accepts `priority`, `search`, `from` and `to` with the same rules as the list, and ignores `status`, `sort`, `dir`, `cursor` and `limit`. Ignoring `status` is deliberate: `byStatus` is a facet count, so one request serves both the overall totals (no parameters) and the per-status counts under the other active filters. For a filtered total, add up the statuses you have selected.

Counting is a separate request rather than part of every page, because a count has to visit every matching row, which is exactly the work keyset pagination avoids. It takes about 5–7 ms at 100k orders.

### Keeping a Paged View Live

Socket.io events still carry the full order (or just its id for deletes), and the server doesn't track which filters or pages each client holds. A client showing a filtered, paged view should:

- on `order:created`, insert the order only if it matches the active filters and sorts within the rows already loaded;
- on `order:updated`, replace the order if it's loaded, and remove it if it no longer matches the filters (for example, its status left the filtered set);
- on `order:deleted`, remove the order;
- re-fetch `/orders/summary` after events, debounced to about once a second. `order:updated` doesn't include the previous status, so counts can't be adjusted from events alone.

A view with one column per status should page each column with its own `?status=` request rather than splitting a mixed page: most orders are dispatched, so a mixed page of 50 holds only a handful of the others.

## Socket.io Events

| Event           | Payload      | Description                         |
| --------------- | ------------ | ----------------------------------- |
| `order:created` | Order object | Emitted when a new order is created |
| `order:updated` | Order object | Emitted when an order is updated    |
| `order:deleted` | Order ID     | Emitted when an order is deleted    |

## Database Schema

```
orders
  id            SERIAL PRIMARY KEY
  customer      TEXT NOT NULL
  status        TEXT NOT NULL CHECK (picking | packed | delayed | dispatched)
  priority      TEXT NOT NULL
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()

items
  id            SERIAL PRIMARY KEY
  order_id      INT REFERENCES orders(id) ON DELETE CASCADE
  name          TEXT NOT NULL

status_history
  id            SERIAL PRIMARY KEY
  order_id      INT REFERENCES orders(id) ON DELETE CASCADE
  status        TEXT NOT NULL CHECK (picking | packed | delayed | dispatched)
  timestamp     TIMESTAMPTZ NOT NULL

indexes
  orders (created_at, id)                        keyset pagination, both directions
  orders USING gin (customer gin_trgm_ops)       customer search (pg_trgm extension)
  items (order_id), status_history (order_id)    loading each order's items and history
```

## Local Development

### Prerequisites

- Docker and Docker Compose

### Running with Docker

1. Clone the repo:

    ```bash
    git clone https://github.com/yourusername/outgoing-orders-backend.git
    cd outgoing-orders-backend
    ```

2. Create a `.env` file in the project root:

    ```
    DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/outgoing_orders
    FRONTEND_URL=http://localhost:5173
    PORT=3000
    ```

3. Start the services:
    ```bash
    docker-compose up --build
    ```

The API will be available at `http://localhost:3000`.

### Running without Docker

1. Make sure PostgreSQL is running locally and create the database:

    ```bash
    psql -U postgres -c "CREATE DATABASE outgoing_orders;"
    ```

2. Create the schema:

    ```bash
    psql -U postgres -d outgoing_orders -f init.sql
    ```

3. Install dependencies and start the dev server:
    ```bash
    npm install
    npm run dev
    ```

### Upgrading an Existing Database

`init.sql` always holds the full current schema, but Docker only runs it when the data volume is first created. A database created earlier needs the files in `migrations/` applied by hand, in order, skipping any it already has:

```bash
psql "$DATABASE_URL" -f migrations/001-timestamps-to-timestamptz.sql
psql "$DATABASE_URL" -f migrations/002-list-indexes.sql
psql "$DATABASE_URL" -f migrations/003-status-check.sql
psql "$DATABASE_URL" -f migrations/004-created-at-constraints.sql
```

`002` enables the `pg_trgm` extension, which ships with standard Postgres builds, including the `postgres` Docker image and Render.
