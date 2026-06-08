import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import ordersRouter from './routes/orders';
import { Request, Response, NextFunction } from 'express';
import { Server } from 'socket.io';
import http from 'http';

const app = express();
const httpServer = http.createServer(app);
const port = 3000;

// Use an array to support both localhost and 127.0.0.1 during development
const allowedOrigins = process.env.FRONTEND_URL
    ? [process.env.FRONTEND_URL, 'http://localhost:5173', 'http://127.0.0.1:5173']
    : ['http://localhost:5173', 'http://127.0.0.1:5173'];

const methods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];

const io = new Server(httpServer, {
    cors: {
        origin: allowedOrigins,
        methods,
        credentials: true,
    },
});

io.on('connection', (socket) => {
    console.log('client connected:', socket.id);
});

app.use(express.json());
app.use(
    cors({
        origin: allowedOrigins,
        methods,
        credentials: true,
    }),
);
app.use('/orders', ordersRouter(io));

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error(err.stack);
    res.status(500).send('Check logs for details');
});

httpServer.listen(port, () => {
    console.log('Server running on port 3000');
});
