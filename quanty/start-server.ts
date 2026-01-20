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
  
  // 1. CRITICAL: Tell ElizaOS where its own message server is.
  process.env.CENTRAL_MESSAGE_SERVER_URL = `http://127.0.0.1:${port}`;
  console.log(`🌍 Central Message Server URL: ${process.env.CENTRAL_MESSAGE_SERVER_URL}`);

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

  console.log(`
 🏁 QUANTY SYSTEM FULLY OPERATIONAL
 🏠 UI: http://localhost:${port}
 🔗 Internal: http://127.0.0.1:${port}
`);
}

main().catch((error) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});