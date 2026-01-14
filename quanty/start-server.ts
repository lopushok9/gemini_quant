#!/usr/bin/env bun
/**
 * Custom server start script that uses our custom UI
 */

import { AgentServer } from '@elizaos/server';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const server = new AgentServer();

  // Initialize server with custom client path
  const postgresUrl = process.env.POSTGRES_URL;
  const dataDir = process.env.PGLITE_DATA_DIR || path.resolve(__dirname, './data');
  
  try {
    console.log('🎬 Initializing AgentServer...');
    await server.initialize({
      clientPath: path.resolve(__dirname, 'dist/frontend'),
      dataDir: dataDir,
      postgresUrl: postgresUrl,
    });
    console.log('✅ AgentServer initialized');
  } catch (initError: any) {
    console.error('❌ CRITICAL: Failed to initialize AgentServer');
    console.error('Error Message:', initError.message);
    if (initError.cause) console.error('Cause:', initError.cause);
    // This will print the specific PG error if available
    if (initError.detail) console.error('PG Detail:', initError.detail);
    if (initError.code) console.error('PG Code:', initError.code);
    throw initError;
  }

  try {
    const project = await import(projectPath);
    const projectModule = project.default || project;
    
    console.log('📦 Project module keys:', Object.keys(projectModule));
    
    if (projectModule.agents && Array.isArray(projectModule.agents)) {
      console.log(`🚀 Starting ${projectModule.agents.length} agent(s)...`);
      
      // Pass the agents array directly. Each agent object already has 'character' and 'plugins'
      await server.startAgents(projectModule.agents);
      
      console.log(`✅ Started ${projectModule.agents.length} agent(s) successfully`);
    } else {
      console.error('❌ Error: No agents found in project. Make sure your src/index.ts exports an "agents" array.');
      throw new Error('No agents found in project');
    }
  } catch (err) {
    console.error('❌ Failed to load project bundle:', err);
    throw err;
  }

  // Start server
  const port = parseInt(process.env.PORT || process.env.SERVER_PORT || '3000');
  await server.start(port);

  console.log(`
 Server with custom UI running on http://localhost:${port}
`);
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
