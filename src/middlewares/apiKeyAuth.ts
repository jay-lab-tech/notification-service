import type { RequestHandler } from 'express';
import { prisma } from '../config/database.js';
import { hashApiKey } from '../utils/apiKey.js';
import { ApiError } from '../utils/ApiError.js';

export const apiKeyAuth: RequestHandler = async (request, _response, next) => {
  const rawKey = request.header('x-api-key');
  if (!rawKey || !rawKey.startsWith('nsk_live_')) {
    throw new ApiError(401, 'API_KEY_REQUIRED', 'A valid API key is required');
  }

  const key = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(rawKey) },
    select: { id: true, serviceName: true, isActive: true },
  });

  if (!key || !key.isActive) {
    throw new ApiError(401, 'INVALID_API_KEY', 'The API key is invalid or inactive');
  }

  await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  request.apiKey = { id: key.id, serviceName: key.serviceName };
  next();
};
