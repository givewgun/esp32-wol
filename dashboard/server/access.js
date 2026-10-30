import { createRemoteJWKSet, jwtVerify } from 'jose';

// Cloudflare Access puts a signed JWT in Cf-Access-Jwt-Assertion on every request it lets through. Verifying it here
// (instead of trusting that traffic came via Access) means a request that reaches the container any other way,
// e.g. from another container on the tunnel-gateway network, gets nothing.
export function createAccessVerifier({ teamDomain, aud, allowedEmail, jwks }) {
  const keys = jwks ?? createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
  return async (token) => {
    if (typeof token !== 'string' || !token) throw new Error('missing token');
    const { payload } = await jwtVerify(token, keys, {
      issuer: `https://${teamDomain}`,
      audience: aud,
      algorithms: ['RS256'],
    });
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    if (email !== allowedEmail) throw new Error('email not allowed');
    return email;
  };
}
