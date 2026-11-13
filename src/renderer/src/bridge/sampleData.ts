// Sample crew for phase 1. "design" is exactly the six agents in design/robot-crew-1a.svg; "full" adds hosts,
// a pending approval, a usage-limit error, a finished agent on Windows and a paused agent.
import type { DiffLine, PendingApproval, PlanItem, SessionView, Status } from '@shared/types';

export type Scenario = 'full' | 'design';

export type Step =
  | { kind: 'think'; ms: number }
  | {
      kind: 'tool';
      tool: string;
      target: string;
      ms: number;
      detail: string;
      state?: 'ok' | 'error';
      diff?: DiffLine[];
      output?: string;
    }
  | { kind: 'say'; text: string }
  | { kind: 'plan'; items: PlanItem[] }
  /** Ends the script with this status instead of Done. */
  | { kind: 'end'; status: Status };

const MODEL = 'claude-opus-5-5';
const plan = (...items: [string, PlanItem['state']][]): PlanItem[] => items.map(([text, state]) => ({ text, state }));
const diff = (lines: string): DiffLine[] =>
  lines
    .trim()
    .split('\n')
    .map((line) => {
      if (line.startsWith('@@')) return { kind: 'hunk', text: line };
      if (line.startsWith('+')) return { kind: 'add', text: line.slice(1) };
      if (line.startsWith('-')) return { kind: 'del', text: line.slice(1) };
      return { kind: 'ctx', text: line.replace(/^ /, '') };
    });

// ---------- the six agents from the design ----------

function atlas(): SessionView {
  return {
    id: 's-atlas',
    robotId: 'atlas',
    task: 'Refactor auth middleware',
    host: { name: 'this computer', kind: 'local' },
    repo: 'api-server',
    branch: 'feat/auth-v2',
    status: 'speaking',
    model: MODEL,
    items: [
      {
        kind: 'user',
        id: 'atlas-u1',
        text: 'Split the auth middleware so session and token checks are separate.\nKeep the public API the same.',
      },
      {
        kind: 'plan',
        id: 'atlas-plan',
        items: plan(
          ['Map current middleware call sites', 'done'],
          ['Extract session check', 'done'],
          ['Extract token check', 'active'],
          ['Update 14 route imports', 'pending'],
          ['Run test suite', 'pending'],
        ),
      },
      { kind: 'tool', id: 'atlas-t1', tool: 'Read', target: 'src/middleware/auth.ts', detail: '312 lines', state: 'ok' },
      {
        kind: 'tool',
        id: 'atlas-t2',
        tool: 'Edit',
        target: 'src/middleware/session.ts',
        detail: '+86 −0',
        state: 'ok',
        diff: diff(`
@@ -0,0 +1,86 @@
+import type { NextFunction, Request, Response } from 'express';
+import { readSession } from '../auth/session-store';
+
+export async function requireSession(req: Request, res: Response, next: NextFunction) {
+  const session = await readSession(req.cookies['sid']);
+  if (!session) return res.status(401).json({ error: 'unauthenticated' });
+  req.session = session;
+  next();
+}
 … 77 more lines`),
      },
      {
        kind: 'tool',
        id: 'atlas-t3',
        tool: 'Edit',
        target: 'src/middleware/auth.ts',
        detail: '+12 −94',
        state: 'ok',
        diff: diff(`
@@ -1,9 +1,4 @@
-import { readSession } from '../auth/session-store';
-import { verifyToken } from '../auth/tokens';
+import { requireSession } from './session';
+import { requireToken } from './token';
@@ -41,94 +36,12 @@
-export async function auth(req: Request, res: Response, next: NextFunction) {
-  const session = await readSession(req.cookies['sid']);
+export const auth = [requireSession, requireToken];`),
      },
      {
        kind: 'agent',
        id: 'atlas-a1',
        text: 'Session checks now live in their own module. I am pulling token validation out next. It has two callers in the webhook router that bypass the main chain, so I am keeping a shim there until the routes are updated.',
      },
    ],
  };
}

function vega(): SessionView {
  const pendingApproval: PendingApproval = {
    id: 'vega-p1',
    tool: 'Bash',
    command: 'DATABASE_URL="$STAGING_DATABASE_URL" npx prisma migrate deploy --schema prisma/schema.prisma',
    reason: 'Auto mode held this back: it changes the shared staging database.',
    cwd: '~/.agent-crew/worktrees/billing-service/vega',
  };
  return {
    id: 's-vega',
    robotId: 'vega',
    task: 'Migrate billing tables to the new schema',
    host: { name: 'this computer', kind: 'local' },
    repo: 'billing-service',
    branch: 'feat/billing-schema-v2',
    status: 'needs-approval',
    model: MODEL,
    pendingApproval,
    items: [
      { kind: 'user', id: 'vega-u1', text: 'Move the billing tables to the new schema and run the migration on staging.' },
      {
        kind: 'plan',
        id: 'vega-plan',
        items: plan(
          ['Read the current billing schema', 'done'],
          ['Write the v2 migration', 'done'],
          ['Run it on staging', 'active'],
          ['Backfill and check row counts', 'pending'],
        ),
      },
      { kind: 'tool', id: 'vega-t1', tool: 'Read', target: 'prisma/schema.prisma', detail: '214 lines', state: 'ok' },
      {
        kind: 'tool',
        id: 'vega-t2',
        tool: 'Edit',
        target: 'prisma/schema.prisma',
        detail: '+41 −18',
        state: 'ok',
        diff: diff(`
@@ -88,12 +88,19 @@ model Invoice {
-  amount      Int
-  currency    String
+  amountMinor Int
+  currency    Currency @default(USD)
+  lineItems   InvoiceLine[]`),
      },
      {
        kind: 'tool',
        id: 'vega-t3',
        tool: 'Write',
        target: 'prisma/migrations/20261113_billing_v2/migration.sql',
        detail: '+63 −0',
        state: 'ok',
        diff: diff(`
@@ -0,0 +1,63 @@
+ALTER TABLE "Invoice" RENAME COLUMN "amount" TO "amountMinor";
+CREATE TYPE "Currency" AS ENUM ('USD', 'EUR', 'GBP');
 … 61 more lines`),
      },
      {
        kind: 'agent',
        id: 'vega-a1',
        text: 'The migration is ready. Running it changes the shared staging database, so I am asking before I do.',
      },
    ],
  };
}

function orin(scenario: Scenario): SessionView {
  return {
    id: 's-orin',
    robotId: 'orin',
    task: 'E2E tests for checkout',
    host: scenario === 'full' ? { name: 'devbox', kind: 'linux' } : { name: 'this computer', kind: 'local' },
    repo: 'web-shop',
    branch: 'test/checkout-e2e',
    status: 'thinking',
    model: MODEL,
    items: [
      {
        kind: 'user',
        id: 'orin-u1',
        text: 'Write end-to-end tests for the checkout flow with Playwright. Cover guest checkout and saved cards.',
      },
      {
        kind: 'plan',
        id: 'orin-plan',
        items: plan(
          ['Find checkout pages and test ids', 'done'],
          ['Write guest checkout spec', 'done'],
          ['Write saved-card spec', 'active'],
          ['Run the suite headless', 'pending'],
        ),
      },
      { kind: 'tool', id: 'orin-t1', tool: 'Grep', target: 'data-testid  src/checkout', detail: '38 matches', state: 'ok' },
      {
        kind: 'tool',
        id: 'orin-t2',
        tool: 'Write',
        target: 'e2e/checkout-guest.spec.ts',
        detail: '+118 −0',
        state: 'ok',
        diff: diff(`
@@ -0,0 +1,118 @@
+import { expect, test } from '@playwright/test';
+
+test('guest can check out with a card', async ({ page }) => {
+  await page.goto('/cart');
+  await page.getByTestId('checkout-guest').click();
 … 113 more lines`),
      },
      {
        kind: 'tool',
        id: 'orin-t3',
        tool: 'Bash',
        target: 'npx playwright test e2e/checkout-guest.spec.ts',
        detail: 'exit 0',
        state: 'ok',
        output: 'Running 6 tests using 3 workers\n\n  6 passed (14.2s)',
      },
      {
        kind: 'agent',
        id: 'orin-a1',
        text: 'Guest checkout passes in all three browsers. The saved-card spec needs a seeded test user, so I am adding a fixture first.',
      },
    ],
  };
}

function nova(): SessionView {
  return {
    id: 's-nova',
    robotId: 'nova',
    task: 'Fix flaky CI on main',
    host: { name: 'this computer', kind: 'local' },
    repo: 'platform',
    branch: 'fix/flaky-ci',
    status: 'stuck',
    model: MODEL,
    items: [
      { kind: 'user', id: 'nova-u1', text: 'CI on main keeps failing in the integration job. Find out why and fix it.' },
      {
        kind: 'tool',
        id: 'nova-t1',
        tool: 'Bash',
        target: 'gh run view 8812 --log-failed',
        detail: 'exit 0',
        state: 'ok',
        output:
          'integration  Run tests  error: connect ECONNREFUSED 127.0.0.1:5432\nintegration  Run tests  12 failed, 214 passed',
      },
      { kind: 'tool', id: 'nova-t2', tool: 'Read', target: '.github/workflows/ci.yml', detail: '96 lines', state: 'ok' },
      {
        kind: 'agent',
        id: 'nova-a1',
        text: 'The integration job races the database container: the tests start before Postgres accepts connections. I am adding a health-check wait.',
      },
      {
        kind: 'error',
        id: 'nova-e1',
        title: 'Usage limit reached',
        detail: 'Your Pro plan limit resets at 17:00. Nova will wait until then, or you can try again now.',
        retryable: true,
      },
    ],
  };
}

function kit(scenario: Scenario): SessionView {
  return {
    id: 's-kit',
    robotId: 'kit',
    task: 'API reference docs',
    host: scenario === 'full' ? { name: 'winbox', kind: 'windows' } : { name: 'this computer', kind: 'local' },
    repo: 'docs-site',
    branch: 'docs/api-reference',
    status: 'done',
    model: MODEL,
    items: [
      { kind: 'user', id: 'kit-u1', text: 'Generate the API reference from openapi.yaml and add it to the docs site.' },
      {
        kind: 'plan',
        id: 'kit-plan',
        items: plan(
          ['Read the OpenAPI spec', 'done'],
          ['Generate endpoint pages', 'done'],
          ['Add the API section to navigation', 'done'],
          ['Build the site', 'done'],
        ),
      },
      { kind: 'tool', id: 'kit-t1', tool: 'Read', target: 'openapi.yaml', detail: '1,204 lines', state: 'ok' },
      {
        kind: 'tool',
        id: 'kit-t2',
        tool: 'Write',
        target: 'docs\\api\\index.md',
        detail: '+412 −0',
        state: 'ok',
        diff: diff(`
@@ -0,0 +1,412 @@
+# API reference
+
+All endpoints take and return JSON. Authenticate with a bearer token.
 … 409 more lines`),
      },
      {
        kind: 'tool',
        id: 'kit-t3',
        tool: 'Bash',
        target: 'npm run docs:build',
        detail: 'exit 0',
        state: 'ok',
        output: '> docs-site@2.3.0 docs:build\n> astro build\n\n 412 page(s) built in 9.81s\n Complete!',
      },
      {
        kind: 'agent',
        id: 'kit-a1',
        text: 'The API reference is in: 37 endpoints across 6 pages, linked from the sidebar under API. The site builds cleanly. I have not committed anything yet.',
      },
    ],
  };
}

function sable(): SessionView {
  return {
    id: 's-sable',
    robotId: 'sable',
    task: null,
    host: { name: 'this computer', kind: 'local' },
    status: 'sleeping',
    model: MODEL,
    items: [],
  };
}

function juno(): SessionView {
  return {
    id: 's-juno',
    robotId: 'juno',
    task: 'Fix the crash on login',
    host: { name: 'this computer', kind: 'local' },
    repo: 'mobile-app',
    branch: 'fix/login-crash',
    status: 'paused',
    pausedAt: '22:14',
    model: MODEL,
    items: [
      { kind: 'user', id: 'juno-u1', text: 'The app crashes right after login on Android 15. Find the cause.' },
      {
        kind: 'plan',
        id: 'juno-plan',
        items: plan(
          ['Reproduce from the crash log', 'done'],
          ['Find where the session token is read', 'active'],
          ['Patch it and add a test', 'pending'],
        ),
      },
      { kind: 'tool', id: 'juno-t1', tool: 'Read', target: 'logs/crash-2026-11-12.txt', detail: '88 lines', state: 'ok' },
      { kind: 'tool', id: 'juno-t2', tool: 'Grep', target: 'sessionToken  src', detail: '14 matches', state: 'ok' },
      {
        kind: 'agent',
        id: 'juno-a1',
        text: 'The crash comes from reading `sessionToken` before the login promise resolves. I was about to patch `AuthProvider`.',
      },
    ],
  };
}

export function sampleSessions(scenario: Scenario): SessionView[] {
  const crew = [atlas(), vega(), orin(scenario), nova(), kit(scenario), sable()];
  return scenario === 'full' ? [...crew, juno()] : crew;
}

// ---------- scripted behaviour ----------

export function replyScript(): Step[] {
  return [
    { kind: 'think', ms: 800 },
    { kind: 'say', text: 'Got it. I will fold that into what I am doing and tell you when it is done.' },
  ];
}

export function wakeScript(task: string): Step[] {
  return [
    { kind: 'plan', items: plan(['Understand the task', 'active'], ['Make the change', 'pending'], ['Check the result', 'pending']) },
    { kind: 'think', ms: 900 },
    { kind: 'tool', tool: 'Glob', target: '**/*', ms: 900, detail: '214 files' },
    { kind: 'plan', items: plan(['Understand the task', 'done'], ['Make the change', 'active'], ['Check the result', 'pending']) },
    {
      kind: 'say',
      text: `I have had a look around the repo. Starting on "${task.length > 60 ? `${task.slice(0, 57)}…` : task}" now; I will check in when I have something to show.`,
    },
  ];
}

export function allowedScript(robotId: string, command: string): Step[] {
  if (robotId === 'vega') {
    return [
      {
        kind: 'tool',
        tool: 'Bash',
        target: command,
        ms: 1800,
        detail: 'exit 0',
        output: '3 migrations found in prisma/migrations\nApplying migration `20261113_billing_v2`\nAll migrations have been successfully applied.',
      },
      {
        kind: 'plan',
        items: plan(
          ['Read the current billing schema', 'done'],
          ['Write the v2 migration', 'done'],
          ['Run it on staging', 'done'],
          ['Backfill and check row counts', 'active'],
        ),
      },
      { kind: 'tool', tool: 'Bash', target: 'npm run billing:backfill -- --env staging', ms: 1400, detail: 'exit 0', output: 'Backfilled 12,408 invoices in 3.1s' },
      {
        kind: 'plan',
        items: plan(
          ['Read the current billing schema', 'done'],
          ['Write the v2 migration', 'done'],
          ['Run it on staging', 'done'],
          ['Backfill and check row counts', 'done'],
        ),
      },
      { kind: 'say', text: 'Migration applied on staging and 12,408 invoices backfilled. Row counts match production. Nothing is committed yet.' },
    ];
  }
  return [
    { kind: 'tool', tool: 'Bash', target: command, ms: 1500, detail: 'exit 0' },
    { kind: 'say', text: 'Done. That ran cleanly; carrying on.' },
  ];
}

export function deniedScript(): Step[] {
  return [
    { kind: 'think', ms: 600 },
    {
      kind: 'say',
      text: 'Okay, I will not run it. The migration file is ready in prisma/migrations if you want to run it yourself, and I will stop here.',
    },
  ];
}

export function resumeScript(robotId: string): Step[] {
  if (robotId === 'juno') {
    return [
      { kind: 'think', ms: 900 },
      {
        kind: 'tool',
        tool: 'Edit',
        target: 'src/auth/AuthProvider.tsx',
        ms: 1100,
        detail: '+9 −3',
        diff: diff(`
@@ -42,7 +42,13 @@ export function AuthProvider({ children }: Props) {
-  const token = session.sessionToken;
+  const token = session?.sessionToken;
+  if (!token) return <Splash />;`),
      },
      {
        kind: 'plan',
        items: plan(
          ['Reproduce from the crash log', 'done'],
          ['Find where the session token is read', 'done'],
          ['Patch it and add a test', 'active'],
        ),
      },
      { kind: 'say', text: 'Picked up where I left off: `AuthProvider` now waits for the session before reading the token. Adding a test next.' },
    ];
  }
  return [
    { kind: 'think', ms: 800 },
    { kind: 'say', text: 'Picking up where I left off.' },
  ];
}

export function retryScript(robotId: string): Step[] {
  if (robotId === 'nova') {
    return [
      { kind: 'think', ms: 900 },
      {
        kind: 'tool',
        tool: 'Edit',
        target: '.github/workflows/ci.yml',
        ms: 1000,
        detail: '+7 −1',
        diff: diff(`
@@ -31,6 +31,12 @@ jobs:
       postgres:
         image: postgres:16
+        options: >-
+          --health-cmd "pg_isready -U postgres"
+          --health-interval 2s
+          --health-retries 15`),
      },
      { kind: 'say', text: 'The integration job now waits for Postgres to be healthy before the tests start. I will push a branch so CI can confirm.' },
    ];
  }
  return [
    { kind: 'think', ms: 800 },
    { kind: 'say', text: 'Trying again.' },
  ];
}

export function stuckReplyScript(): Step[] {
  return [
    { kind: 'think', ms: 600 },
    { kind: 'say', text: 'I can not continue until the usage limit resets, but I have noted that for when I pick back up.' },
    { kind: 'end', status: 'stuck' },
  ];
}
