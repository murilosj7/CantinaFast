import { Router } from 'express';
import * as controller from './estoque.controller';

const router = Router();

router.get('/estoque', controller.listarEstoque);
router.get('/estoque/:produtoId', controller.obterEstoquePorProduto);
router.put('/estoque/:produtoId', controller.atualizarEstoqueMinimo);

router.post('/movimentacoes', controller.registrarMovimentacao);
router.get('/movimentacoes', controller.listarMovimentacoes);
router.delete('/movimentacoes/:id', controller.removerMovimentacao);

export default router;
