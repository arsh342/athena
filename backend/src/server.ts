import 'dotenv/config';
import { createServer as createHttpServer } from 'node:http';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { attachPtyWebSocket } from './pty-handler.js';
import type { Request, Response } from 'express';
import multer from 'multer';
import { getTerminalSession } from './terminal-session-store.ts';
import {
  completeOAuthCallback,
  getAuthenticatedUser,
  loginUser,
  logoutUser,
  refreshSession,
  registerUser,
  startOAuth,
} from './auth.js';
import {
  getFindings,
  getFindingsByScanId,
  getLandingContent,
  getPipelineStages,
  getScanReport,
  getScan,
  getScans,
  landingPipelineLines,
} from './data.ts';
import { validateRepoUrl } from './repo-url.js';
import { MAX_UPLOAD_BYTES, isZipUploadFileName, runScan, runUploadScan } from './scanner.ts';
import { ensureAuthSchema } from './db.js';
import { renderPdfFromMarkdown } from './report-pdf.ts';

const port = Number(process.env.PORT ?? 8787);
const corsOrigin = process.env.CORS_ORIGIN?.trim();
const upload = multer({
  storage: multer.memoryStorage(),
  preservePath: true,
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 20_000,
  },
});

interface UploadedRequestFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

export interface ServerDeps {
  auth: {
    getAuthenticatedUser: typeof getAuthenticatedUser;
    registerUser: typeof registerUser;
    loginUser: typeof loginUser;
    refreshSession: typeof refreshSession;
    logoutUser: typeof logoutUser;
    startOAuth: typeof startOAuth;
    completeOAuthCallback: typeof completeOAuthCallback;
  };
  data: {
    getScans: typeof getScans;
    getScan: typeof getScan;
    getFindings: typeof getFindings;
    getFindingsByScanId: typeof getFindingsByScanId;
    getScanReport: typeof getScanReport;
    getLandingContent: typeof getLandingContent;
    getPipelineStages: typeof getPipelineStages;
    landingPipelineLines: typeof landingPipelineLines;
  };
  report: {
    renderPdfFromMarkdown: typeof renderPdfFromMarkdown;
  };
  repo: {
    validateRepoUrl: typeof validateRepoUrl;
  };
  scan: {
    runScan: typeof runScan;
    runUploadScan: typeof runUploadScan;
  };
}

export function createApp(overrides: Partial<ServerDeps> = {}) {
  const deps: ServerDeps = {
    auth: {
      getAuthenticatedUser,
      registerUser,
      loginUser,
      refreshSession,
      logoutUser,
      startOAuth,
      completeOAuthCallback,
      ...(overrides.auth ?? {}),
    },
    data: {
      getScans,
      getScan,
      getFindings,
      getFindingsByScanId,
      getScanReport,
      getLandingContent,
      getPipelineStages,
      landingPipelineLines,
      ...(overrides.data ?? {}),
    },
    report: {
      renderPdfFromMarkdown,
      ...(overrides.report ?? {}),
    },
    repo: {
      validateRepoUrl,
      ...(overrides.repo ?? {}),
    },
    scan: {
      runScan,
      runUploadScan,
      ...(overrides.scan ?? {}),
    },
  };

  const app = express();
  app.use(cors({
    origin: corsOrigin || true,
    credentials: true,
  }));
  app.use(express.json());
  app.use(cookieParser());

  async function requireAuth(req: Request, res: Response): Promise<{ id: number; email: string } | null> {
    const user = await deps.auth.getAuthenticatedUser(req);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    }
    return user;
  }

  function sendUploadMiddlewareError(res: Response, error: unknown) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code ?? '')
      : '';

    if (code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'Upload exceeds 200MB limit.' });
      return;
    }

    if (code === 'LIMIT_FILE_COUNT') {
      res.status(400).json({ error: 'Too many files in upload.' });
      return;
    }

    const message = error instanceof Error ? error.message : 'Upload parsing failed.';
    res.status(400).json({ error: message });
  }

  app.post('/api/auth/register', async (req: Request, res: Response) => {
    await deps.auth.registerUser(req, res);
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    await deps.auth.loginUser(req, res);
  });

  app.post('/api/auth/refresh', async (req: Request, res: Response) => {
    await deps.auth.refreshSession(req, res);
  });

  app.post('/api/auth/logout', async (req: Request, res: Response) => {
    await deps.auth.logoutUser(req, res);
  });

  app.get('/api/auth/oauth/:provider/start', async (req: Request, res: Response) => {
    await deps.auth.startOAuth(req, res);
  });

  app.get('/api/auth/oauth/callback', async (req: Request, res: Response) => {
    await deps.auth.completeOAuthCallback(req, res);
  });

  app.get('/api/auth/me', async (req: Request, res: Response) => {
    const user = await deps.auth.getAuthenticatedUser(req);
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
    res.json({ scans: await deps.data.getScans(user.id) });
  });

  app.get('/api/scans/:scanId', async (req: Request, res: Response) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const scanId = Array.isArray(req.params.scanId) ? req.params.scanId[0] : req.params.scanId;
    const scan = await deps.data.getScan(scanId, user.id);
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
    const scan = await deps.data.getScan(scanId, user.id);
    if (!scan) {
      res.status(404).json({ error: 'Scan not found' });
      return;
    }

    res.json({ findings: await deps.data.getFindingsByScanId(scanId, user.id) });
  });

  app.get('/api/scans/:scanId/report', async (req: Request, res: Response) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const scanId = Array.isArray(req.params.scanId) ? req.params.scanId[0] : req.params.scanId;
    const markdown = await deps.data.getScanReport(scanId, user.id);
    if (!markdown) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }
    res.json({ markdown });
  });

  app.get('/api/scans/:scanId/report.pdf', async (req: Request, res: Response) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const scanId = Array.isArray(req.params.scanId) ? req.params.scanId[0] : req.params.scanId;
    const markdown = await deps.data.getScanReport(scanId, user.id);
    if (!markdown) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }
    const pdf = await deps.report.renderPdfFromMarkdown(markdown);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${scanId}.pdf"`);
    res.send(pdf);
  });

  app.get('/api/findings', async (req: Request, res: Response) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    res.json({ findings: await deps.data.getFindings(user.id) });
  });

  app.get('/api/content/landing', (_req: Request, res: Response) => {
    res.json({ content: deps.data.getLandingContent() });
  });

  app.get('/api/content/pipeline', (_req: Request, res: Response) => {
    res.json({ stages: deps.data.getPipelineStages() });
  });

  app.get('/api/terminal/landing', (_req: Request, res: Response) => {
    res.json({ lines: deps.data.landingPipelineLines });
  });

  /** POST /api/scans — Clone repo & run real @athena/core analysis. */
  app.post('/api/scans', async (req: Request, res: Response) => {
    const user = await requireAuth(req, res);
    if (!user) return;

    const validated = deps.repo.validateRepoUrl(String(req.body?.repoUrl ?? ''));
    if (!validated.ok) {
      res.status(400).json({ error: validated.error });
      return;
    }

    try {
      const result = await deps.scan.runScan(validated.value, user.id);
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

  app.post('/api/scans/upload', (req: Request, res: Response) => {
    const handleUpload = () => {
      void (async () => {
        const user = await requireAuth(req, res);
        if (!user) return;

        const mode = String(req.body?.mode ?? '').trim().toLowerCase();
        const rootName = String(req.body?.rootName ?? '').trim();
        const requestFiles = Array.isArray((req as Request & { files?: UploadedRequestFile[] }).files)
          ? (req as Request & { files?: UploadedRequestFile[] }).files ?? []
          : [];
        const files = requestFiles.map((file: UploadedRequestFile) => ({
          originalname: String(file.originalname ?? ''),
          buffer: file.buffer,
          size: Number(file.size ?? 0),
        }));

        if (mode !== 'folder' && mode !== 'zip') {
          res.status(400).json({ error: 'Invalid upload mode.' });
          return;
        }

        if (files.length === 0) {
          res.status(400).json({ error: 'At least one file is required.' });
          return;
        }

        const totalSize = files.reduce((sum: number, file: UploadedRequestFile) => sum + file.size, 0);
        if (totalSize > MAX_UPLOAD_BYTES) {
          res.status(413).json({ error: 'Upload exceeds 200MB limit.' });
          return;
        }

        if (mode === 'zip' && (files.length !== 1 || !isZipUploadFileName(files[0]?.originalname ?? ''))) {
          res.status(400).json({ error: 'ZIP mode requires exactly one .zip file.' });
          return;
        }

        try {
          const sessionId = String(req.headers['x-terminal-session'] ?? '').trim();
          const session = sessionId ? getTerminalSession(sessionId) : null;
          const emit = session && session.userId === user.id
            ? {
                line: (text: string) => session.send({ type: 'line', kind: 'output', text }),
                status: (label: string, progress: number) => session.send({ type: 'status', label, progress }),
              }
            : undefined;

          const result = await deps.scan.runUploadScan({
            mode,
            files,
            rootName,
            userId: user.id,
            emit,
          });

          res.json({
            scan: result.scan,
            findings: result.findings,
            lines: result.terminalLines,
          });
        } catch (scanError) {
          const message = scanError instanceof Error ? scanError.message : String(scanError);
          const statusCode = message.includes('Unsafe zip entry path') ? 400 : 500;
          res.status(statusCode).json({ error: `Upload scan failed: ${message}` });
        }
      })().catch((unhandledError: unknown) => {
        const message = unhandledError instanceof Error ? unhandledError.message : String(unhandledError);
        console.error('[athena-backend] upload route unhandled error:', message);
        if (!res.headersSent) {
          res.status(500).json({ error: `Upload scan failed: ${message}` });
        }
      });
    };

    const hasParsedUpload = Array.isArray((req as Request & { files?: UploadedRequestFile[] }).files)
      || Boolean(req.body?.mode);

    if (hasParsedUpload) {
      handleUpload();
      return;
    }

    upload.array('files[]')(req, res, (error: unknown) => {
      if (error) {
        sendUploadMiddlewareError(res, error);
        return;
      }

      handleUpload();
    });
  });

  /**
   * Legacy GET endpoint kept for backwards compatibility.
   * Triggers a real scan via query param.
   */
  app.get('/api/terminal/scan', async (req: Request, res: Response) => {
    const user = await requireAuth(req, res);
    if (!user) return;

    const repoUrlParam = Array.isArray(req.query.repoUrl) ? req.query.repoUrl[0] : req.query.repoUrl;
    const validated = deps.repo.validateRepoUrl(String(repoUrlParam ?? ''));
    if (!validated.ok) {
      res.status(400).json({ error: validated.error });
      return;
    }

    try {
      const result = await deps.scan.runScan(validated.value, user.id);
      res.json({ lines: result.terminalLines });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: `Scan failed: ${message}` });
    }
  });

  return app;
}

if (process.env.ATHENA_DISABLE_SERVER_BOOTSTRAP !== '1') {
  const app = createApp();
  const httpServer = createHttpServer(app);

  // Attach PTY WebSocket handler at /ws/terminal
  attachPtyWebSocket(httpServer);

  ensureAuthSchema()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[athena-backend] auth schema init failed (DB may be offline): ${message}`);
    })
    .finally(() => {
      httpServer.listen(port, () => {
        console.log(`[athena-backend] listening on http://localhost:${port}`);
        console.log(`[athena-backend] terminal WebSocket at ws://localhost:${port}/ws/terminal`);
      });
    });
}
