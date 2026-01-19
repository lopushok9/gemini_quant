import {
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  logger,
} from "@elizaos/core";
import { Client } from "pg";

export interface EntityWalletResult {
  success: true;
  walletAddress: string;
  metadata?: Record<string, any>;
}

export interface EntityWalletError {
  success: false;
  result: ActionResult;
}

export type EntityWalletResponse = EntityWalletResult | EntityWalletError;

// Type for database executor function
type DbExecutor = (sql: string) => Promise<{ rows: any[] }>;

/**
 * Escape string for SQL to prevent injection
 */
export function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}

/**
 * Execute a query with a fresh direct connection.
 * Used to reliably query user_registry for CDP account resolution.
 */
async function executeWithDirectConnection(sql: string): Promise<{ rows: any[] }> {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('No database connection string available');
  }

  const client = new Client({ connectionString });
  try {
    await client.connect();
    const result = await client.query(sql);
    return result;
  } finally {
    await client.end().catch(() => {}); // Always cleanup
  }
}

/**
 * Resolve entity_id to cdp_user_id from user_registry.
 * The cdp_user_id is the correct account name for CDP server wallets.
 * 
 * Background: During migration, old entity_ids became cdp_user_ids.
 * Server wallets are keyed by the OLD entity_id (now stored as cdp_user_id).
 * 
 * @param dbExecute - Function to execute SQL queries (optional, will use direct connection if not provided)
 * @param entityId - The entity_id to resolve
 * @param logPrefix - Optional prefix for log messages (default: 'resolveWalletAccountName')
 */
export async function resolveWalletAccountName(
  dbExecute: DbExecutor | null,
  entityId: string,
  logPrefix = 'resolveWalletAccountName'
): Promise<string> {
  // Use provided executor or fall back to direct connection
  const executor = dbExecute ?? executeWithDirectConnection;

  try {
    const result = await executor(`
      SELECT cdp_user_id FROM user_registry 
      WHERE entity_id = '${escapeSql(entityId)}'::uuid 
      LIMIT 1
    `);

    if (result.rows?.[0]?.cdp_user_id) {
      const cdpUserId = result.rows[0].cdp_user_id as string;
      logger.debug(`[${logPrefix}] Resolved entity_id=${entityId.substring(0, 8)}... to cdp_user_id=${cdpUserId.substring(0, 8)}...`);
      return cdpUserId;
    }

    logger.warn(`[${logPrefix}] No user_registry entry for entity_id=${entityId.substring(0, 8)}..., using entityId as accountName`);
    return entityId;
  } catch (error) {
    logger.error(`[${logPrefix}] Failed to resolve wallet account name:`, error);
    return entityId;
  }
}

/**
 * Helper to get db executor from runtime (may return null if not available)
 */
function getDbExecutorFromRuntime(runtime: IAgentRuntime): DbExecutor | null {
  // Try multiple paths to access database executor
  const runtimeAny = runtime as any;
  
  // Path 1: runtime.db.execute (Drizzle style)
  if (runtimeAny.db?.execute) {
    return runtimeAny.db.execute.bind(runtimeAny.db);
  }
  
  // Path 2: runtime.databaseAdapter.db.execute
  if (runtimeAny.databaseAdapter?.db?.execute) {
    return runtimeAny.databaseAdapter.db.execute.bind(runtimeAny.databaseAdapter.db);
  }
  
  // Not available - resolveWalletAccountName will use direct connection
  return null;
}

/**
 * Retrieves entity wallet information from runtime and validates it exists.
 * Returns either the wallet address on success, or a complete ActionResult on failure.
 */
export async function getEntityWallet(
  runtime: IAgentRuntime,
  message: Memory,
  actionName: string,
  callback?: HandlerCallback,
): Promise<EntityWalletResponse> {
  try {
    const entityId = message.entityId;
    const entity = (await runtime.getEntityById(entityId)) as any;

    if (!entity) {
      const errorText = "Unable to fetch entity information. Please try again.";

      if (callback) {
        await callback({
          text: errorText,
          content: { error: "Entity not found" },
        });
      }

      return {
        success: false,
        result: {
          text: errorText,
          success: false,
          values: { walletCreated: false, error: true },
          data: {
            actionName,
            error: "Entity not found",
          },
          error: new Error("Entity not found"),
        },
      };
    }

    // After entity migration fix: entities now have walletAddress directly in their metadata
    // First check if entity has wallet address directly (frontend-created entities)
    let walletAddress = entity.metadata?.walletAddress as string | undefined;
    let walletEntityId = entityId; // Default to the entity itself

    // Fallback: Check for legacy author_id indirection (for edge cases with old server-created entities)
    if (!walletAddress && entity.metadata?.author_id) {
      walletEntityId = entity.metadata.author_id;
      const walletEntity = await runtime.getEntityById(walletEntityId);
      if (walletEntity) {
        walletAddress = walletEntity.metadata?.walletAddress as string;
      }
    }

    // Check if wallet exists
    if (!walletAddress) {
      const errorText =
        "Unable to fetch user's wallet information. Please create a wallet first.";

      if (callback) {
        await callback({
          text: errorText,
          content: { error: "Wallet not found" },
        });
      }

      return {
        success: false,
        result: {
          text: errorText,
          success: false,
          values: { walletCreated: false, error: true },
          data: {
            actionName,
            error: "Wallet not found",
          },
          error: new Error("Wallet not found"),
        },
      };
    }

    // Resolve entityId to cdp_user_id for CDP server wallet operations
    // Server wallets are keyed by cdp_user_id (the OLD entity_id from before migration)
    const dbExecute = getDbExecutorFromRuntime(runtime);
    const accountName = await resolveWalletAccountName(dbExecute, entityId, 'getEntityWallet');

    return {
      success: true,
      walletAddress,
      metadata: {
        walletAddress,
        walletEntityId,
        accountName: accountName || walletEntityId
      },
    };
  } catch (error) {
    logger.error("Error getting entity wallet address:", error instanceof Error ? error.message : String(error));

    const errorText = "Failed to retrieve wallet information.";

    if (callback) {
      await callback({
        text: errorText,
        content: { error: "Wallet retrieval failed" },
      });
    }

    return {
      success: false,
      result: {
        text: errorText,
        success: false,
        values: { walletCreated: false, error: true },
        data: {
          actionName,
          error: error instanceof Error ? error.message : String(error),
        },
        error: error instanceof Error ? error : new Error(String(error)),
      },
    };
  }
}
