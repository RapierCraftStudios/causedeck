// Membership predicates shared by every core domain (#177, #293). Re-exported from
// `workspaces/members.ts`, so other domains can filter on live workspaces and active members without
// importing the workspaces domain.
import { schema } from '@causedeck/db';
import { eq, isNull } from 'drizzle-orm';

const { member, organization } = schema;

/** The workspace is not soft-deleted. */
export const liveWorkspace = isNull(organization.deletedAt);

/** The membership is active (not suspended or removed). */
export const activeMember = eq(member.status, 'active');
