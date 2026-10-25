import type { MetadataRoute } from 'next';

import { siteEnv } from '../lib/env.ts';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${siteEnv.siteUrl}/sitemap.xml`,
  };
}
