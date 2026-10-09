import { Router } from 'express';
import { apiKeyAuth } from '../../middlewares/apiKeyAuth.js';
import { getDeadLetterJobs, retryDeadLetterJob } from '../../queues/notificationQueue.js';
import { ApiError } from '../../utils/ApiError.js';

export const deadLetterRoute = Router();

deadLetterRoute.use(apiKeyAuth);

deadLetterRoute.get('/', async (request, response) => {
  const sourceService = request.apiKey?.serviceName;
  if (!sourceService) throw new ApiError(401, 'API_KEY_REQUIRED', 'A valid API key is required');
  response.json({ data: await getDeadLetterJobs(sourceService) });
});

deadLetterRoute.post('/:jobId/retry', async (request, response) => {
  const sourceService = request.apiKey?.serviceName;
  if (!sourceService) throw new ApiError(401, 'API_KEY_REQUIRED', 'A valid API key is required');
  const rawJobId = request.params.jobId;
  const jobId = Array.isArray(rawJobId) ? rawJobId[0] : rawJobId;
  if (!jobId) throw new ApiError(400, 'VALIDATION_ERROR', 'A dead-letter job ID is required');

  const notificationId = await retryDeadLetterJob(jobId, sourceService);
  if (!notificationId) throw new ApiError(404, 'DEAD_LETTER_JOB_NOT_FOUND', 'Dead-letter job not found');
  response.json({ data: { notificationId, status: 'QUEUED' } });
});
