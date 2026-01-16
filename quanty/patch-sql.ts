#!/usr/bin/env bun
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const PLUGIN_SQL_PATH = join(import.meta.dir, './node_modules/@elizaos/plugin-sql/dist/node/index.node.js');

const PATCHES = [
    {
        name: 'Skip schema creation if it fails (workaround for PGlite)',
        search: 'async ensureSchema() {\n    await this.db.execute(sql`CREATE SCHEMA IF NOT EXISTS migrations`);\n  }',
        replace: 'async ensureSchema() {\n    try {\n      await this.db.execute(sql`CREATE SCHEMA IF NOT EXISTS migrations`);\n    } catch (e) {\n      // PGlite compatibility: ignore schema creation errors\n    }\n  }',
    },
    {
        name: 'Skip migrations schema prefix (workaround for PGlite)',
        search: 'migrations._migrations',
        replace: '_migrations',
    },
];

function applyPatches() {
    if (!existsSync(PLUGIN_SQL_PATH)) {
        console.log('跳过: @elizaos/plugin-sql not installed');
        return;
    }

    let content = readFileSync(PLUGIN_SQL_PATH, 'utf-8');
    let patchesApplied = 0;

    for (const patch of PATCHES) {
        const searchRegex = new RegExp(patch.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

        if (content.includes(patch.replace) && !content.includes(patch.search)) {
            console.log(`✅ ${patch.name} (already applied)`);
            continue;
        }

        if (!content.includes(patch.search)) {
            console.log(`⚠️  ${patch.name} (pattern not found)`);
            continue;
        }

        content = content.replace(searchRegex, patch.replace);
        patchesApplied++;
        console.log(`🔧 ${patch.name} (applied)`);
    }

    if (patchesApplied > 0) {
        writeFileSync(PLUGIN_SQL_PATH, content);
        console.log(`\n✅ Applied ${patchesApplied} patch(es) to @elizaos/plugin-sql`);
    }
}

applyPatches();
