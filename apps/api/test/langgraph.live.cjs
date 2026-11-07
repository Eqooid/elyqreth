// Explicit optional tier: the existing harness owns PostgreSQL; caller starts the disposable local provider.
const {spawnSync}=require('node:child_process');
const run=spawnSync(process.execPath,['--test','test/database.integration.cjs'],{stdio:'inherit',env:{...process.env,ELYQRETH_LANGGRAPH_LIVE:'true'}});
process.exitCode=run.status??1;
