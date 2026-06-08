-- Create the 'orders' table
CREATE TABLE IF NOT EXISTS orders (
    id PRIMARY KEY DEFAULT,
    customer VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL, -- e.g., 'picking', 'packed', 'dispatched', 'delayed'
    priority VARCHAR(50) NOT NULL, -- e.g., 'high', 'medium', 'low'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create the 'items' table
CREATE TABLE IF NOT EXISTS items (
    id PRIMARY KEY DEFAULT,
    order_id NOT NULL,
    name VARCHAR(255) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- Create the 'status_history' table
CREATE TABLE IF NOT EXISTS status_history (
    id PRIMARY KEY DEFAULT,
    order_id NOT NULL,
    status VARCHAR(50) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

