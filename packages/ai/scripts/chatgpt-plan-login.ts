// One-time "Sign in with ChatGPT" login for the preview-only plan provider (#1165).
//
//   pnpm --filter @causedeck/ai chatgpt-plan:login --token-file <path> [--app-name <name>]
//
// Listens on 127.0.0.1:1455, prints the authorize URL, waits for the loopback callback, exchanges
// the code, verifies the id token and writes the client id and tokens to the token file (0600).
// It prints only the file path and the account subject, never a token. The first sign-in registers
// a client (dynamic client registration); later runs reuse the saved `oaiapp_…` id and host id.
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';

import {
  buildAuthorizeUrl,
  createPkce,
  exchangeCode,
  newHostId,
  parseCallback,
  randomToken,
  verifyIdToken,
  writeTokenFile,
} from '../src/providers/chatgpt-plan-login.ts';
import { readTokenFile } from '../src/providers/chatgpt-plan-token.ts';

const { values } = parseArgs({
  options: {
    'token-file': { type: 'string' },
    'app-name': { type: 'string', default: 'CauseDeck preview' },
  },
});
const file = values['token-file'];
if (file === undefined || file === '') {
  process.stderr.write('usage: chatgpt-plan:login --token-file <path> [--app-name <name>]\n');
  process.exit(2);
}
const appName = values['app-name'];

const existing = await readTokenFile(file).catch(() => null);
const extAgentHostId = existing?.extAgentHostId ?? newHostId();
const savedClientId = existing?.clientId;
const pkce = createPkce();
const state = randomToken();
const nonce = randomToken();

const callbackUrl = await new Promise<string>((resolve, reject) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1:1455');
    if (url.pathname !== '/auth/callback') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Sign-in received. You can close this tab and return to the terminal.\n');
    server.close();
    resolve(url.toString());
  });
  server.on('error', reject);
  server.listen(1455, '127.0.0.1', () => {
    const authorize = buildAuthorizeUrl({
      clientId: savedClientId,
      appName,
      extAgentHostId,
      state,
      nonce,
      codeChallenge: pkce.challenge,
    });
    process.stdout.write(`Open this URL to sign in with ChatGPT:\n\n${authorize}\n\n`);
  });
});

const { code, clientId } = parseCallback(callbackUrl, { state, clientId: savedClientId });
const tokens = await exchangeCode({ clientId, code, codeVerifier: pkce.verifier });
const claims = await verifyIdToken(tokens.idToken, { clientId, nonce, scope: tokens.scope });
await writeTokenFile(file, { clientId, extAgentHostId, tokens });
process.stdout.write(`Saved ChatGPT plan tokens to ${file} (account ${claims.sub}).\n`);
