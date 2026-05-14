import { parseArgs } from './rpc';
import { log } from './server-io';
import { BackendServer } from './server';

export { BackendServer } from './server';

async function main(): Promise<void> {
  const server = new BackendServer(parseArgs(process.argv.slice(2)));
  await server.start();
}

if (require.main === module) {
  void main().catch((error) => {
    log(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
