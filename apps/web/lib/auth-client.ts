// Browser auth client (#153). Same-origin, so no base URL. Only the sign-in client components use
// it, and they load it with a dynamic `import()` on interaction to keep it out of first-load JS.
import { createCauseDeckAuthClient, type AuthClient } from '@causedeck/auth/client';

export const authClient: AuthClient = createCauseDeckAuthClient();
