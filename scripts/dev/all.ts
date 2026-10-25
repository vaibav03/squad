/**
 * pnpm dev:all: boots the whole dev stack with one command and shuts it down on Ctrl-C.
 *
 *   hub       http://localhost:8788   (apps/hub, real brain/media ports when GEMINI_API_KEY is set, stubs otherwise)
 *   agents    http://localhost:4101-4104 (apps/agent, one per demo student)
 *   web host  http://localhost:5180   (apps/web-host, Vite)
 *
 * Env wiring (values come from .env, the shell, then these dev defaults; secrets are never printed):
 *   INTERNAL_EVENTS_SECRET  dev default "dev-internal-secret" (same value for hub and agents)
 *   HUB_BASE_URL            http://localhost:8788
 *   HUB_CORS_ORIGINS        web host origin(s) added to whatever is already set
 *   VITE_HUB_URL            http://localhost:8788 (read by apps/web-host)
 *   FAKE_LLM                agents use the Gemini client only when GEMINI_API_KEY is set (FAKE_LLM=0), else FakeLlm
 *   CONFIRM_MODE            scripted (agents never block on stdin) unless BOT_URL is set
 *
 * Flags: --no-web, --no-agents. Env: DEV_ALL_HUB_PORT, DEV_ALL_WEB_PORT, DEV_ALL_AGENT_PORT_BASE (default 4101).
 */
import { runStack } from './lib/stack';

runStack({
  label: 'dev',
  args: new Set(process.argv.slice(2)),
  noWebFlag: '--no-web',
  web: ({ baseEnv, webPort, webUrl }) => ({
    name: 'web',
    color: 33,
    cmd: [
      'pnpm',
      '--filter',
      '@squad/web-host',
      'exec',
      'vite',
      '--port',
      String(webPort),
      '--strictPort',
    ],
    env: baseEnv,
    health: `${webUrl}/`,
    url: webUrl,
    port: webPort,
  }),
});
