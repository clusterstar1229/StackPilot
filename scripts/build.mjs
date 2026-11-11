import { build } from 'esbuild';
await build({ entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron', 'ssh2', 'mysql2', 'pg', 'socks', 'tar', 'yauzl', 'yaml'], sourcemap: true });
await build({ entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'] });
