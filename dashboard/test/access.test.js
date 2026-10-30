import { SignJWT, UnsecuredJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAccessVerifier } from '../server/access.js';

const teamDomain = 'team.cloudflareaccess.com';
const aud = 'app-aud';
const allowedEmail = 'owner@example.com';
let keys, verify;

function token(claims = {}, { key = keys.privateKey, exp = '5m' } = {}) {
  return new SignJWT({ email: 'Owner@Example.com', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(claims.iss ?? `https://${teamDomain}`)
    .setAudience(claims.aud ?? aud)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key);
}

beforeAll(async () => {
  keys = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256' };
  verify = createAccessVerifier({ teamDomain, aud, allowedEmail, jwks: createLocalJWKSet({ keys: [jwk] }) });
});

describe('access verifier', () => {
  it('accepts a valid token and returns the email', async () => {
    expect(await verify(await token())).toBe('owner@example.com');
  });

  it('rejects wrong audience', async () => {
    await expect(verify(await token({ aud: 'other' }))).rejects.toThrow();
  });

  it('rejects wrong issuer', async () => {
    await expect(verify(await token({ iss: 'https://evil.cloudflareaccess.com' }))).rejects.toThrow();
  });

  it('rejects expired tokens', async () => {
    await expect(verify(await token({}, { exp: Math.floor(Date.now() / 1000) - 60 }))).rejects.toThrow();
  });

  it('rejects other emails', async () => {
    await expect(verify(await token({ email: 'someone@example.com' }))).rejects.toThrow('email not allowed');
    await expect(verify(await token({ email: undefined }))).rejects.toThrow();
  });

  it('rejects alg none', async () => {
    const t = new UnsecuredJWT({ email: allowedEmail }).setIssuer(`https://${teamDomain}`).setAudience(aud).encode();
    await expect(verify(t)).rejects.toThrow();
  });

  it('rejects a token signed by another key', async () => {
    const other = await generateKeyPair('RS256');
    await expect(verify(await token({}, { key: other.privateKey }))).rejects.toThrow();
  });

  it('rejects HS256 token keyed with the public key', async () => {
    const secret = new TextEncoder().encode(JSON.stringify(await exportJWK(keys.publicKey)));
    const t = await new SignJWT({ email: allowedEmail })
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .setIssuer(`https://${teamDomain}`)
      .setAudience(aud)
      .setExpirationTime('5m')
      .sign(secret);
    await expect(verify(t)).rejects.toThrow();
  });

  it('rejects missing or garbage tokens', async () => {
    await expect(verify(undefined)).rejects.toThrow();
    await expect(verify('a.b.c')).rejects.toThrow();
  });
});
