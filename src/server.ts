import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import ordersRouter from './routes/orders';

const app = express();
const port = 3000;

app.use(express.json());
app.use(
    cors({
        origin: 'http://localhost:5173',
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        credentials: true,
    }),
);
app.use('/orders', ordersRouter);

app.listen(port, () => {
    console.log('start');
});
