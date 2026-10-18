// `GET /v1/workspaces` (#14).
import { z } from 'zod';

import { WORKSPACE_ROLE_VALUES } from './me';

import { pageOf, PaginationQuerySchema } from './pagination';

export const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  role: z.enum(WORKSPACE_ROLE_VALUES),
  createdAt: z.iso.datetime(),
});

export const WorkspaceListQuerySchema = PaginationQuerySchema;

export const WorkspaceListResponseSchema = pageOf(WorkspaceSchema).meta({ id: 'WorkspaceList' });

export type ApiWorkspace = z.infer<typeof WorkspaceSchema>;
export type WorkspaceListQuery = z.infer<typeof WorkspaceListQuerySchema>;
export type WorkspaceListResponse = z.infer<typeof WorkspaceListResponseSchema>;
