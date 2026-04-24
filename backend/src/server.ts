import 'dotenv/config';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import type { Request, Response } from 'express';
import {
  getAuthenticatedUser,
  loginUser,
  logoutUser,
  refreshSession,
  registerUser,
} from './auth.js';
import {
  getFindings,
  getFindingsByScanId,
  getLandingContent,
  getPipelineStages,
  getScan,
  getScans,
  landingPipelineLines,
} from './data.ts';
import { validateRepoUrl } from './repo-url.js';
import { runScan } from './scanner.ts';
import { ensureAuthSchema } from './db.js';

const app = express();
const port = Number(process.env.PORT ?? 8787);
const corsOrigin = process.env.CORS_ORIGIN?.trim();

app.use(cors({
  origin: corsOrigin || true,
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

async function requireAuth(req: Request, res: Response): Promise<{ id: number; email: string } | null> {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return user;
}

app.post('/api/auth/register', async (req: Request, res: Response) => {
  await registerUser(req, res);
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  await loginUser(req, res);
});

app.post('/api/auth/refresh', async (req: Request, res: Response) => {
  await refreshSession(req, res);
});

app.post('/api/auth/logout', async (req: Request, res: Response) => {
  await logoutUser(req, res);
});

app.get('/api/auth/me', async (req: Request, res: Response) => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.json({ user });
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.get('/api/scans', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  res.json({ scans: getScans() });
});

app.get('/api/scans/:scanId', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const scanId = Array.isArray(req.params.scanId) ? req.params.scanId[0] : req.params.scanId;
  const scan = getScan(scanId);
  if (!scan) {
    res.status(404).json({ error: 'Scan not found' });
    return;
  }
  res.json({ scan });
});

app.get('/api/scans/:scanId/findings', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const scanId = Array.isArray(req.params.scanId) ? req.params.scanId[0] : req.params.scanId;
  const scan = getScan(scanId);
  if (!scan) {
    res.status(404).json({ error: 'Scan not found' });
    return;
  }

  res.json({ findings: getFindingsByScanId(scanId) });
});

app.get('/api/findings', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  res.json({ findings: getFindings() });
});

app.get('/api/content/landing', (_req: Request, res: Response) => {
  res.json({ content: getLandingContent() });
});

app.get('/api/content/pipeline', (_req: Request, res: Response) => {
  res.json({ stages: getPipelineStages() });
});

app.get('/api/terminal/landing', (_req: Request, res: Response) => {
  res.json({ lines: landingPipelineLines });
});

/** POST /api/scans — Clone repo & run real @athena/core analysis. */
app.post('/api/scans', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;

  const validated = validateRepoUrl(String(req.body?.repoUrl ?? ''));
  if (!validated.ok) {
    res.status(400).json({ error: validated.error });
    return;
  }

  try {
    const result = await runScan(validated.value);
    res.json({
      scan: result.scan,
      findings: result.findings,
      lines: result.terminalLines,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[athena-backend] scan error:', message);
    res.status(500).json({ error: `Scan failed: ${message}` });
  }
});

/**
 * Legacy GET endpoint kept for backwards compatibility.
 * Triggers a real scan via query param.
 */
app.get('/api/terminal/scan', async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;

  const repoUrlParam = Array.isArray(req.query.repoUrl) ? req.query.repoUrl[0] : req.query.repoUrl;
  const validated = validateRepoUrl(String(repoUrlParam ?? ''));
  if (!validated.ok) {
    res.status(400).json({ error: validated.error });
    return;
  }

  try {
    const result = await runScan(validated.value);
    res.json({ lines: result.terminalLines });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: `Scan failed: ${message}` });
  }
});

ensureAuthSchema()
  .then(() => {
    app.listen(port, () => {
      console.log(`[athena-backend] listening on http://localhost:${port}`);
    });
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[athena-backend] failed to initialize auth schema: ${message}`);
    process.exitCode = 1;
  });
