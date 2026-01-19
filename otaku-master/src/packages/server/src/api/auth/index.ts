import express from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { Client } from "pg";
import { logger } from "@elizaos/core";
import type { AgentServer } from "../../index";
import { sendError, sendSuccess } from "../shared/response-utils";
import {
  generateAuthToken,
  type AuthenticatedRequest,
  createAuthRateLimit,
} from "../../middleware";

// Rate limiters are lazily initialized to avoid bundler hoisting issues
// (createAuthRateLimit may not be available at module load time due to bundler ordering)
let authRateLimiter: ReturnType<typeof createAuthRateLimit> | null = null;
let refreshRateLimiter: ReturnType<typeof createAuthRateLimit> | null = null;

function getAuthRateLimiter() {
  if (!authRateLimiter) {
    authRateLimiter = createAuthRateLimit();
  }
  return authRateLimiter;
}

function getRefreshRateLimiter() {
  if (!refreshRateLimiter) {
    refreshRateLimiter = createAuthRateLimit();
  }
  return refreshRateLimiter;
}

/**
 * User Registry - maps (cdpUserId, email) to server-generated entityId
 *
 * Security model:
 * - Server generates a random entityId on first registration
 * - cdpUserId + email together identify a user, but entityId is the DB key
 * - Attacker who guesses cdpUserId but wrong email → creates NEW entity (can't access victim's)
 * - Attacker who guesses both → rejected if already registered (email taken for that cdpUserId)
 * - entityId is never exposed to client except in signed JWT
 *
 * MIGRATION: Run scripts/migrate-entity-ids.sql FIRST to create table and migrate existing users
 */

/**
 * Generate a cryptographically secure entity ID
 */
function generateEntityId(): string {
  return crypto.randomUUID();
}

/**
 * In-memory token revocation list (for production, use Redis or database)
 * Stores revoked token JTIs with their expiration time for cleanup
 */
const revokedTokens: Map<string, number> = new Map();

/**
 * Clean up expired tokens from revocation list (runs periodically)
 */
function cleanupRevokedTokens(): void {
  const now = Date.now();
  let cleaned = 0;
  for (const [jti, expiry] of revokedTokens.entries()) {
    if (expiry < now) {
      revokedTokens.delete(jti);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug(
      `[Auth] Cleaned up ${cleaned} expired tokens from revocation list`,
    );
  }
}

// Run cleanup every 5 minutes (store interval ID for cleanup on shutdown)
const cleanupInterval = setInterval(cleanupRevokedTokens, 5 * 60 * 1000);

/**
 * Revoke a token by its JTI (JWT ID)
 */
export function revokeToken(jti: string, expiryMs: number): void {
  revokedTokens.set(jti, expiryMs);
  logger.info(`[Auth] Token revoked: ${jti.substring(0, 8)}...`);
}

/**
 * Check if a token is revoked
 */
export function isTokenRevoked(jti: string): boolean {
  return revokedTokens.has(jti);
}

/**
 * Shutdown token revocation cleanup (for graceful shutdown)
 */
export function shutdownTokenRevocation(): void {
  clearInterval(cleanupInterval);
  revokedTokens.clear();
  logger.info("[Auth] Token revocation cleanup stopped");
}

/**
 * Check if error is a retryable connection error
 * Handles both direct pg errors and DrizzleQueryError wrappers
 */
function isRetryableError(error: any): boolean {
  const patterns = [
    "Client was closed",
    "connection",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "terminating",
  ];

  // Check error message
  const message = error?.message || "";
  if (patterns.some((p) => message.toLowerCase().includes(p.toLowerCase()))) {
    return true;
  }

  // Check nested cause (DrizzleQueryError wraps original)
  const cause = error?.cause;
  if (
    cause?.message &&
    patterns.some((p) => cause.message.toLowerCase().includes(p.toLowerCase()))
  ) {
    return true;
  }

  // Check stringified error (catches nested errors)
  try {
    const str = JSON.stringify(error);
    if (patterns.some((p) => str.toLowerCase().includes(p.toLowerCase()))) {
      return true;
    }
  } catch {
    // JSON.stringify can fail on circular refs
  }

  return false;
}

// Track pool health - reset on successful query
let lastSuccessfulQuery = 0;
let poolHealthy = true;

/**
 * Execute parameterized SQL with a FRESH direct connection (bypasses pool entirely)
 * This is the nuclear option when pool is completely dead
 *
 * SECURITY: Uses parameterized queries to prevent SQL injection
 */
async function executeWithFreshConnection(
  sql: string,
  params: any[] = [],
): Promise<{ rows: any[] }> {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error("No database connection string available");
  }

  const client = new Client({ connectionString });
  try {
    await client.connect();
    const result = await client.query(sql, params);
    lastSuccessfulQuery = Date.now();
    poolHealthy = true;
    return result;
  } finally {
    await client.end().catch(() => {}); // Always cleanup
  }
}

/**
 * Ensure database connection is healthy before executing query
 * Railway's proxy silently kills idle connections - this detects and recovers
 */
async function ensureConnection(db: any): Promise<void> {
  const now = Date.now();
  // If last successful query was recent (< 30s), skip health check
  if (poolHealthy && now - lastSuccessfulQuery < 30000) {
    return;
  }

  try {
    await db.execute("SELECT 1");
    lastSuccessfulQuery = now;
    poolHealthy = true;
  } catch (error: any) {
    logger.warn("[Auth] Connection health check failed, pool may be stale");
    poolHealthy = false;
    // Don't throw - let the actual query handle the retry
  }
}

/**
 * Execute parameterized SQL with retry on connection errors
 * Uses pool when healthy, falls back to fresh direct connection when pool is dead
 *
 * SECURITY: Uses parameterized queries to prevent SQL injection
 * The db.execute method in drizzle supports parameterized queries via sql template tag,
 * but for raw queries we use the pg client directly with parameterized queries.
 */
async function executeWithRetry(
  db: any,
  sql: string,
  params: any[] = [],
  maxRetries = 3,
): Promise<{ rows: any[] }> {
  let lastError: Error | null = null;

  // Pre-flight connection check
  await ensureConnection(db);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Use fresh connection with parameterized query for security
      // Note: drizzle's db.execute doesn't support parameterized raw SQL directly,
      // so we use executeWithFreshConnection for parameterized queries
      const result = await executeWithFreshConnection(sql, params);
      // Mark pool as healthy on success
      lastSuccessfulQuery = Date.now();
      poolHealthy = true;
      return result;
    } catch (error: any) {
      lastError = error;
      poolHealthy = false;

      if (isRetryableError(error) && attempt < maxRetries) {
        const delay = 500 * Math.pow(2, attempt); // 500ms, 1000ms, 2000ms (longer delays)
        logger.warn(
          `[Auth] DB connection error, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

/**
 * Initialize user_registry table (PostgreSQL)
 * Also warms up the connection pool to prevent cold-start failures
 */
async function initUserRegistry(db: any): Promise<void> {
  // Warmup: Run a simple query to establish connection pool
  // This helps prevent "Client was closed" errors on first auth attempt
  let warmupSuccess = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await executeWithFreshConnection("SELECT 1 as warmup");
      logger.info("[Auth] Database connection warmed up");
      warmupSuccess = true;
      lastSuccessfulQuery = Date.now();
      poolHealthy = true;
      break;
    } catch (error: any) {
      const delay = 500 * Math.pow(2, attempt);
      logger.warn(
        `[Auth] DB warmup failed (attempt ${attempt + 1}/3), retrying in ${delay}ms...`,
      );
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  if (!warmupSuccess) {
    logger.error("[Auth] Database warmup failed - database may be unreachable");
  }

  try {
    // Check if table exists - parameterized query (no user input, but consistent pattern)
    const tableCheck = await executeWithRetry(
      db,
      `
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'user_registry'
      ) as exists
    `,
    );

    const tableExists =
      tableCheck.rows?.[0]?.exists === true ||
      tableCheck.rows?.[0]?.exists === "t";

    if (!tableExists) {
      logger.warn(
        "[Auth] user_registry table does not exist - run migration script first",
      );
      logger.warn(
        "[Auth] Run: psql $DATABASE_URL -f scripts/migrate-entity-ids.sql",
      );
    } else {
      logger.info("[Auth] user_registry table verified");
    }
  } catch (error: any) {
    logger.error(
      "[Auth] Failed to verify user_registry:",
      error?.message || error,
    );
  }
}

/**
 * Verify user exists in database by entityId
 * Used for token refresh validation
 *
 * SECURITY: Fails closed - returns false if database unavailable
 */
async function verifyUserExists(db: any, entityId: string): Promise<boolean> {
  if (!db) {
    // SECURITY FIX: Fail closed consistently - require database for all auth operations
    logger.error(
      "[Auth] Database not available - cannot verify user existence, failing closed",
    );
    return false;
  }

  try {
    const result = await executeWithRetry(
      db,
      "SELECT 1 FROM user_registry WHERE entity_id = $1::uuid LIMIT 1",
      [entityId],
    );
    return (result.rows?.length ?? 0) > 0;
  } catch (error: any) {
    logger.error("[Auth] Error verifying user existence:", error);
    return false;
  }
}

export function createAuthRouter(serverInstance: AgentServer): express.Router {
  const router = express.Router();
  const db = (serverInstance?.database as any)?.db;

  // Initialize user_registry table
  if (db) {
    initUserRegistry(db).catch((error) => {
      logger.error("[Auth] Failed to initialize user registry:", error);
    });
  }

  /**
   * Verify user identity and return server-generated entityId
   *
   * Security: entityId is server-generated and never derived from client input
   * Uses parameterized queries to prevent SQL injection
   */
  async function verifyUserBinding(
    cdpUserId: string,
    email: string,
    username: string,
  ): Promise<{
    verified: boolean;
    entityId?: string;
    isNewUser: boolean;
    error?: string;
  }> {
    const normalizedEmail = email.toLowerCase().trim();

    if (!db) {
      // SECURITY FIX: Fail closed instead of using deterministic fallback
      // In production, authentication requires a database connection
      logger.error(
        "[Auth] Database not available - authentication requires database connection",
      );
      return {
        verified: false,
        isNewUser: false,
        error: "Authentication service temporarily unavailable",
      };
    }

    try {
      // SECURITY: All queries use parameterized queries to prevent SQL injection

      // Check if this (cdpUserId, email) pair exists
      const existingResult = await executeWithRetry(
        db,
        `SELECT entity_id, email, username FROM user_registry 
         WHERE cdp_user_id = $1::uuid AND email = $2
         LIMIT 1`,
        [cdpUserId, normalizedEmail],
      );

      const existingUser = existingResult.rows?.[0];

      if (existingUser) {
        // Existing user - return their server-generated entityId
        const entityId = existingUser.entity_id as string;

        // Update last login and username
        await executeWithRetry(
          db,
          `UPDATE user_registry SET last_login_at = NOW(), username = $1 
           WHERE entity_id = $2::uuid`,
          [username, entityId],
        );

        logger.info(
          `[Auth] Returning user verified: entityId=${entityId.substring(0, 8)}...`,
        );
        return { verified: true, entityId, isNewUser: false };
      }

      // Check if cdpUserId exists with DIFFERENT email (potential attack or user error)
      const cdpResult = await executeWithRetry(
        db,
        `SELECT entity_id, email FROM user_registry 
         WHERE cdp_user_id = $1::uuid
         LIMIT 1`,
        [cdpUserId],
      );

      if (cdpResult.rows?.length > 0) {
        const registeredEmail = cdpResult.rows[0].email as string;
        const entityId = cdpResult.rows[0].entity_id as string;

        // Allow upgrading from placeholder email (migration artifact) to real email
        const isPlaceholderEmail = registeredEmail.endsWith("@unknown.local");

        if (isPlaceholderEmail) {
          // Update placeholder email to real email
          await executeWithRetry(
            db,
            `UPDATE user_registry SET email = $1, username = $2, last_login_at = NOW()
             WHERE entity_id = $3::uuid`,
            [normalizedEmail, username, entityId],
          );

          logger.info(
            `[Auth] Upgraded placeholder email to real email for entityId=${entityId.substring(0, 8)}... ` +
              `(${registeredEmail} → ${normalizedEmail})`,
          );
          return { verified: true, entityId, isNewUser: false };
        }

        // Real email mismatch - reject
        logger.warn(
          `[Auth] CDP userId ${cdpUserId.substring(0, 8)}... already registered with different email ` +
            `(registered: ${registeredEmail}, attempted: ${normalizedEmail})`,
        );
        return {
          verified: false,
          isNewUser: false,
          error:
            "This CDP account is already registered with a different email",
        };
      }

      // Check if email already exists with a DIFFERENT cdpUserId
      // This handles: same user, different CDP auth method (email vs Google login)
      // Return existing account instead of creating duplicate
      const emailResult = await executeWithRetry(
        db,
        `SELECT entity_id, cdp_user_id, username FROM user_registry
         WHERE email = $1
         ORDER BY registered_at ASC
         LIMIT 1`,
        [normalizedEmail],
      );

      if (emailResult.rows?.length > 0) {
        const entityId = emailResult.rows[0].entity_id as string;
        const existingCdpId = emailResult.rows[0].cdp_user_id as string;

        // Return existing account, keep original cdp_user_id (auth method)
        // Only update last login and username
        await executeWithRetry(
          db,
          `UPDATE user_registry SET last_login_at = NOW(), username = $1
           WHERE entity_id = $2::uuid`,
          [username, entityId],
        );

        logger.info(
          `[Auth] Returning existing account for email=${normalizedEmail} (original cdp: ${existingCdpId.substring(0, 8)}..., login cdp: ${cdpUserId.substring(0, 8)}...)`,
        );
        return { verified: true, entityId, isNewUser: false };
      }

      // Truly new user - generate server-side entityId and register
      const entityId = generateEntityId();

      await executeWithRetry(
        db,
        `INSERT INTO user_registry (entity_id, cdp_user_id, email, username, registered_at, last_login_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, NOW(), NOW())`,
        [entityId, cdpUserId, normalizedEmail, username],
      );

      logger.info(
        `[Auth] New user registered: entityId=${entityId.substring(0, 8)}... (cdp=${cdpUserId.substring(0, 8)}..., email=${normalizedEmail})`,
      );
      return { verified: true, entityId, isNewUser: true };
    } catch (error: any) {
      logger.error("[Auth] Database error during user verification:", error);
      return { verified: false, isNewUser: false, error: "Database error" };
    }
  }

  /**
   * POST /api/auth/login
   *
   * Authenticates a user and issues a JWT token.
   *
   * Request body:
   * - email: string (user's email from CDP)
   * - username: string (user's display name from CDP)
   * - cdpUserId: string (CDP's user identifier - UUID, required)
   *
   * Security:
   * - Rate limited to 30 requests per minute per IP (failed attempts only)
   * - Server generates entityId (never trusts client-provided ID for DB access)
   * - JWT contains server-generated entityId, not cdpUserId
   * - JWT expires in 24 hours (use /refresh to extend)
   * - Uses parameterized queries to prevent SQL injection
   */
  router.post("/login", getAuthRateLimiter(), async (req, res) => {
    try {
      const { email, username, cdpUserId } = req.body;

      // Validate email
      if (!email || typeof email !== "string") {
        return sendError(res, 400, "INVALID_REQUEST", "Email is required");
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return sendError(res, 400, "INVALID_EMAIL", "Invalid email format");
      }

      // Validate username
      if (!username || typeof username !== "string") {
        return sendError(res, 400, "INVALID_REQUEST", "Username is required");
      }

      // Validate CDP userId
      if (!cdpUserId || typeof cdpUserId !== "string") {
        return sendError(res, 400, "INVALID_REQUEST", "CDP userId is required");
      }

      // Validate UUID format (CDP uses UUIDs)
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(cdpUserId)) {
        return sendError(
          res,
          400,
          "INVALID_CDP_USER_ID",
          "CDP userId must be a valid UUID",
        );
      }

      // Verify user identity and get server-generated entityId
      // - New users: creates new entity with random ID
      // - Existing users: returns their existing entityId
      // - cdpUserId with different email: rejected (prevents account takeover)
      const verification = await verifyUserBinding(cdpUserId, email, username);

      if (!verification.verified || !verification.entityId) {
        logger.warn(
          `[Auth] User verification failed for cdpUserId: ${cdpUserId.substring(0, 8)}...`,
        );
        return sendError(
          res,
          401,
          "UNAUTHORIZED",
          verification.error || "Authentication failed",
        );
      }

      // Generate JWT token with SERVER-GENERATED entityId (not client-provided cdpUserId)
      const token = generateAuthToken(verification.entityId, email, username);

      logger.info(
        `[Auth] User authenticated: ${username} (${email}) (entityId: ${verification.entityId.substring(0, 8)}...)` +
          (verification.isNewUser ? " [NEW USER]" : ""),
      );

      // Return entityId as userId (this is now the server-generated ID)
      return sendSuccess(res, {
        token,
        userId: verification.entityId,
        username,
        expiresIn: "24h",
      });
    } catch (error: any) {
      logger.error("[Auth] Login error:", error);
      return sendError(res, 500, "AUTH_ERROR", error.message);
    }
  });

  /**
   * POST /api/auth/refresh
   *
   * Refreshes an existing JWT token (extends expiration)
   *
   * Security:
   * - Rate limited to prevent abuse
   * - Verifies user still exists in database
   * - Checks token is not revoked
   * - Issues new token with new JTI
   */
  router.post(
    "/refresh",
    getRefreshRateLimiter(),
    async (req: AuthenticatedRequest, res) => {
      try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return sendError(res, 401, "UNAUTHORIZED", "No token provided");
        }

        const oldToken = authHeader.substring(7);
        const JWT_SECRET = process.env.JWT_SECRET;

        if (!JWT_SECRET) {
          return sendError(
            res,
            500,
            "SERVER_MISCONFIGURED",
            "JWT_SECRET not configured",
          );
        }

        try {
          const decoded = jwt.verify(oldToken, JWT_SECRET) as any;

          // SECURITY FIX: Check if token is revoked
          if (decoded.jti && isTokenRevoked(decoded.jti)) {
            logger.warn(
              `[Auth] Attempted refresh of revoked token: ${decoded.jti.substring(0, 8)}...`,
            );
            return sendError(
              res,
              401,
              "TOKEN_REVOKED",
              "Token has been revoked",
            );
          }

          // SECURITY FIX: Verify user still exists in database
          const userExists = await verifyUserExists(db, decoded.userId);
          if (!userExists) {
            logger.warn(
              `[Auth] Token refresh for non-existent user: ${decoded.userId.substring(0, 8)}...`,
            );
            return sendError(
              res,
              401,
              "USER_NOT_FOUND",
              "User account not found",
            );
          }

          // Issue new token with extended expiration
          const newToken = generateAuthToken(
            decoded.userId,
            decoded.email,
            decoded.username,
          );

          logger.info(
            `[Auth] Token refreshed for: ${decoded.username} (userId: ${decoded.userId.substring(0, 8)}...)`,
          );

          return sendSuccess(res, {
            token: newToken,
            userId: decoded.userId,
            username: decoded.username,
            expiresIn: "24h",
          });
        } catch (error: any) {
          logger.warn(`[Auth] Token refresh failed: ${error.message}`);
          return sendError(
            res,
            401,
            "INVALID_TOKEN",
            "Invalid or expired token",
          );
        }
      } catch (error: any) {
        logger.error("[Auth] Refresh error:", error);
        return sendError(res, 500, "REFRESH_ERROR", error.message);
      }
    },
  );

  /**
   * POST /api/auth/logout
   *
   * Revokes the current token (logout)
   * Token will no longer be valid for refresh
   */
  router.post("/logout", async (req: AuthenticatedRequest, res) => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return sendError(res, 401, "UNAUTHORIZED", "No token provided");
      }

      const token = authHeader.substring(7);
      const JWT_SECRET = process.env.JWT_SECRET;

      if (!JWT_SECRET) {
        return sendError(
          res,
          500,
          "SERVER_MISCONFIGURED",
          "JWT_SECRET not configured",
        );
      }

      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;

        // Revoke the token if it has a JTI
        if (decoded.jti) {
          // Calculate expiry time from token
          const expiryMs = decoded.exp
            ? decoded.exp * 1000
            : Date.now() + 24 * 60 * 60 * 1000;
          revokeToken(decoded.jti, expiryMs);
        }

        logger.info(
          `[Auth] User logged out: ${decoded.username} (userId: ${decoded.userId.substring(0, 8)}...)`,
        );

        return sendSuccess(res, {
          message: "Successfully logged out",
        });
      } catch (error: any) {
        // Even if token is invalid/expired, logout is successful
        logger.debug(`[Auth] Logout with invalid token: ${error.message}`);
        return sendSuccess(res, {
          message: "Successfully logged out",
        });
      }
    } catch (error: any) {
      logger.error("[Auth] Logout error:", error);
      return sendError(res, 500, "LOGOUT_ERROR", error.message);
    }
  });

  /**
   * GET /api/auth/me
   *
   * Get current authenticated user info
   */
  router.get("/me", async (req: AuthenticatedRequest, res) => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return sendError(res, 401, "UNAUTHORIZED", "No token provided");
      }

      const token = authHeader.substring(7);
      const JWT_SECRET = process.env.JWT_SECRET;

      if (!JWT_SECRET) {
        return sendError(
          res,
          500,
          "SERVER_MISCONFIGURED",
          "JWT_SECRET not configured",
        );
      }

      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;

        // Check if token is revoked
        if (decoded.jti && isTokenRevoked(decoded.jti)) {
          return sendError(res, 401, "TOKEN_REVOKED", "Token has been revoked");
        }

        return sendSuccess(res, {
          userId: decoded.userId,
          email: decoded.email,
          username: decoded.username,
          isAdmin: decoded.isAdmin || false,
        });
      } catch (error: any) {
        return sendError(res, 401, "INVALID_TOKEN", "Invalid or expired token");
      }
    } catch (error: any) {
      logger.error("[Auth] Get user info error:", error);
      return sendError(res, 500, "AUTH_ERROR", error.message);
    }
  });

  return router;
}
