import { callInfo, functionName, isFunctionNode, parseCall } from '../analysis/lang.js';
import type { LanguageFamily } from '../lang/languages.js';
import { LANGUAGE_FAMILY } from '../lang/languages.js';
import type { TSNode } from '../lang/parser-pool.js';
import type { FileContext } from '../rules/types.js';
import { isTestPath, type EntryPoint, type Exposure, type FileFacts, type FnFact, type QueryFact, type RouteFact, type StateUnion } from './types.js';

export const AUTH_GUARD = /(?:auth|authenticate|authori[sz]e|isAuthenticated|requireAuth|requireLogin|requireUser|requireRole|requireAdmin|hasRole|isAdmin|verifyToken|verifyJwt|jwt|passport|protect|ensureLogged|ensureAuth|guard|checkAuth|checkToken|checkPermission|login_required)/i;
const PUBLIC_BY_NATURE = /^\/?(?:api\/)?(?:v\d+\/)?(?:login|logout|log-in|sign-?in|sign-?up|register|signup|auth(?:\/|$)|oauth|callback|health(?:z|check)?|ping|status|ready|live|metrics|webhooks?|public|static|favicon|robots|forgot|reset|verify|confirm|docs|openapi|swagger|csrf)/i;
const VALIDATION = /\b(?:validate\w*|validator|schema|zod|joi|yup|celebrate|check\(|body\(|query\(|param\(|assert\w*|parse\(|safeParse|is(?:Valid|Int|Email|UUID)\w*|sanitize\w*|class-validator|@Valid|ModelState|BindJSON|ShouldBind\w*|pydantic|BaseModel)\b/;
const INPUT = /\b(?:req|request|ctx)\.(?:body|query|params)\b|request\.(?:args|form|json|data|GET|POST)\b|@RequestBody|@RequestParam|\[From(?:Body|Query|Route|Form)\]|\$_(?:GET|POST|REQUEST)|c\.(?:Query|Param|BindJSON|PostForm)\(|r\.(?:FormValue|URL\.Query)/;
const OWNER = /\b(?:user_?id|owner_?id|tenant_?id|account_?id|created_?by|org_?id|customer_?id|userId|ownerId)\b/i;

/** `ctrl.getUser`, `views.index`, `a::b(c)` -> the final name. */
export function lastSegment(text: string): string {
  return text.replace(/\(.*$/s, '').trim().split(/[.:>\s]+/).filter(Boolean).pop() ?? '';
}

export function strip(text: string): string {
  return text.replace(/^[`'"]|[`'"]$/g, '');
}

function isStringNode(n: TSNode): boolean {
  return /string|template/.test(n.type) && !n.type.includes('type');
}

function lineOf(n: TSNode): number {
  return n.startPosition.row + 1;
}

function endLine(n: TSNode): number {
  return n.endPosition.row + 1;
}

function allNodes(root: TSNode): TSNode[] {
  const out: TSNode[] = [];
  const stack: TSNode[] = [root];
  while (stack.length > 0) {
    const n = stack.pop()!;
    out.push(n);
    const c = n.children;
    for (let i = c.length - 1; i >= 0; i -= 1) {
      const ch = c[i];
      if (ch && ch.isNamed) stack.push(ch);
    }
  }
  return out;
}

function isAsync(fn: TSNode): boolean {
  return /^(?:export\s+)?(?:default\s+)?async\b/.test(fn.text) || fn.children.some((c) => c && c.type === 'async') || fn.text.startsWith('async ');
}

function functionsOf(ctx: FileContext, nodes: TSNode[]): FnFact[] {
  const out: FnFact[] = [];
  for (const n of nodes) {
    if (!isFunctionNode(n, ctx.family)) continue;
    const calls = new Set<string>();
    const stack: TSNode[] = [n];
    while (stack.length > 0) {
      const x = stack.pop()!;
      const call = parseCall(x, ctx.family);
      if (call?.callee) calls.add(call.callee.replace(/\(.*$/, '').split(/\.|->|::/).pop() ?? call.callee);
      for (const ch of x.children) if (ch && ch.isNamed && !(x !== n && isFunctionNode(ch, ctx.family) && false)) stack.push(ch);
    }
    out.push({ file: ctx.path, name: functionName(n) || '', startLine: lineOf(n), endLine: endLine(n), calls: [...calls], isAsync: isAsync(n) });
  }
  return out;
}

function exposureOf(guards: string[]): Exposure {
  return guards.length > 0 ? 'authenticated' : 'public';
}

function features(text: string, guards: string[], extraAuth = false): Pick<RouteFact, 'hasAuth' | 'hasValidation' | 'usesInput'> {
  return { hasAuth: extraAuth || guards.length > 0, hasValidation: VALIDATION.test(text), usesInput: INPUT.test(text) };
}

function routeFact(ctx: FileContext, line: number, label: string, text: string, guards: string[], group: string, declaredPublic: boolean, extraAuth = false): RouteFact {
  // Login, registration, health checks and webhooks are public by nature; they are not "missing" authentication.
  const route = label.split(' ').slice(1).join(' ');
  return { file: ctx.path, line, label, ...features(text, guards, extraAuth), group, declaredPublic: declaredPublic || PUBLIC_BY_NATURE.test(route) };
}

const HTTP = 'get|post|put|patch|delete|all|head|options';

function jsRoutes(ctx: FileContext, nodes: TSNode[], entry: EntryPoint[], routes: RouteFact[], publicRoutes: string[]): void {
  // app.use(authMiddleware) applies to the routes registered after it on the same receiver (Express semantics).
  const useGuards: Array<{ receiver: string; line: number; guard: string }> = [];
  for (const n of nodes) {
    const call = callInfo(n, 'js', '');
    if (!call) continue;
    const m = new RegExp(`^([\\w$]+)\\.(use|${HTTP})$`).exec(call.callee);
    if (!m) {
      if (/\.on$/.test(call.callee) && /^['"`]connection['"`]$/.test(call.args[0]?.text ?? '')) {
        entry.push({ file: ctx.path, line: call.line, kind: 'websocket', exposure: 'public', guards: [], handler: '' });
      } else if (/\.(?:process|consume|subscribe)$/.test(call.callee) && call.args.length > 0 && /queue|channel|consumer|bull|kafka|amqp|sqs/i.test(call.callee + ctx.source.slice(0, 2000))) {
        entry.push({ file: ctx.path, line: call.line, kind: 'queue', exposure: 'internal', guards: [], handler: '' });
      } else if (/^(?:upload|multer)\.(?:single|array|fields|any)$/.test(call.callee)) {
        entry.push({ file: ctx.path, line: call.line, kind: 'upload', exposure: 'public', guards: [], handler: '' });
      } else if (/\.command$/.test(call.callee) || call.callee === 'yargs' || /^process\.argv/.test(call.callee)) {
        entry.push({ file: ctx.path, line: call.line, kind: 'cli', exposure: 'internal', guards: [], handler: '' });
      }
      continue;
    }
    const [, receiver, verb] = m;
    if (verb === 'use') {
      const guard = call.args.map((a) => a.text).find((t) => AUTH_GUARD.test(t) && !/^['"`]/.test(t));
      if (guard && (call.args.length === 1 || /^['"`]\//.test(call.args[0]!.text))) useGuards.push({ receiver: receiver!, line: call.line, guard });
      continue;
    }
    const pathArg = call.args[0];
    if (!pathArg || !isStringNode(pathArg) || !/^[`'"]\//.test(pathArg.text)) continue;
    const route = strip(pathArg.text);
    const handler = call.args[call.args.length - 1];
    const middle = call.args.slice(1, -1).map((a) => a.text);
    const guards = [...middle.filter((t) => AUTH_GUARD.test(t)), ...useGuards.filter((u) => u.receiver === receiver && u.line < call.line).map((u) => u.guard)];
    // The handler may be inline, a wrapper around an inline function (asyncHandler(async (req, res) => ...)) or a name (ctrl.getUser).
    let inlineFn: TSNode | null = handler && isFunctionNode(handler, 'js') ? handler : null;
    if (!inlineFn && handler?.type === 'call_expression') {
      inlineFn = callInfo(handler, 'js', '')?.args.filter((a) => isFunctionNode(a, 'js')).pop() ?? null;
    }
    const handlerText = inlineFn ? inlineFn.text : (handler?.text ?? '');
    const handlerName = inlineFn ? '' : lastSegment(handler?.text ?? '');
    entry.push({
      file: ctx.path, line: call.line, kind: 'route', method: verb!.toUpperCase(), route, exposure: exposureOf(guards), guards,
      handler: handlerName, ...(inlineFn ? { range: [lineOf(inlineFn), endLine(inlineFn)] as [number, number] } : {}),
    });
    routes.push(routeFact(ctx, call.line, `${verb!.toUpperCase()} ${route}`, handlerText + middle.join(' '), guards, `${ctx.path}#${receiver}`, publicRoutes.includes(route)));
  }

  // NestJS controllers: @Controller + @Get()/@Post() methods, @UseGuards on class or method.
  if (/@Controller\b/.test(ctx.source)) {
    for (const cls of nodes.filter((n) => n.type === 'class_declaration' || n.type === 'abstract_class_declaration')) {
      const holder = cls.parent?.type === 'export_statement' ? cls.parent : cls;
      const classDeco = [...holder.children, ...cls.children].filter((c) => c?.type === 'decorator').map((c) => c!.text).join(' ');
      if (!/@Controller\b/.test(classDeco)) continue;
      const base = /@Controller\(\s*['"`]([^'"`]*)['"`]/.exec(classDeco)?.[1] ?? '';
      const classGuard = /@UseGuards\(/.test(classDeco);
      const body = cls.childForFieldName('body');
      const members = body?.namedChildren ?? [];
      members.forEach((member, i) => {
        if (!member || member.type !== 'method_definition') return;
        const decos: string[] = [];
        for (let j = i - 1; j >= 0 && members[j]?.type === 'decorator'; j -= 1) decos.push(members[j]!.text);
        for (const c of member.children) if (c?.type === 'decorator') decos.push(c.text);
        const dm = new RegExp(`@(${HTTP.replace(/\|/g, '|').replace(/\b(\w)/g, (x) => x.toUpperCase())})\\(\\s*(?:['"\`]([^'"\`]*)['"\`])?`).exec(decos.join(' '));
        if (!dm) return;
        const guarded = classGuard || /@UseGuards\(/.test(decos.join(' ')) || /@(?:Roles|Auth)\(/.test(decos.join(' '));
        const route = `/${base}/${dm[2] ?? ''}`.replace(/\/+/g, '/');
        const guards = guarded ? ['UseGuards'] : [];
        entry.push({ file: ctx.path, line: lineOf(member), kind: 'route', method: dm[1]!.toUpperCase(), route, exposure: exposureOf(guards), guards, handler: functionName(member), range: [lineOf(member), endLine(member)] });
        routes.push(routeFact(ctx, lineOf(member), `${dm[1]!.toUpperCase()} ${route}`, member.text, guards, `${ctx.path}#${cls.childForFieldName('name')?.text ?? ''}`, /@Public\(/.test(decos.join(' ')) || publicRoutes.includes(route)));
      });
    }
  }

  // Next.js route handlers and API routes (by file path).
  const norm = ctx.path.replace(/\\/g, '/');
  const app = /(?:^|\/)app\/(.*)route\.(?:ts|js|mjs|tsx)$/.exec(norm);
  const pages = /(?:^|\/)pages\/(api\/.*)\.(?:ts|js|tsx|mjs)$/.exec(norm);
  if (app || pages) {
    for (const n of nodes) {
      if (!isFunctionNode(n, 'js') || (n.type !== 'function_declaration' && n.type !== 'arrow_function')) continue;
      const name = functionName(n);
      const exported = n.parent?.type === 'export_statement' || n.parent?.parent?.type === 'export_statement' || n.parent?.parent?.parent?.type === 'export_statement';
      const isHandler = app ? exported && /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(name) : exported && /^(?:default|handler)$/.test(name) || n.parent?.type === 'export_statement' && n.parent.text.startsWith('export default');
      if (!isHandler) continue;
      const route = `/${(app?.[1] ?? pages![1]!).replace(/\/$/, '')}`.replace(/\[(\w+)\]/g, ':$1');
      const guards = AUTH_GUARD.test(n.text) ? ['session check'] : [];
      entry.push({ file: ctx.path, line: lineOf(n), kind: 'route', method: app ? name : 'ANY', route, exposure: exposureOf(guards), guards, handler: name, range: [lineOf(n), endLine(n)] });
      routes.push(routeFact(ctx, lineOf(n), `${app ? name : 'ANY'} ${route}`, n.text, guards, `${ctx.path}#next`, publicRoutes.includes(route)));
    }
  }
}

function pythonRoutes(ctx: FileContext, nodes: TSNode[], entry: EntryPoint[], routes: RouteFact[], publicRoutes: string[]): void {
  for (const n of nodes) {
    if (n.type !== 'decorated_definition') continue;
    const fn = n.childForFieldName('definition');
    if (!fn || fn.type !== 'function_definition') continue;
    const decos = n.children.filter((c) => c?.type === 'decorator').map((c) => c!.text);
    const joined = decos.join('\n');
    const m = /@[\w.]+\.(route|get|post|put|patch|delete|api_route|websocket)\(\s*['"]([^'"]+)['"]([^)]*)/.exec(joined);
    if (m) {
      const methods = m[1] === 'route' ? (/methods\s*=\s*\[([^\]]*)\]/.exec(m[3] ?? '')?.[1]?.replace(/['"\s]/g, '').toUpperCase() ?? 'GET') : m[1]!.toUpperCase();
      const params = fn.childForFieldName('parameters')?.text ?? '';
      const guards = [...decos.filter((d) => /login_required|jwt_required|permission_required|require_auth|auth_required|requires_auth|token_required|roles_required|authenticated|user_passes_test/.test(d)), ...(/Depends\([^)]*(?:user|auth|token|verify|current)/i.test(params) ? ['Depends(auth)'] : [])];
      entry.push({ file: ctx.path, line: lineOf(n), kind: m[1] === 'websocket' ? 'websocket' : 'route', method: methods, route: m[2], exposure: exposureOf(guards), guards, handler: functionName(fn), range: [lineOf(fn), endLine(fn)] });
      routes.push(routeFact(ctx, lineOf(n), `${methods} ${m[2]}`, fn.text, guards, `${ctx.path}#routes`, publicRoutes.includes(m[2]!)));
    } else if (/@(?:\w+\.)?(?:task|shared_task|periodic_task)\b/.test(joined)) {
      entry.push({ file: ctx.path, line: lineOf(n), kind: 'queue', exposure: 'internal', guards: [], handler: functionName(fn), range: [lineOf(fn), endLine(fn)] });
    }
  }
  // Django urlpatterns: path('x/', view)
  for (const n of nodes) {
    const call = callInfo(n, 'python', '');
    if (call && /^(?:path|re_path|url)$/.test(call.callee) && call.args[0] && isStringNode(call.args[0]) && call.args[1]) {
      const view = call.args[1].text;
      const guards = AUTH_GUARD.test(view) ? [view] : [];
      entry.push({ file: ctx.path, line: call.line, kind: 'route', method: 'ANY', route: '/' + strip(call.args[0].text), exposure: exposureOf(guards), guards, handler: lastSegment(view) });
    }
    if (call && /^(?:argparse\.ArgumentParser|click\.command|typer\.Typer)$/.test(call.callee)) entry.push({ file: ctx.path, line: call.line, kind: 'cli', exposure: 'internal', guards: [], handler: '' });
  }
}

function annotationsOf(method: TSNode): string {
  const mods = method.children.filter((c) => c && (c.type === 'modifiers' || c.type === 'attribute_list' || c.type === 'annotation')).map((c) => c!.text);
  return mods.join(' ');
}

function enclosingClassText(n: TSNode): string {
  let p = n.parent;
  while (p && !/class_declaration|interface_declaration/.test(p.type)) p = p.parent;
  if (!p) return '';
  return p.children.filter((c) => c && (c.type === 'modifiers' || c.type === 'attribute_list')).map((c) => c!.text).join(' ');
}

function javaRoutes(ctx: FileContext, nodes: TSNode[], entry: EntryPoint[], routes: RouteFact[], publicRoutes: string[]): void {
  for (const n of nodes) {
    if (n.type !== 'method_declaration') continue;
    const ann = annotationsOf(n);
    const cls = enclosingClassText(n);
    const sm = /@(Get|Post|Put|Patch|Delete|Request)Mapping(?:\(([^)]*)\))?/.exec(ann);
    const jax = /@(GET|POST|PUT|DELETE|PATCH)\b/.exec(ann);
    const name = functionName(n);
    const servlet = /^do(Get|Post|Put|Delete)$/.exec(name);
    if (!sm && !jax && !servlet) {
      if (/@(?:KafkaListener|RabbitListener|JmsListener|SqsListener|StreamListener)\b/.test(ann)) entry.push({ file: ctx.path, line: lineOf(n), kind: 'queue', exposure: 'internal', guards: [], handler: name, range: [lineOf(n), endLine(n)] });
      continue;
    }
    const method = sm ? (sm[1] === 'Request' ? (/RequestMethod\.(\w+)/.exec(sm[2] ?? '')?.[1] ?? 'ANY') : sm[1]!.toUpperCase()) : jax ? jax[1]! : servlet![1]!.toUpperCase();
    const route = (/["']([^"']*)["']/.exec(sm?.[2] ?? '')?.[1] ?? /@Path\(\s*["']([^"']*)["']/.exec(ann)?.[1] ?? `/${name}`);
    const guardMatch = /@(PreAuthorize|Secured|RolesAllowed|Authenticated)\b/.exec(ann + ' ' + cls);
    const guards = guardMatch && !/@PermitAll\b/.test(ann) ? [guardMatch[0]] : [];
    entry.push({ file: ctx.path, line: lineOf(n), kind: 'route', method, route, exposure: exposureOf(guards), guards, handler: name, range: [lineOf(n), endLine(n)] });
    routes.push(routeFact(ctx, lineOf(n), `${method} ${route}`, n.text, guards, `${ctx.path}#${cls.slice(0, 20)}`, /@PermitAll\b/.test(ann) || publicRoutes.includes(route), /@PreAuthorize|@Secured|@RolesAllowed/.test(ann + cls)));
  }
}

function csharpRoutes(ctx: FileContext, nodes: TSNode[], entry: EntryPoint[], routes: RouteFact[], publicRoutes: string[]): void {
  for (const n of nodes) {
    if (n.type !== 'method_declaration') continue;
    const ann = n.children.filter((c) => c?.type === 'attribute_list').map((c) => c!.text).join(' ');
    const m = /\[Http(Get|Post|Put|Patch|Delete)(?:\(\s*"([^"]*)")?/.exec(ann);
    if (!m) continue;
    const cls = enclosingClassText(n);
    const anon = /\[AllowAnonymous\]/.test(ann);
    const guards = !anon && /\[Authorize/.test(ann + cls) ? ['Authorize'] : [];
    const route = `/${m[2] ?? functionName(n)}`;
    entry.push({ file: ctx.path, line: lineOf(n), kind: 'route', method: m[1]!.toUpperCase(), route, exposure: exposureOf(guards), guards, handler: functionName(n), range: [lineOf(n), endLine(n)] });
    routes.push(routeFact(ctx, lineOf(n), `${m[1]!.toUpperCase()} ${route}`, n.text, guards, `${ctx.path}#${cls.slice(0, 20)}`, anon || publicRoutes.includes(route), /\[Authorize/.test(ann + cls)));
  }
}

function goRoutes(ctx: FileContext, nodes: TSNode[], entry: EntryPoint[], routes: RouteFact[], publicRoutes: string[]): void {
  for (const n of nodes) {
    const call = callInfo(n, 'go', '');
    if (!call) continue;
    const m = /^(\w+)\.(HandleFunc|Handle|GET|POST|PUT|DELETE|PATCH|Any|Get|Post|Put|Delete|Patch)$/.exec(call.callee);
    if (!m || !call.args[0] || !isStringNode(call.args[0])) continue;
    const route = strip(call.args[0].text);
    if (!route.startsWith('/')) continue;
    const handler = call.args[call.args.length - 1];
    const guards = call.args.slice(1, -1).map((a) => a.text).filter((t) => AUTH_GUARD.test(t));
    const wrapped = AUTH_GUARD.test(handler?.text ?? '') && /\(/.test(handler?.text ?? '') ? [handler!.text.slice(0, 30)] : [];
    const all = [...guards, ...wrapped];
    const method = /^(?:HandleFunc|Handle|Any)$/.test(m[2]!) ? 'ANY' : m[2]!.toUpperCase();
    const inline = handler?.type === 'func_literal';
    entry.push({ file: ctx.path, line: call.line, kind: 'route', method, route, exposure: exposureOf(all), guards: all, handler: inline ? '' : (handler?.text ?? '').replace(/\(.*$/, ''), ...(inline ? { range: [lineOf(handler!), endLine(handler!)] as [number, number] } : {}) });
    routes.push(routeFact(ctx, call.line, `${method} ${route}`, inline ? handler!.text : (handler?.text ?? ''), all, `${ctx.path}#${m[1]}`, publicRoutes.includes(route)));
  }
}

function rustRoutes(ctx: FileContext, nodes: TSNode[], entry: EntryPoint[], routes: RouteFact[], publicRoutes: string[]): void {
  for (const n of nodes) {
    if (n.type !== 'function_item') continue;
    const attrs: string[] = [];
    for (let s = n.previousSibling; s && s.type === 'attribute_item'; s = s.previousSibling) attrs.push(s.text);
    const m = /#\[(get|post|put|patch|delete)\(\s*"([^"]*)"/.exec(attrs.join(' '));
    if (!m) continue;
    const guards = /Authenticated|BearerAuth|Claims|Identity|auth/i.test(n.childForFieldName('parameters')?.text ?? '') ? ['auth extractor'] : [];
    entry.push({ file: ctx.path, line: lineOf(n), kind: 'route', method: m[1]!.toUpperCase(), route: m[2]!, exposure: exposureOf(guards), guards, handler: functionName(n), range: [lineOf(n), endLine(n)] });
    routes.push(routeFact(ctx, lineOf(n), `${m[1]!.toUpperCase()} ${m[2]}`, n.text, guards, `${ctx.path}#actix`, publicRoutes.includes(m[2]!)));
  }
  for (const n of nodes) {
    const call = callInfo(n, 'rust', '');
    if (!call || !/\.route$/.test(call.callee) || !call.args[0] || !isStringNode(call.args[0])) continue;
    const mh = /^(get|post|put|patch|delete)\(\s*([\w:]+)/.exec(call.args[1]?.text ?? '');
    if (!mh) continue;
    const guards = /\.layer\([^)]*(?:auth|Auth|jwt|Jwt)/.test(ctx.source) ? ['layer(auth)'] : [];
    entry.push({ file: ctx.path, line: call.line, kind: 'route', method: mh[1]!.toUpperCase(), route: strip(call.args[0].text), exposure: exposureOf(guards), guards, handler: mh[2]!.split('::').pop()! });
    routes.push(routeFact(ctx, call.line, `${mh[1]!.toUpperCase()} ${strip(call.args[0].text)}`, call.args[1]!.text, guards, `${ctx.path}#axum`, publicRoutes.includes(strip(call.args[0].text))));
  }
}

function phpRoutes(ctx: FileContext, nodes: TSNode[], entry: EntryPoint[], routes: RouteFact[], publicRoutes: string[]): void {
  for (const n of nodes) {
    if (n.type !== 'scoped_call_expression') continue;
    const scope = n.childForFieldName('scope')?.text;
    const name = n.childForFieldName('name')?.text ?? '';
    if (scope !== 'Route' || !/^(?:get|post|put|patch|delete|any|resource)$/.test(name)) continue;
    const call = callInfo(n, 'php', '');
    if (!call || !call.args[0]) continue;
    const route = strip(call.args[0].text);
    const chain = n.parent?.type === 'member_call_expression' ? n.parent.parent?.text ?? n.parent.text : n.text;
    const guards = /middleware\(\s*\[?\s*['"][^'"]*(?:auth|verified|can:)/i.test(chain) ? ['middleware(auth)'] : [];
    entry.push({ file: ctx.path, line: call.line, kind: 'route', method: name.toUpperCase(), route, exposure: exposureOf(guards), guards, handler: call.args[1]?.text ?? '' });
    routes.push(routeFact(ctx, call.line, `${name.toUpperCase()} ${route}`, call.args[1]?.text ?? '', guards, `${ctx.path}#routes`, publicRoutes.includes(route)));
  }
  if (/\$_(?:GET|POST|REQUEST|COOKIE)\b/.test(ctx.source) && !/Route::/.test(ctx.source) && !/^\s*(?:class|namespace)\b/m.test(ctx.source)) {
    entry.push({ file: ctx.path, line: 1, kind: 'script', route: ctx.path.split(/[\\/]/).pop(), exposure: 'public', guards: [], handler: '' });
  }
}

function sqlQueries(ctx: FileContext, nodes: TSNode[], out: QueryFact[]): void {
  for (const n of nodes) {
    if (!isStringNode(n) || n.text.length > 1500) continue;
    const text = n.text;
    const sel = /\bSELECT\b[\s\S]*?\bFROM\s+[`"']?(\w+)/i.exec(text);
    const upd = /\bUPDATE\s+[`"']?(\w+)[`"']?\s+SET\b/i.exec(text);
    const del = /\bDELETE\s+FROM\s+[`"']?(\w+)/i.exec(text);
    const hit = del ? { table: del[1]!, verb: 'delete' as const } : upd ? { table: upd[1]!, verb: 'update' as const } : sel ? { table: sel[1]!, verb: 'select' as const } : null;
    if (!hit) continue;
    const where = /\bWHERE\b([\s\S]*)$/i.exec(text);
    out.push({ file: ctx.path, line: lineOf(n), table: hit.table.toLowerCase(), verb: hit.verb, hasWhere: !!where, hasOwnerFilter: where ? OWNER.test(where[1]!) : false, snippet: text.replace(/\s+/g, ' ').slice(0, 90) });
  }
  // Supabase / Prisma style chains: from('t')...eq('user_id', x) ; prisma.t.findMany({ where: { userId } })
  for (const n of nodes) {
    if (n.type !== 'expression_statement' && n.type !== 'variable_declarator' && n.type !== 'return_statement') continue;
    const t = n.text;
    if (t.length > 800) continue;
    const sb = /\.from\(\s*['"`](\w+)['"`]\s*\)\s*\.(select|update|delete)\b/.exec(t);
    const pr = /\bprisma\.(\w+)\.(findMany|findFirst|findUnique|update|updateMany|delete|deleteMany|count)\b/.exec(t);
    if (!sb && !pr) continue;
    const verb = (sb?.[2] ?? pr![2]!).toLowerCase();
    out.push({
      file: ctx.path, line: lineOf(n), table: (sb?.[1] ?? pr![1]!).toLowerCase(),
      verb: /update/.test(verb) ? 'update' : /delete/.test(verb) ? 'delete' : 'select',
      hasWhere: /\.eq\(|\.match\(|\.filter\(|where\s*:/.test(t), hasOwnerFilter: /\.eq\(\s*['"`](?:user_id|owner_id|tenant_id|account_id)['"`]|\.match\(\{[^}]*(?:user_id|owner)|where\s*:\s*\{[^}]*(?:userId|ownerId|tenantId|user_id|owner_id)/.test(t), snippet: t.replace(/\s+/g, ' ').slice(0, 90),
    });
  }
}

const STATE_UNION = /^\s*(?:export\s+)?type\s+(\w*(?:Status|State|Phase|Stage|Mode)\w*)\s*=\s*((?:\s*\|?\s*['"][\w -]+['"])+)/;

function stateFacts(ctx: FileContext, unions: StateUnion[], assigned: Set<string>): void {
  ctx.lines.forEach((line, i) => {
    const m = STATE_UNION.exec(line);
    if (m) {
      // the union may continue on the following lines
      let text = line;
      for (let j = i + 1; j < Math.min(ctx.lines.length, i + 12) && /^\s*\|/.test(ctx.lines[j]!); j += 1) text += ` ${ctx.lines[j]}`;
      unions.push({ file: ctx.path, line: i + 1, name: m[1]!, members: [...text.matchAll(/['"]([\w -]+)['"]/g)].map((x) => x[1]!) });
    }
  });
  for (const m of ctx.source.matchAll(/\b(?:status|state|phase|stage)\s*(?:[:=]|=>)\s*['"]([\w -]+)['"]/gi)) assigned.add(m[1]!);
  for (const m of ctx.source.matchAll(/\bset(?:Status|State|Phase)\(\s*['"]([\w -]+)['"]/g)) assigned.add(m[1]!);
  for (const m of ctx.source.matchAll(/\b(?:Status|State|Phase)\.(\w+)/g)) assigned.add(m[1]!);
  for (const m of ctx.source.matchAll(/(?:'|")(\w+)(?:'|")\s*(?:as\s+(?:const|\w*Status))/g)) assigned.add(m[1]!);
}

/** Facts one file contributes to the codebase map, conventions and verification. */
export function collectFacts(ctx: FileContext, nodes: TSNode[], publicRoutes: string[] = []): FileFacts {
  const entrypoints: EntryPoint[] = [];
  const routes: RouteFact[] = [];
  const family: LanguageFamily = LANGUAGE_FAMILY[ctx.lang];
  switch (family) {
    case 'js': jsRoutes(ctx, nodes, entrypoints, routes, publicRoutes); break;
    case 'python': pythonRoutes(ctx, nodes, entrypoints, routes, publicRoutes); break;
    case 'java': javaRoutes(ctx, nodes, entrypoints, routes, publicRoutes); break;
    case 'csharp': csharpRoutes(ctx, nodes, entrypoints, routes, publicRoutes); break;
    case 'go': goRoutes(ctx, nodes, entrypoints, routes, publicRoutes); break;
    case 'rust': rustRoutes(ctx, nodes, entrypoints, routes, publicRoutes); break;
    case 'php': phpRoutes(ctx, nodes, entrypoints, routes, publicRoutes); break;
    case 'shell':
    case 'c':
      if (/\$1|\$@|argv\[|int\s+main\s*\(/.test(ctx.source)) entrypoints.push({ file: ctx.path, line: 1, kind: 'cli', exposure: 'internal', guards: [], handler: '' });
      break;
  }
  // Resolve named handlers to their ranges.
  const functions = functionsOf(ctx, nodes);
  for (const e of entrypoints) {
    if (!e.range && e.handler) {
      const fn = functions.find((f) => f.name === lastSegment(e.handler));
      if (fn) e.range = [fn.startLine, fn.endLine];
    }
  }
  const queries: QueryFact[] = [];
  sqlQueries(ctx, nodes, queries);
  const unions: StateUnion[] = [];
  const assigned = new Set<string>();
  stateFacts(ctx, unions, assigned);
  void allNodes;
  return { path: ctx.path, lang: ctx.lang, isTest: isTestPath(ctx.relPath), functions, entrypoints, routes, queries, assignedStates: [...assigned], unions };
}

export { allNodes };
export const OWNER_FILTER = OWNER;
