import Handlebars from 'handlebars';
import { prisma } from '../config/database.js';
import type { NotificationChannel } from '../generated/prisma/client.js';
import { ApiError } from '../utils/ApiError.js';

export async function renderNotificationTemplate(input: {
  sourceService: string;
  code: string;
  channel: NotificationChannel;
  variables: Record<string, unknown>;
}): Promise<{ code: string; subject: string | null; body: string }> {
  const template = await prisma.template.findFirst({
    where: { sourceService: input.sourceService, code: input.code, isActive: true },
  });
  if (!template) throw new ApiError(404, 'TEMPLATE_NOT_FOUND', 'Active template not found');
  if (template.channel !== input.channel) {
    throw new ApiError(400, 'TEMPLATE_CHANNEL_MISMATCH', 'Template channel does not match notification channel');
  }

  const requiredVariables = Array.isArray(template.variables)
    ? template.variables.filter((value): value is string => typeof value === 'string')
    : [];
  const missing = requiredVariables.filter((key) => !(key in input.variables));
  if (missing.length > 0) {
    throw new ApiError(400, 'TEMPLATE_VARIABLES_MISSING', `Missing template variables: ${missing.join(', ')}`);
  }

  try {
    const render = (source: string) => Handlebars.compile(source, { strict: true })(input.variables);
    return {
      code: template.code,
      subject: template.subject ? render(template.subject) : null,
      body: render(template.body),
    };
  } catch {
    throw new ApiError(400, 'TEMPLATE_RENDER_FAILED', 'Template could not be rendered with the provided variables');
  }
}
