import { Prisma } from '../../generated/prisma/client.js';
import type { NotificationChannel } from '../../generated/prisma/client.js';
import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import type { createTemplateSchema, updateTemplateSchema } from './template.schema.js';
import type { z } from 'zod';

type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function createTemplate(sourceService: string, input: CreateTemplateInput) {
  try {
    return await prisma.template.create({
      data: {
        sourceService,
        code: input.code,
        name: input.name,
        channel: input.channel as NotificationChannel,
        subject: input.subject ?? null,
        body: input.body,
        variables: input.variables,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new ApiError(409, 'TEMPLATE_CODE_EXISTS', 'A template with this code already exists');
    throw error;
  }
}

export async function listTemplates(sourceService: string) {
  return prisma.template.findMany({
    where: { sourceService, isActive: true },
    orderBy: { code: 'asc' },
    select: { code: true, name: true, channel: true, subject: true, variables: true, createdAt: true, updatedAt: true },
  });
}

export async function getTemplate(sourceService: string, code: string) {
  const template = await prisma.template.findFirst({
    where: { sourceService, code, isActive: true },
    select: { code: true, name: true, channel: true, subject: true, body: true, variables: true, createdAt: true, updatedAt: true },
  });
  if (!template) throw new ApiError(404, 'TEMPLATE_NOT_FOUND', 'Active template not found');
  return template;
}

export async function updateTemplate(sourceService: string, code: string, input: UpdateTemplateInput) {
  const existing = await prisma.template.findFirst({ where: { sourceService, code } });
  if (!existing) throw new ApiError(404, 'TEMPLATE_NOT_FOUND', 'Template not found');
  return prisma.template.update({
    where: { id: existing.id },
    data: {
      name: input.name,
      channel: input.channel as NotificationChannel,
      subject: input.subject ?? null,
      body: input.body,
      variables: input.variables,
      isActive: true,
    },
  });
}

export async function deactivateTemplate(sourceService: string, code: string) {
  const existing = await prisma.template.findFirst({ where: { sourceService, code, isActive: true } });
  if (!existing) throw new ApiError(404, 'TEMPLATE_NOT_FOUND', 'Active template not found');
  await prisma.template.update({ where: { id: existing.id }, data: { isActive: false } });
}
