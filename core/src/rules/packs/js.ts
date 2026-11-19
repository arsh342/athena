import type { FamilyPack } from '../types.js';
import { argText, callRule, insecureRandomTest, isStringLiteral, lineRule, sink, assignSink, weakHashTest } from './helpers.js';

const REQ = String.raw`(?:req|request|ctx\.request|ctx)`;

export const jsPack: FamilyPack = {
  family: 'js',
  sources: [
    new RegExp(String.raw`^${REQ}\.(?:body|query|params|headers|cookies|files|file|url|originalUrl|path|hostname|rawBody)\b`),
    /^(?:req|request)\.(?:get|header)\(/,
    /^(?:await\s+)?(?:req|request)\.(?:json|formData|text)\(\)/,
    /^searchParams\.get\(/,
    /^(?:window\.)?location\.(?:search|hash|href|pathname)/,
    /^document\.(?:location|URL|referrer|cookie)/,
    /^process\.argv/,
    /^event\.(?:body|queryStringParameters|pathParameters|headers)/,
    /^\w+\.(?:body|query|params)\.\w+$/,
  ],
  sanitizers: [
    /^(?:escape|escapeHtml|escapeHTML|escapeSql|sanitize\w*|sanitizeHtml|DOMPurify\.sanitize|xss|validator\.(?:escape|isInt|isEmail|isUUID|isAlphanumeric)|encodeURIComponent|encodeURI|path\.basename|shellEscape|shellescape|sqlstring\.escape|mysql\.escape|\w+\.escape|he\.encode|_\.escape|String\.raw)$/,
  ],
  cleanCalls: /^(?:parseInt|parseFloat|Number|Boolean|Math\.\w+|isNaN|isFinite|Date\.now|Array\.isArray|uuid\w*|crypto\.randomUUID)$/,
  sinks: [
    sink('taint.sql-injection', /(?:^|\.)(?:query|execute|\$queryRawUnsafe|\$executeRawUnsafe|queryRawUnsafe|executeRawUnsafe)$|^(?:knex|sequelize|db|database|conn|connection|pool|client)\.(?:raw|query)$|^(?:db|database|sqlite|conn)\.(?:all|get|run|exec|prepare)$/, [0]),
    sink('taint.command-injection', /^(?:(?:require\(['"](?:node:)?child_process['"]\)|child_process|cp|childProcess|shell|shelljs)\.)?(?:exec|execSync)$/, [0]),
    sink('taint.code-injection', /^(?:eval|new Function|Function|vm\.\w+|new vm\.Script)$/, [0]),
    sink('taint.path-traversal', /^(?:fs\.|fsp\.|fs\.promises\.|fse\.)?(?:readFile|readFileSync|writeFile|writeFileSync|createReadStream|createWriteStream|unlink|unlinkSync|readdir|readdirSync|appendFile|appendFileSync|rm|rmSync|rename|copyFile|stat|statSync|access|open|mkdir)$|^(?:res|response|reply)\.(?:sendFile|download)$/, [0], /\.startsWith\(/),
    sink('taint.ssrf', /^(?:fetch|axios|axios\.(?:get|post|put|delete|patch|request)|got|got\.(?:get|post)|request|http\.get|https\.get|http\.request|https\.request|needle\.\w+|superagent\.\w+)$/, [0]),
    sink('taint.xss', /^(?:res|response|reply)(?:\.status\([^)]*\))?\.(?:send|write|end)$|^document\.write(?:ln)?$/, [0], undefined, undefined, /(?:Content-Type|\.type\()[^)]*(?:application\/(?:pdf|json|octet-stream|zip)|text\/(?:plain|markdown|csv)|pdf|json)|res\.attachment|Content-Disposition/i),
    sink('taint.xss', /\.insertAdjacentHTML$/, [1]),
    assignSink('taint.xss', /\.(?:innerHTML|outerHTML)$/),
    sink('taint.open-redirect', /^(?:res|response|reply)\.redirect$/, 'any'),
    sink('taint.deserialization', /^(?:unserialize|serialize\.unserialize|yaml\.load|jsyaml\.load|js-yaml\.load)$/, [0]),
    sink('taint.template-injection', /^(?:ejs\.render|pug\.render|pug\.compile|handlebars\.compile|Handlebars\.compile|nunjucks\.renderString|_\.template|lodash\.template)$/, [0]),
    sink('taint.prototype-pollution', /^(?:_\.merge|_\.mergeWith|_\.defaultsDeep|_\.set|lodash\.merge|\$\.extend|jQuery\.extend|deepmerge|merge)$/, [1]),
  ],
  callRules: [
    callRule('crypto.weak-hash', /^(?:crypto\.)?createHash$/, weakHashTest(/^['"](?:md5|sha1)['"]$/i)),
    callRule('crypto.insecure-random', /^Math\.random$/, insecureRandomTest()),
    callRule('jwt.unverified-or-none', /^(?:jwt|jsonwebtoken)\.(?:decode|verify)$/, (call, ctx) => {
      if (call.callee.endsWith('.decode')) return /verify\(/.test(call.fnText || ctx.source) ? null : 'jwt.decode() reads a token without verifying its signature.';
      return /algorithms\s*:\s*\[[^\]]*['"]none['"]/i.test(call.node.text) ? "jwt.verify() allows the 'none' algorithm." : null;
    }),
    callRule('cookie.insecure-flags', /^(?:res|response|reply)\.cookie$/, (call) => {
      const options = call.args[2];
      // Options passed as a variable or with a spread cannot be judged here: stay silent rather than guess.
      if (options && (options.type !== 'object' || /\.\.\./.test(options.text))) return null;
      return /httpOnly/i.test(call.node.text) && /secure/i.test(call.node.text) ? null : 'Cookie set without httpOnly and secure.';
    }),
    callRule('authz.mass-assignment', /\.(?:create|update|updateOne|updateMany|findOneAndUpdate|findByIdAndUpdate|insertMany|build|upsert|insert)$/, (call) => (call.args.some((a) => /^(?:req|request)\.body$/.test(a.text.trim()) || /^\{\s*\.\.\.(?:req|request)\.body\s*\}$/.test(a.text.trim())) ? 'The whole request body is passed to the database call.' : null)),
    callRule('injection.nosql-object', /\.(?:find|findOne|findOneAndUpdate|updateOne|deleteOne|deleteMany|countDocuments)$/, (call) => (/^(?:req|request)\.(?:body|query)$/.test(argText(call, 0).trim()) ? 'The request object is used as the query.' : null)),
    callRule('error.stack-leak', /^(?:res|response|reply)(?:\.status\([^)]*\))?\.(?:send|json|write|end)$/, (call) => (/\b(?:err|error|e|ex)\.stack\b/.test(call.node.text) ? 'The error stack is sent to the client.' : null)),
  ],
  lineRules: [
    lineRule('injection.nosql-where', /\$where\s*:\s*(?:`[^`]*\$\{|['"][^'"]*['"]\s*\+|[A-Za-z_$][\w$.]*\s*[,}])/),
    lineRule('tls.verification-disabled', /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/),
    lineRule('cors.wildcard-credentials', /origin\s*:\s*(?:['"]\*['"]|true)\b|Access-Control-Allow-Origin['"]\s*,\s*['"]\*/, (line, ctx) => /credentials\s*:\s*true|Allow-Credentials/i.test(ctx.source) || /origin\s*:\s*['"]\*['"]/.test(line) && /credentials/i.test(ctx.source)),
    lineRule('xss.dangerously-set-inner-html', /dangerouslySetInnerHTML\s*=\s*\{\{\s*__html\s*:\s*(?!['"`])(?!DOMPurify|sanitize)/),
    lineRule('regex.redos', /\/(?:[^/\n\\]|\\.)*\((?:[^()\n]|\\.)*[+*]\)(?:[+*]|\{\d+,\})(?:[^/\n\\]|\\.)*\/[gimsuy]*/),
    lineRule('auth.timing-unsafe-compare', /\b\w*(?:token|secret|signature|hmac|apikey|apiKey|password)\w*\s*(?:===|!==|==|!=)\s*(?!['"`]|null|undefined)\w/i),
  ],
  taintedParams: () => [],
};

export { isStringLiteral };
