/** CLI wrapper used by `pnpm demo:serve`: node static-main.ts <port> <distDir> <assetsDir> */
import { createStaticServer } from './lib/static-server';

const [port, distDir, assetsDir] = process.argv.slice(2);
const { server, warm } = createStaticServer({ distDir: distDir!, assetsDir });
const t0 = Date.now();
const n = warm();
server.listen(Number(port), () =>
  console.log(
    `static server on :${port} (precompressed ${n} files in ${Date.now() - t0} ms; dist ${distDir})`,
  ),
);
