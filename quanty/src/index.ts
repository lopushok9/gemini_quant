import { logger, type IAgentRuntime, type Project, type ProjectAgent } from '@elizaos/core';
import starterPlugin from './plugin.ts';
import { character } from './character.ts';
import sqlPlugin from '@elizaos/plugin-sql';
import openrouterPlugin from '@elizaos/plugin-openrouter';
import webSearchPlugin from '@elizaos/plugin-web-search';
import { quantyBootstrapPlugin } from './plugins/bootstrap.ts';

const initCharacter = ({ runtime }: { runtime: IAgentRuntime }) => {
  logger.info('Initializing character');
  logger.info({ name: character.name }, 'Name:');
};

export const projectAgent: ProjectAgent = {
  character,
  init: async (runtime: IAgentRuntime) => await initCharacter({ runtime }),
  plugins: [
    sqlPlugin,
    openrouterPlugin,
    webSearchPlugin,
    starterPlugin,
    quantyBootstrapPlugin
  ],
};

const project: Project = {
  agents: [projectAgent],
};

export { character } from './character.ts';

export default project;
