import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';

import estoqueRoutes from './modules/estoque/estoque.routes';

const app = express();

// Segurança básica de headers HTTP (RNF de segurança da documentação)
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rota simples só pra confirmar que o servidor está de pé.
// Mais pra frente isso também pode virar a base do "heartbeat"
// que o RF-025 pede (monitorar se a cantina está online).
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'cantinafast-backend' });
});

// Rotas de Estoque/Movimentações (CRUD de responsabilidade do Murilo)
app.use('/api', estoqueRoutes);

export default app;
