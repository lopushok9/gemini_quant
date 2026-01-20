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

  console.log('🎬 Starting AgentServer...');
  console.log(`🔍 Project Path: ${projectPath}`);

  // Determine Client Path (Handle potential nesting from Vite)
  let clientPath = path.resolve(__dirname, 'dist/frontend');
  
  // If Vite nested it (common issue), check the nested path
  const nestedPath = path.resolve(__dirname, 'dist/frontend/src/frontend');
  if (!fs.existsSync(path.join(clientPath, 'index.html')) && fs.existsSync(path.join(nestedPath, 'index.html'))) {
      console.log('📂 Detected nested frontend structure, adjusting clientPath...');
      clientPath = nestedPath;
  }

  console.log(`🔍 Final Client Path: ${clientPath}`);
  
  // Verify frontend files exist
  if (fs.existsSync(path.join(clientPath, 'index.html'))) {
      console.log('✅ Custom frontend found (index.html exists)');
  } else {
      console.warn('⚠️ WARNING: Custom frontend NOT found at expected path!');
      console.warn('   Checking dist contents:');
      try {
          const { execSync } = await import('child_process');
          console.log(execSync('ls -R dist').toString());
      } catch (e) {}
  }

  try {
    await server.initialize({
      clientPath: clientPath,
      dataDir: dataDir,
      serverOptions: {
        trustProxy: true,
      },
    });
    // CRITICAL FIX FOR RAILWAY: Explicitly enable trust proxy on the Express app
    // The serverOptions above might not be propagating correctly in this version
    server.app.enable('trust proxy');
    
    console.log('✅ AgentServer initialized locally');
  } catch (initError: any) {
    console.error('❌ CRITICAL: Failed to initialize AgentServer');
    console.error('Error Message:', initError.message);
    throw initError;
  }

  // Force root route to serve our index.html (Bypass library defaults)
  server.app.get('/', (req, res) => {
      const indexHtml = path.join(clientPath, 'index.html');
      if (fs.existsSync(indexHtml)) {
          res.sendFile(indexHtml);
      } else {
          res.status(404).send('Custom UI index.html not found at ' + clientPath);
      }
  });

  // Health check for Railway
  server.app.get('/health', (req, res) => {
      res.status(200).send('OK');
  });

  try {
    const project = await import(projectPath);
    const projectModule = project.default || project;

    if (projectModule.agents && Array.isArray(projectModule.agents)) {
      console.log(`🚀 Starting ${projectModule.agents.length} agent(s)...`);
      
      // Pass the agents array directly as expected by standard ElizaOS server
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

  // Use the port provided by Railway ($PORT)
  const port = parseInt(process.env.PORT || process.env.SERVER_PORT || '3000');
  await server.start(port);

  console.log(`
 Server with custom UI running on port ${port}
`);
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
