// `GET /v1/me` (#14).
import { z } from 'zod';

export const WORKSPACE_ROLE_VALUES = ['owner', 'advocate', 'junior', 'clerk', 'viewer'] as const;

export const ApiUserSchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string().nullable(),
  image: z.string().nullable(),
  locale: z.enum(['en', 'ta', 'kn']),
});

export const MembershipSchema = z.object({
  workspaceId: z.string(),
  name: z.string(),
  slug: z.string(),
  role: z.enum(WORKSPACE_ROLE_VALUES),
});

export const MeResponseSchema = z
  .object({
    user: ApiUserSchema,
    memberships: z.array(MembershipSchema),
  })
  .meta({ id: 'Me' });

export type ApiUser = z.infer<typeof ApiUserSchema>;
export type Membership = z.infer<typeof MembershipSchema>;
export type MeResponse = z.infer<typeof MeResponseSchema>;
