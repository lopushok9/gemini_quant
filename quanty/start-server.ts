#!/usr/bin/env bun
/**
 * Custom server start script that uses our custom UI
 */

import { AgentServer } from '@elizaos/server';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const server = new AgentServer();
  const postgresUrl = process.env.POSTGRES_URL;
  const dataDir = path.resolve(__dirname, './data');
  const projectPath = path.resolve(__dirname, 'dist/index.js');

  const port = parseInt(process.env.PORT || process.env.SERVER_PORT || '3000');

  console.log('🎬 Starting AgentServer...');

  // 2. Resolve Client Path
  let clientPath = path.resolve(__dirname, 'dist/frontend');
  const nestedPath = path.resolve(__dirname, 'dist/frontend/src/frontend');
  if (!fs.existsSync(path.join(clientPath, 'index.html')) && fs.existsSync(path.join(nestedPath, 'index.html'))) {
      clientPath = nestedPath;
  }

  // 3. Initialize Server
  try {
    await server.initialize({
      clientPath: clientPath,
      dataDir: dataDir,
      serverOptions: { trustProxy: true },
    });
    server.app.set('trust proxy', 1);
    
    // Health check
    server.app.get('/health', (req, res) => res.status(200).send('OK'));

    // Custom chat endpoint that accepts conversation history (bypasses socket for history support)
    server.app.post('/api/quanty/chat', async (req: any, res: any) => {
        try {
            const { message, conversationHistory, agentId } = req.body;

            if (!message) {
                return res.status(400).json({ error: 'Message is required' });
            }

            console.log('[QuantyChat] Received message with history length:', conversationHistory?.length || 0);

            // Get the bus module to emit directly
            const busModule = await import(path.resolve(__dirname, 'dist/bus.js'));
            const internalMessageBus = busModule.default;

            // Emit a custom event that our bootstrap can listen to
            internalMessageBus.emit('quanty_chat_message', {
                content: message,
                conversationHistory: conversationHistory || [],
                agentId: agentId,
                timestamp: Date.now()
            });

            res.json({ success: true, message: 'Message queued for processing' });
        } catch (error: any) {
            console.error('[QuantyChat] Error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Custom root route
    server.app.get('/', (req, res) => {
        const indexHtml = path.join(clientPath, 'index.html');
        if (fs.existsSync(indexHtml)) res.sendFile(indexHtml);
        else res.status(404).send('Custom UI not found');
    });

    console.log('✅ AgentServer initialized');
  } catch (initError: any) {
    console.error('❌ Failed to initialize AgentServer:', initError.message);
    throw initError;
  }

  // 4. CRITICAL FIX: START LISTENING BEFORE STARTING AGENTS
  // This ensures the HTTP port is open when agents/MessageBus try to connect to it.
  console.log(`🚀 Binding AgentServer to port ${port}...`);
  await server.start(port);
  console.log(`✅ Server is now listening on port ${port}`);

  // 5. Start Agents
  try {
    const project = await import(projectPath);
    const projectModule = project.default || project;

    if (projectModule.agents && Array.isArray(projectModule.agents)) {
      console.log(`🤖 Starting ${projectModule.agents.length} agent(s)...`);
      await server.startAgents(projectModule.agents);
      console.log(`✅ All agents started and registered.`);
    } else {
      throw new Error('No agents found in project');
    }
  } catch (err) {
    console.error('❌ Failed to start agents:', err);
    throw err;
  }

  // 6. Setup internal bus -> SocketIO bridge for agent responses
  // This allows agent responses to reach the UI without HTTP calls to localhost
  try {
    const busModule = await import(path.resolve(__dirname, 'dist/bus.js'));
    const internalMessageBus = busModule.default;
    
    internalMessageBus.on('agent_response', (payload: any) => {
      console.log('[Server] 📤 Received agent_response, broadcasting via SocketIO');
      
      if ((server as any).socketIO && payload.channel_id) {
        (server as any).socketIO.to(payload.channel_id).emit('messageBroadcast', {
          senderId: payload.author_id,
          senderName: payload.metadata?.agentName || 'Quanty',
          text: payload.content,
          roomId: payload.channel_id,
          serverId: payload.server_id,
          createdAt: payload.created_at || Date.now(),
          source: payload.source_type,
          id: payload.id,
        });
        console.log(`[Server] ✅ Broadcasted to channel ${payload.channel_id}`);
      } else {
        console.warn('[Server] ⚠️ SocketIO not available or missing channel_id');
      }
    });
    
    console.log('✅ Internal bus -> SocketIO bridge configured');
  } catch (busErr) {
    console.warn('⚠️ Could not setup internal bus bridge:', busErr);
  }

  console.log(`
 🏁 QUANTY SYSTEM FULLY OPERATIONAL
 🏠 UI: http://localhost:${port}
`);
}

main().catch((error) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});