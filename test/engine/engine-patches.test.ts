// Pins the behaviour of Agent Crew's engine patches against the compiled engine in engine/work.
// Build it first:  node engine/build/prepare.mjs && node engine/build/build.mjs
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const work = process.env.AGENT_CREW_ENGINE_WORK || resolve(__dirname, '../../engine/work');
const dist = resolve(work, 'packages/server/dist/server/server');
const load = (file: string) => import(pathToFileURL(join(dist, file)).href);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mods: Record<string, any>;

beforeAll(async () => {
  mods = {
    admission: await load('session-admission-auth.js'),
    auth: await load('auth.js'),
    env: await load('paseo-env.js'),
    options: await load('agent/providers/claude/options.js'),
    updater: await load('session/daemon/daemon-self-updater.js'),
  };
});

describe('0001: the daemon always requires its password', () => {
  it('refuses every session when no password is configured', async () => {
    const r = await mods.admission.resolveSessionAdmission({
      credential: undefined,
      passwordHash: undefined,
      localCredential: null,
    });
    expect(r).toEqual({ rejection: 'password_required' });
  });

  it('refuses a local-credential login even when the token matches', async () => {
    const r = await mods.admission.resolveSessionAdmission({
      credential: { kind: 'localCredential', token: 'same-token' },
      passwordHash: mods.auth.hashDaemonPassword('a-long-enough-password-for-the-test'),
      localCredential: 'same-token',
    });
    expect(r).toEqual({ rejection: 'incorrect_password' });
  });

  it('admits the right password and refuses a wrong one', async () => {
    const passwordHash = mods.auth.hashDaemonPassword('correct-horse-battery-staple-123');
    const ok = await mods.admission.resolveSessionAdmission({
      credential: { kind: 'password', password: 'correct-horse-battery-staple-123' },
      passwordHash,
      localCredential: null,
    });
    expect(ok.admission?.principalId).toBe('owner');
    const bad = await mods.admission.resolveSessionAdmission({
      credential: { kind: 'password', password: 'wrong' },
      passwordHash,
      localCredential: null,
    });
    expect(bad).toEqual({ rejection: 'incorrect_password' });
  });

  it('refuses bearer tokens and agent MCP requests without a configured password', async () => {
    expect(await mods.auth.isBearerTokenValidAsync({ password: undefined, token: 'anything' })).toBe(false);
    expect(
      await mods.auth.isAgentMcpRequestAuthorized({
        password: undefined,
        capabilityToken: null,
        authorizationHeader: 'Bearer anything',
      }),
    ).toBe(false);
  });

  it('answers protected HTTP routes with 401 when no password is configured', () => {
    const middleware = mods.auth.createRequireBearerMiddleware(undefined);
    let status = 0;
    let nextCalled = false;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json() {
        return this;
      },
    };
    middleware({ method: 'GET', path: '/api/status', header: () => undefined }, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(status).toBe(401);
  });

  it('keeps the daemon password out of agent processes', () => {
    const env = mods.env.createExternalProcessEnv({ PATH: '/usr/bin', PASEO_PASSWORD: 'secret' }, []);
    expect(env.PASEO_PASSWORD).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
  });
});

describe('0002: the Claude provider never skips permissions', () => {
  it('accepts the trustProjectSettings option', () => {
    const parsed = mods.options.ClaudeProviderOptionsSchema.parse({ trustProjectSettings: true });
    expect(parsed.trustProjectSettings).toBe(true);
  });

  it('is compiled without the bypass mode or skip-permissions capability', () => {
    const agentJs = readFileSync(join(dist, 'agent/providers/claude/agent.js'), 'utf8');
    expect(agentJs).not.toMatch(/id:\s*"bypassPermissions"/);
    expect(agentJs).toContain('allowDangerouslySkipPermissions: false');
    expect(agentJs).not.toContain('allowDangerouslySkipPermissions: true');
    expect(agentJs).toContain('CLAUDE_SETTING_SOURCES_UNTRUSTED');
    expect(agentJs).toContain('delete forwarded.extraArgs');
  });
});

describe('0003: no self-update from npm', () => {
  it('refuses to update without touching npm', async () => {
    let npmTouched = false;
    const npm = new Proxy(
      {},
      {
        get() {
          npmTouched = true;
          return async () => ({ exitCode: 0, stdout: '', stderr: '' });
        },
      },
    );
    const updater = new mods.updater.DaemonSelfUpdater({ npm, installOrigin: {} });
    const result = await updater.update({
      daemonVersion: '0.15.4',
      desktopManaged: false,
      onProgress: () => {},
      logger: { error() {}, warn() {} },
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Agent Crew/);
    expect(npmTouched).toBe(false);
  });
});
