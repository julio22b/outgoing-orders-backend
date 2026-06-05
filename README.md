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
- Real-time event broadcasting via Socket.io — all connected clients receive live updates when orders are created, updated, or deleted
- Relational schema with cascade deletes — items and status history are automatically cleaned up when an order is deleted
- Database transactions on multi-table writes to ensure data integrity

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/orders` | Get all orders with items and status history |
| GET | `/orders/:id` | Get a single order |
| POST | `/orders` | Create a new order |
| PUT | `/orders/:id` | Update an order |
| DELETE | `/orders/:id` | Delete an order |

## Socket.io Events

| Event | Payload | Description |
|-------|---------|-------------|
| `order:created` | Order object | Emitted when a new order is created |
| `order:updated` | Order object | Emitted when an order is updated |
| `order:deleted` | Order ID | Emitted when an order is deleted |

## Database Schema

```
orders
  id            SERIAL PRIMARY KEY
  customer      TEXT NOT NULL
  status        TEXT NOT NULL
  priority      TEXT NOT NULL
  created_at    TIMESTAMP DEFAULT NOW()

items
  id            SERIAL PRIMARY KEY
  order_id      INT REFERENCES orders(id) ON DELETE CASCADE
  name          TEXT NOT NULL

status_history
  id            SERIAL PRIMARY KEY
  order_id      INT REFERENCES orders(id) ON DELETE CASCADE
  status        TEXT NOT NULL
  timestamp     TIMESTAMP NOT NULL
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

2. Run the table migrations in `psql`:
   ```sql
   CREATE TABLE orders ( ... );
   CREATE TABLE items ( ... );
   CREATE TABLE status_history ( ... );
   ```

3. Install dependencies and start the dev server:
   ```bash
   npm install
   npm run dev
   ```