import type { AuthenticatedApprover } from "./types";

export interface OIDCConfig {
  issuer: string;
  audience: string;
  jwksUri?: string;
  discoveryUri?: string;
  clockSkewSeconds?: number;
  requiredRole?: string;
}

interface JWKSKey {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

interface JWKSResponse {
  keys: JWKSKey[];
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function decodeJsonPart(value: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as Record<string, unknown>;
}

export class OIDCAuthBridge {
  private jwks?: JWKSResponse;
  private jwksFetchedAt = 0;
  private discoveredJwksUri?: string;

  constructor(private readonly config: OIDCConfig) {
    if (!config.issuer || !config.audience)
      throw new Error("OIDC issuer and audience are required");
  }

  /** Verifies an RS256 OIDC JWT against the issuer JWKS and validates iss/aud/exp. */
  public async verifyApproverToken(token: string): Promise<AuthenticatedApprover> {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("[AuthError] Malformed bearer token.");

    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const header = decodeJsonPart(encodedHeader);
    const payload = decodeJsonPart(encodedPayload);
    if (header["alg"] !== "RS256" || typeof header["kid"] !== "string") {
      throw new Error("[AuthError] Only RS256 OIDC tokens with a key id are accepted.");
    }

    const jwks = await this.getJwks();
    const key = jwks.keys.find(
      (candidate) => candidate.kid === header["kid"] && candidate.kty === "RSA",
    );
    if (!key?.n || !key.e) throw new Error("[AuthError] Signing key not found in OIDC JWKS.");

    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: key.n, e: key.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      cryptoKey,
      decodeBase64Url(encodedSignature) as BufferSource,
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    );
    if (!valid) throw new Error("[AuthError] Invalid OIDC token signature.");

    const now = Math.floor(Date.now() / 1000);
    const skew = this.config.clockSkewSeconds ?? 60;
    if (payload["iss"] !== this.config.issuer) throw new Error("[AuthError] Invalid token issuer.");
    const audience = Array.isArray(payload["aud"]) ? payload["aud"] : [payload["aud"]];
    if (!audience.includes(this.config.audience))
      throw new Error("[AuthError] Invalid token audience.");
    if (typeof payload["exp"] !== "number" || payload["exp"] < now - skew)
      throw new Error("[AuthError] Token expired.");
    if (typeof payload["nbf"] === "number" && payload["nbf"] > now + skew)
      throw new Error("[AuthError] Token is not yet valid.");
    if (typeof payload["sub"] !== "string" || !payload["sub"])
      throw new Error("[AuthError] Token has no subject.");

    const roles = Array.isArray(payload["roles"])
      ? payload["roles"].filter((r): r is string => typeof r === "string")
      : [];
    if (this.config.requiredRole && !roles.includes(this.config.requiredRole))
      throw new Error("[AuthError] Approver lacks required role.");
    const approver: AuthenticatedApprover = {
      id: payload["sub"],
      roles,
      authenticatedAt: Date.now(),
    };
    if (typeof payload["email"] === "string") approver.email = payload["email"];
    return approver;
  }

  private async getJwks(): Promise<JWKSResponse> {
    if (this.jwks && Date.now() - this.jwksFetchedAt < 15 * 60_000) return this.jwks;
    let uri = this.config.jwksUri ?? this.discoveredJwksUri;
    if (!uri) {
      const discoveryUri =
        this.config.discoveryUri ??
        `${this.config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
      const discoveryResponse = await fetch(discoveryUri);
      if (!discoveryResponse.ok)
        throw new Error(`[AuthError] OIDC discovery request failed: ${discoveryResponse.status}`);
      const discovery = (await discoveryResponse.json()) as { jwks_uri?: unknown };
      if (typeof discovery.jwks_uri !== "string" || !discovery.jwks_uri)
        throw new Error("[AuthError] OIDC discovery did not provide jwks_uri.");
      this.discoveredJwksUri = discovery.jwks_uri;
      uri = discovery.jwks_uri;
    }
    const response = await fetch(uri);
    if (!response.ok) throw new Error(`[AuthError] OIDC JWKS request failed: ${response.status}`);
    const body = (await response.json()) as JWKSResponse;
    if (!Array.isArray(body.keys)) throw new Error("[AuthError] Invalid JWKS response.");
    this.jwks = body;
    this.jwksFetchedAt = Date.now();
    return body;
  }
}
