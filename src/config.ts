import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  CLICKUP_API_TOKEN: z.string().min(1),
  CLICKUP_WORKSPACE_ID: z.string().min(1),
  CLICKUP_USER_ID: z.string().min(1),
  TODOIST_API_TOKEN: z.string().min(1),
  TODOIST_SYNC_PROJECT_ID: z.string().min(1),
  TODOIST_SYNC_PROJECT_NAME: z.string().min(1),
  TODOIST_ERROR_PROJECT_ID: z.string().min(1),
  TODOIST_ERROR_PROJECT_NAME: z.string().min(1),
  CLICKUP_API_URL: z.string().url().default('https://api.clickup.com/api/v2'),
  TODOIST_API_URL: z.string().url().default('https://api.todoist.com/api/v1'),
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(3100),
  WEBHOOK_SECRET: z.string().min(1),
  PUBLIC_URL: z.string().url(),
});

const result = schema.safeParse(process.env);

if (!result.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment variables:');
  // eslint-disable-next-line no-console
  console.error(result.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = result.data;
