import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { parseEnv } from '../config.js';
import { Services } from '../services/index.js';
import {
  discovery,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  randomPKCECodeVerifier,
  randomState,
  randomNonce,
  authorizationCodeGrant,
  ClientSecretPost,
} from 'openid-client';
import { randomBytes } from 'crypto';
import { URL as URLNode } from 'url';

export function buildCanonicalCallbackUrl(
  requestUrl: string,
  configuredRedirectUri: string,
): URL {
  // Parse the configured redirect URI to get its scheme, host, and path
  const configuredUrl = new URLNode(configuredRedirectUri);
  // Create a new URL using the configured scheme/host/path
  const canonicalUrl = new URLNode(configuredUrl.origin + configuredUrl.pathname);
  // Parse the request URL only to extract query parameters (code/state)
  const requestParsed = new URLNode(requestUrl, 'http://localhost');
  // Append the query string from the request (code, state, etc.)
  canonicalUrl.search = requestParsed.search;
  return canonicalUrl;
}

export async function registerAuthRoutes(app: FastifyInstance) {
  const env = parseEnv();
  const services = app.services as Services;

  // GET /auth/login - initiate OIDC login
  app.get('/auth/login', async (request, reply) => {
    // Discover OIDC provider
    const issuerUrl = new URLNode(env.OIDC_ISSUER);
    const config = await discovery(
      issuerUrl,
      env.OIDC_CLIENT_ID,
      undefined,
      ClientSecretPost(env.OIDC_CLIENT_SECRET),
    );

    const state = randomState();
    const nonce = randomNonce();
    const codeVerifier = randomPKCECodeVerifier();
    const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);

    // Generate random transaction ID for the OIDC transaction record
    const transactionId = randomBytes(32).toString('hex');

    // Store OIDC transaction data in the database (hashed/opaque state data)
    await services.createOidcTransaction({ transactionId, state, nonce, codeVerifier });

    // Cookie holds only the transaction ID (signed)
    reply.setCookie('oidc_txn', transactionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.APP_ORIGIN.startsWith('https'),
      path: '/',
      maxAge: 300, // 5 minutes
      signed: true,
    });

    // Build redirect URL with standards-compliant scope
    const redirectUrl = buildAuthorizationUrl(config, {
      client_id: env.OIDC_CLIENT_ID,
      redirect_uri: env.OIDC_REDIRECT_URI,
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      response_type: 'code',
    });
    reply.redirect(redirectUrl.toString());
  });

  // GET /auth/callback - handle OIDC callback
  app.get('/auth/callback', async (request, reply) => {
    const params = new URL(request.url, 'http://localhost').searchParams;
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) {
      reply.clearCookie('oidc_txn');
      reply.status(400).send({ errors: [{ code: 'BAD_REQUEST', message: 'Missing code or state' }] });
      return;
    }

    // Must unsign the cookie to get the transaction ID
    const txnCookie = request.cookies['oidc_txn'];
    // @fastify/cookie gives raw cookie value, not the signed one
    // We need to use request.unsignCookie to verify the signature
    const cookieValue = txnCookie as string | undefined;
    if (!cookieValue) {
      reply.clearCookie('oidc_txn');
      reply.status(400).send({ errors: [{ code: 'BAD_REQUEST', message: 'Missing signed cookie' }] });
      return;
    }
    const unsigned = request.unsignCookie(cookieValue);
    if (!unsigned.valid || !unsigned.value) {
      reply.clearCookie('oidc_txn');
      reply.status(400).send({ errors: [{ code: 'BAD_REQUEST', message: 'Invalid signed cookie' }] });
      return;
    }
    const transactionId = unsigned.value;

    // Atomically consume the OIDC transaction record
    const stored = await services.consumeOidcTransaction(transactionId);
    if (!stored) {
      reply.clearCookie('oidc_txn');
      reply.status(400).send({ errors: [{ code: 'BAD_REQUEST', message: 'No or expired transaction' }] });
      return;
    }

    // Validate state
    if (stored.state !== state) {
      reply.clearCookie('oidc_txn');
      reply.status(400).send({ errors: [{ code: 'BAD_REQUEST', message: 'State mismatch' }] });
      return;
    }

    // Discover and exchange code (only if transaction is valid and consumed)
    let tokenSet;
    try {
      const issuerUrl = new URLNode(env.OIDC_ISSUER);
      const config = await discovery(
        issuerUrl,
        env.OIDC_CLIENT_ID,
        undefined,
        ClientSecretPost(env.OIDC_CLIENT_SECRET),
      );

      // Build the canonical callback URL from the configured redirect URI
      const canonicalUrl = buildCanonicalCallbackUrl(
        request.url,
        env.OIDC_REDIRECT_URI,
      );

      tokenSet = await authorizationCodeGrant(
        config,
        canonicalUrl,
        { expectedState: stored.state, pkceCodeVerifier: stored.codeVerifier, expectedNonce: stored.nonce },
      );
    } catch (error: any) {
      // Clear OIDC transaction cookie on failure
      reply.clearCookie('oidc_txn');
      // Log safe diagnostic fields - do NOT leak auth code, client secret, token, cookie, state, or full callback URL
      request.log.error({
        err: {
          name: error?.name,
          code: error?.code,
          status: error?.status,
          message: error?.message,
        },
        error: error?.error,
        error_description: error?.error_description,
        configured_redirect_uri: env.OIDC_REDIRECT_URI,
      }, 'OIDC token exchange failed');
      // Return sanitized 502 - do not leak provider body
      reply.status(502).send({ errors: [{ code: 'OIDC_TOKEN_EXCHANGE_FAILED', message: 'Unable to complete sign-in' }] });
      return;
    }

    // Get user info from ID token
    const idToken = tokenSet!.id_token;
    if (!idToken) {
      reply.clearCookie('oidc_txn');
      reply.status(400).send({ errors: [{ code: 'BAD_REQUEST', message: 'No ID token' }] });
      return;
    }
    // Decode ID token
    let claims: any;
    try {
      // tokenSet provides claims() method for ID token
      claims = tokenSet!.claims();
    } catch {
      reply.clearCookie('oidc_txn');
      reply.status(400).send({ errors: [{ code: 'BAD_REQUEST', message: 'Invalid ID token' }] });
      return;
    }
    const issuerStr = claims.iss;
    const subjectStr = claims.sub;
    if (!issuerStr || !subjectStr) {
      reply.clearCookie('oidc_txn');
      reply.status(400).send({ errors: [{ code: 'BAD_REQUEST', message: 'Invalid ID token claims' }] });
      return;
    }
    // Validate nonce
    if (stored.nonce !== claims.nonce) {
      reply.clearCookie('oidc_txn');
      reply.status(400).send({ errors: [{ code: 'BAD_REQUEST', message: 'Nonce mismatch' }] });
      return;
    }

    // Upsert user
    const userRow = await services.upsertUser(issuerStr, subjectStr);
    // Create session using the repository - get the session ID it returns
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const sessionRow = await services.createSession(userRow.id, expiresAt);
    // Clear the OIDC transient cookie
    reply.clearCookie('oidc_txn');
    // Set cookie with the exact session ID returned by repository
    reply.setCookie('session', sessionRow.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.APP_ORIGIN.startsWith('https'),
      path: '/',
      maxAge: 86400,
    });
    // Do NOT retain upstream tokens
    reply.redirect(env.APP_ORIGIN);
  });

  // GET /auth/logout
  app.get('/auth/logout', async (request, reply) => {
    const sessionId = request.cookies['session'] as string;
    if (sessionId) {
      await services.revokeSession(sessionId);
    }
    reply.clearCookie('session');
    reply.redirect(env.APP_ORIGIN);
  });

  // GET /auth/me
  app.get('/auth/me', async (request, reply) => {
    const sessionId = request.cookies['session'] as string;
    if (!sessionId) {
      reply.status(401).send({ errors: [{ code: 'UNAUTHORIZED', message: 'Not authenticated' }] });
      return;
    }
    const session = await services.getSessionById(sessionId);
    if (!session) {
      reply.status(401).send({ errors: [{ code: 'UNAUTHORIZED', message: 'Session expired' }] });
      return;
    }
    const user = await services.getUserById(session.user_id);
    if (!user) {
      reply.status(401).send({ errors: [{ code: 'UNAUTHORIZED', message: 'User not found' }] });
      return;
    }
    reply.send({
      id: user.id,
      issuer: user.issuer,
      subject: user.subject,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    });
  });
}
