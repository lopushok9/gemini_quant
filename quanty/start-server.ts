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
  const postgresUrl = process.env.POSTGRES_URL;
  const dataDir = path.resolve(__dirname, './data');
  const projectPath = path.resolve(__dirname, 'dist/index.js');

  console.log('🎬 Starting AgentServer...');
  console.log(`🔍 Project Path: ${projectPath}`);

  const clientPath = path.resolve(__dirname, 'dist/frontend');
  console.log(`🔍 Client Path: ${clientPath}`);
  
  // Verify frontend files exist
  const fs = await import('fs');
  if (fs.existsSync(path.join(clientPath, 'index.html'))) {
      console.log('✅ Custom frontend found (index.html exists)');
  } else {
      console.warn('⚠️ WARNING: Custom frontend NOT found at expected path!');
      console.warn('   Server will likely fallback to default ElizaOS UI or 404.');
  }

  try {
    await server.initialize({
      clientPath: clientPath,
      dataDir: dataDir,
      serverOptions: {
        trustProxy: true,
      },
    });
    console.log('✅ AgentServer initialized locally');
  } catch (initError: any) {
    console.error('❌ CRITICAL: Failed to initialize AgentServer');
    console.error('Error Message:', initError.message);
    throw initError;
  }

  try {
    const project = await import(projectPath);
    const projectModule = project.default || project;

    if (projectModule.agents && Array.isArray(projectModule.agents)) {
      console.log(`🚀 Starting ${projectModule.agents.length} agent(s)...`);
      await server.startAgents(projectModule.agents);
      console.log(`✅ Started ${projectModule.agents.length} agent(s) successfully`);
    } else {
      console.error('❌ Error: No agents found in project.');
      throw new Error('No agents found in project');
    }
  } catch (err) {
    console.error('❌ Failed to load project bundle:', err);
    throw err;
  }

  const port = parseInt(process.env.SERVER_PORT || process.env.PORT || '3000');
  await server.start(port);

  console.log(`
 Server with custom UI running on http://localhost:${port}
`);
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});