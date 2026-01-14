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
  await server.initialize({
    clientPath: path.resolve(__dirname, 'dist/frontend'), //  Point to OUR custom UI
    dataDir: process.env.PGLITE_DATA_DIR || path.resolve(__dirname, '.eliza/.elizadb'),
    postgresUrl: process.env.POSTGRES_URL,
  });

  // Load characters from project
  const projectPath = path.resolve(__dirname, 'dist/index.js');
  console.log(`🔍 Loading project from: ${projectPath}`);
  
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
