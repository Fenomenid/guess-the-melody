const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

mkdirSync('dist-server', { recursive: true });
writeFileSync(join('dist-server', 'package.json'), JSON.stringify({ type: 'commonjs' }));
