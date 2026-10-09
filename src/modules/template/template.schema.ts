import { z } from 'zod';

const templateFields = {
  name: z.string().trim().min(1).max(150),
  channel: z.enum(['EMAIL', 'PUSH', 'SMS', 'WEBHOOK']),
  subject: z.string().trim().min(1).max(300).optional(),
  body: z.string().min(1).max(100_000),
  variables: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).max(100).default([]),
};

export const createTemplateSchema = z.object({
  code: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  ...templateFields,
}).superRefine((input, context) => {
  if (input.channel === 'EMAIL' && !input.subject) {
    context.addIssue({ code: 'custom', path: ['subject'], message: 'Email templates require a subject' });
  }
  if (new Set(input.variables).size !== input.variables.length) {
    context.addIssue({ code: 'custom', path: ['variables'], message: 'Template variables must be unique' });
  }
});

export const updateTemplateSchema = z.object(templateFields).superRefine((input, context) => {
  if (input.channel === 'EMAIL' && !input.subject) {
    context.addIssue({ code: 'custom', path: ['subject'], message: 'Email templates require a subject' });
  }
  if (new Set(input.variables).size !== input.variables.length) {
    context.addIssue({ code: 'custom', path: ['variables'], message: 'Template variables must be unique' });
  }
});

export const templateCodeSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100);
