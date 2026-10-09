import { Router } from 'express';
import { apiKeyAuth } from '../../middlewares/apiKeyAuth.js';
import {
  createTemplateController,
  deleteTemplateController,
  getTemplateController,
  listTemplatesController,
  updateTemplateController,
} from './template.controller.js';

export const templateRoute = Router();

templateRoute.use(apiKeyAuth);
templateRoute.get('/', listTemplatesController);
templateRoute.post('/', createTemplateController);
templateRoute.get('/:code', getTemplateController);
templateRoute.put('/:code', updateTemplateController);
templateRoute.delete('/:code', deleteTemplateController);
