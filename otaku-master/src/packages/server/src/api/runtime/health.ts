import type { ElizaOS } from '@elizaos/core';
import { logger } from '@elizaos/core';
import express from 'express';
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../../middleware';
import type { AgentServer } from '../../index';

/**
 * Health monitoring and status endpoints
 */
export function createHealthRouter(elizaOS: ElizaOS, serverInstance: AgentServer): express.Router {
  const router = express.Router();

  // Health check
  router.get('/ping', (_req, res) => {
    res.json({ pong: true, timestamp: Date.now() });
  });

  // Hello world endpoint
  router.get('/hello', (_req, res) => {
    logger.info('Hello endpoint hit');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({ message: 'Hello World!' }));
  });

  // System status endpoint
  router.get('/status', (_req, res) => {
    logger.info('Status endpoint hit');
    res.setHeader('Content-Type', 'application/json');
    res.send(
      JSON.stringify({
        status: 'ok',
        agentCount: elizaOS.getAgents().length,
        timestamp: new Date().toISOString(),
      })
    );
  });

  // Health check - proxies to /api/agents for Railway healthcheck
  // Prevents 304 responses with no-cache headers
  router.get('/health', async (_req, res) => {
    // Prevent 304 responses - always return fresh data
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    try {
      // Internal proxy to /api/agents
      const port = process.env.PORT || 3000;
      const response = await fetch(`http://localhost:${port}/api/agents`);
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (error) {
      logger.error('[Health] Failed to proxy to /api/agents:', error instanceof Error ? error.message : String(error));
      res.status(503).json({ 
        success: false, 
        error: { code: 'PROXY_ERROR', message: 'Health check failed' }
      });
    }
  });

  // Server stop endpoint (admin only)
  router.post('/stop', requireAuth as any, requireAdmin as any, (_req: AuthenticatedRequest, res) => {
    logger.log({ apiRoute: '/stop' }, 'Server stopping...');
    serverInstance?.stop();
    res.json({ message: 'Server stopping...' });
  });

  return router;
}
