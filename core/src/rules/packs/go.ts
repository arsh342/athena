import type { FamilyPack } from '../types.js';
import { callRule, insecureRandomTest, lineRule, sink } from './helpers.js';

export const goPack: FamilyPack = {
  family: 'go',
  sources: [
    /^(?:r|req|request)\.URL\.Query\(\)/, /^(?:r|req|request)\.(?:FormValue|PostFormValue|PostForm|Form|Header\.Get|Cookie|UserAgent|Referer)\b/, /^(?:c|ctx|r|req|request|e|gc)\.(?:Query|Param|PostForm|DefaultQuery|GetHeader|Cookie|FormFile|GetQuery|QueryParam|FormValue|Params)\(/,
    /^os\.Args/, /^os\.Getenv\(/, /^\w+\.Request\.(?:URL|Form|Header|Body)/, /^mux\.Vars\(/,
  ],
  sanitizers: [/^(?:html\.EscapeString|template\.HTMLEscapeString|url\.QueryEscape|filepath\.Base|path\.Base|strconv\.Quote|bluemonday\.\w+\.Sanitize|p\.Sanitize)$/],
  cleanCalls: /^(?:strconv\.Atoi|strconv\.ParseInt|strconv\.ParseUint|strconv\.ParseFloat|strconv\.ParseBool|len|uuid\.Parse|math\.\w+)$/,
  sinks: [
    sink('taint.sql-injection', /\.(?:Query|QueryRow|Exec|Raw|Prepare|NamedQuery|MustExec|NamedExec)$/, [0]),
    sink('taint.sql-injection', /^(?:db|tx|conn|dbx)\.(?:Get|Select)$/, [1]),
    sink('taint.sql-injection', /\.(?:QueryContext|QueryRowContext|ExecContext)$/, [1]),
    sink('taint.command-injection', /^(?:exec\.Command|exec\.CommandContext)$/, [0]),
    sink('taint.command-injection', /^(?:exec\.Command|exec\.CommandContext)$/, 'any', undefined, /["'](?:ba|z|da)?sh["']\s*,\s*["']-c["']/),
    sink('taint.path-traversal', /^(?:os\.(?:Open|OpenFile|ReadFile|WriteFile|Remove|RemoveAll|Create|Mkdir|MkdirAll|Rename|Stat)|ioutil\.(?:ReadFile|WriteFile)|http\.ServeFile|filepath\.Join)$/, [0, 1], /HasPrefix\(/),
    sink('taint.ssrf', /^(?:http\.(?:Get|Post|Head|PostForm|NewRequest|NewRequestWithContext)|(?:\w*[Cc]lient|cli|httpc)\.(?:Get|Post|Head|PostForm|Do))$/, [0]),
    sink('taint.xss', /^(?:fmt\.Fprintf|fmt\.Fprint|fmt\.Fprintln|io\.WriteString)$/, 'any', undefined, /\(\s*(?:w|rw|resp|wr|writer|res)\s*,/),
    sink('taint.xss', /^(?:w|rw|resp|wr|writer|res)\.(?:Write|WriteString)$|^template\.HTML$|^c\.(?:String|HTML|Data)$/, 'any'),
    sink('taint.open-redirect', /^(?:http\.Redirect|c\.Redirect)$/, 'any'),
    sink('taint.deserialization', /^(?:gob\.NewDecoder|yaml\.Unmarshal)$/, [0]),
    sink('taint.template-injection', /^(?:template\.New|text\/template\.Must|template\.Must)$/, [0]),
  ],
  callRules: [
    callRule('crypto.weak-hash', /^(?:md5\.(?:New|Sum)|sha1\.(?:New|Sum))$/, (call, ctx) => (/(?:^|[^a-z])(?:passw(?:or)?d|passwd|credential|secret|token)/i.test(call.fnText) || /(?:^|[^a-z])(?:passw(?:or)?d|passwd|secret|token)/i.test(ctx.lines[call.line - 1] ?? '') ? 'Weak hash used where a password or secret is in play.' : null)),
    callRule('crypto.insecure-random', /^rand\.(?:Int|Intn|Int31|Int63|Read|Uint32|Uint64|Float64|Int31n|Int63n)$/, (call, ctx) => (!/crypto\/rand/.test(ctx.source) ? insecureRandomTest()!(call, ctx) : null)),
    callRule('go.unsafe-pointer', /^unsafe\.Pointer$/),
  ],
  lineRules: [
    lineRule('tls.verification-disabled', /InsecureSkipVerify\s*:\s*true/),
    lineRule('config.debug-enabled', /gin\.SetMode\(gin\.DebugMode\)|\.Debug\s*=\s*true/),
    lineRule('cors.wildcard-credentials', /AllowOrigins\s*:\s*\[\]string\{\s*"\*"\s*\}|Access-Control-Allow-Origin",\s*"\*"/, (_l, ctx) => /AllowCredentials\s*:\s*true|Allow-Credentials/i.test(ctx.source)),
  ],
};
