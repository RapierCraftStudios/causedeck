// Signup prompt for module pages (#511). Carries only closed values: the education channel (a
// member of the activation channel list) and a registered module slug, never free text.
import { LEARN_SLUGS, type LearnSlug } from './slugs';

export const EDUCATION_CHANNEL = 'education';

export function signupHref(slug: LearnSlug): string {
  if (!LEARN_SLUGS.includes(slug)) throw new Error(`unknown learn module: ${slug}`);
  return `/sign-in?channel=${EDUCATION_CHANNEL}&module=${slug}`;
}
