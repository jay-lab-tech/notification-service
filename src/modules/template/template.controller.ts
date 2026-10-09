import type { Request, RequestHandler } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { createTemplateSchema, templateCodeSchema, updateTemplateSchema } from './template.schema.js';
import { createTemplate, deactivateTemplate, getTemplate, listTemplates, updateTemplate } from './template.service.js';

function serviceName(request: Express.Request): string {
  if (!request.apiKey) throw new ApiError(401, 'API_KEY_REQUIRED', 'A valid API key is required');
  return request.apiKey.serviceName;
}

function pathCode(request: Request): string {
  const raw = request.params.code;
  const code = Array.isArray(raw) ? raw[0] : raw;
  const parsed = templateCodeSchema.safeParse(code);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Template code is invalid');
  return parsed.data;
}

export const listTemplatesController: RequestHandler = async (request, response) => {
  response.json({ data: await listTemplates(serviceName(request)) });
};

export const getTemplateController: RequestHandler = async (request, response) => {
  response.json({ data: await getTemplate(serviceName(request), pathCode(request)) });
};

export const createTemplateController: RequestHandler = async (request, response) => {
  const parsed = createTemplateSchema.safeParse(request.body);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid template');
  response.status(201).json({ data: await createTemplate(serviceName(request), parsed.data) });
};

export const updateTemplateController: RequestHandler = async (request, response) => {
  const parsed = updateTemplateSchema.safeParse(request.body);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid template');
  response.json({ data: await updateTemplate(serviceName(request), pathCode(request), parsed.data) });
};

export const deleteTemplateController: RequestHandler = async (request, response) => {
  await deactivateTemplate(serviceName(request), pathCode(request));
  response.status(204).end();
};
