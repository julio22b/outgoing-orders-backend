import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import ordersRouter from './routes/orders';
import { Server } from 'socket.io';
import http from 'http';

const app = express();
const httpServer = http.createServer(app);
const port = 3000;
const origin = 'http://localhost:5173';
const methods = ['GET', 'POST', 'PUT', 'DELETE'];

const io = new Server(httpServer, {
    cors: {
        origin,
        methods,
    },
});

io.on('connection', (socket) => {
    console.log('client connected:', socket.id);
});

app.use(express.json());
app.use(
    cors({
        origin,
        methods,
        credentials: true,
    }),
);
app.use('/orders', ordersRouter(io));

httpServer.listen(port, () => {
    console.log('Server running on port 3000');
});
