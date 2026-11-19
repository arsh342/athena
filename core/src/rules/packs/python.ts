import type { FamilyPack } from '../types.js';
import { argText, callRule, insecureRandomTest, lineRule, sink, weakHashTest } from './helpers.js';

export const pythonPack: FamilyPack = {
  family: 'python',
  sources: [
    /^request\.(?:args|form|values|json|data|files|cookies|headers|GET|POST|FILES|COOKIES|META|body|query_params|path_params|query|get_json)\b/,
    /^(?:flask\.)?request\./,
    /^sys\.argv/,
    /^input\(/,
    /^os\.environ\.get\(['"](?:QUERY_STRING|HTTP_)/,
    /^self\.request\.(?:GET|POST|data|query_params)/,
  ],
  sanitizers: [/^(?:escape|html\.escape|markupsafe\.escape|bleach\.clean|shlex\.quote|secure_filename|werkzeug\.utils\.secure_filename|os\.path\.basename|urllib\.parse\.quote|quote|re\.escape|django\.utils\.html\.escape|conditional_escape|ast\.literal_eval)$/],
  cleanCalls: /^(?:int|float|bool|len|str\.isdigit|uuid\.UUID|abs|round|ord)$/,
  sinks: [
    sink('taint.sql-injection', /(?:^|\.)(?:execute|executemany|executescript|raw|extra)$|^(?:text|sqlalchemy\.text)$|^pd\.read_sql(?:_query)?$/, [0]),
    sink('taint.command-injection', /^(?:os\.system|os\.popen|subprocess\.(?:getoutput|getstatusoutput)|commands\.getoutput)$/, [0]),
    // subprocess.run(cmd) with a variable is an argument vector unless shell=True; a literal/concatenated string is a shell line.
    sink('taint.command-injection', /^subprocess\.(?:call|run|Popen|check_output|check_call)$/, [0], undefined, undefined, undefined, true),
    sink('taint.command-injection', /^subprocess\.(?:call|run|Popen|check_output|check_call)$/, 'any', undefined, /shell\s*=\s*True/),
    sink('taint.code-injection', /^(?:eval|exec|compile|__import__|importlib\.import_module)$/, [0]),
    sink('taint.path-traversal', /^(?:open|os\.remove|os\.unlink|os\.rename|os\.listdir|os\.makedirs|shutil\.\w+|send_file|send_from_directory|FileResponse|io\.open|pathlib\.Path|Path|os\.path\.join)$/, [0], /\.startswith\(|is_relative_to\(/),
    sink('taint.ssrf', /^(?:requests\.(?:get|post|put|delete|patch|head|request)|urllib\.request\.urlopen|urlopen|httpx\.(?:get|post|put|delete|request)|aiohttp\.\w+|http\.client\.\w+|urllib3\.\w+)$/, [0]),
    sink('taint.xss', /^(?:HttpResponse|Markup|mark_safe|django\.utils\.safestring\.mark_safe|flask\.Markup|make_response|Response)$/, [0], undefined, undefined, undefined, undefined, /(?:mimetype|content_type)\s*=\s*['"](?:application\/(?:json|pdf|octet-stream)|text\/plain)/),
    sink('taint.open-redirect', /^(?:redirect|HttpResponseRedirect|RedirectResponse|flask\.redirect)$/, [0]),
    sink('taint.deserialization', /^(?:pickle\.loads?|cPickle\.loads?|marshal\.loads?|shelve\.open|jsonpickle\.decode|dill\.loads?|yaml\.(?:load|unsafe_load)|yaml\.load_all)$/, [0]),
    sink('taint.template-injection', /^(?:render_template_string|Template|jinja2\.Template|Environment\.from_string|string\.Template)$/, [0]),
    sink('taint.code-injection', /^(?:flask\.render_template_string)$/, [0]),
  ],
  callRules: [
    callRule('crypto.weak-hash', /^hashlib\.(?:md5|sha1)$/, (call, ctx) => (/(?:^|[^a-z])(?:passw(?:or)?d|passwd|credential|secret|token)/i.test(call.fnText) || /(?:^|[^a-z])(?:passw(?:or)?d|passwd|secret|token)/i.test(ctx.lines[call.line - 1] ?? '') ? 'Weak hash used where a password or secret is in play.' : null)),
    callRule('crypto.weak-hash', /^hashlib\.new$/, weakHashTest(/^['"](?:md5|sha1)['"]$/i)),
    callRule('crypto.insecure-random', /^random\.(?:random|randint|choice|choices|randrange|getrandbits|sample)$/, insecureRandomTest()),
    callRule('tls.verification-disabled', /^requests\.\w+$|^(?:httpx|session|s)\.\w+$/, (call) => (/verify\s*=\s*False/.test(call.node.text) ? 'verify=False disables certificate checks.' : null)),
    callRule('tls.verification-disabled', /^ssl\._create_unverified_context$/),
    callRule('config.debug-enabled', /^(?:app|application)\.run$/, (call) => (/debug\s*=\s*True/.test(call.node.text) ? 'Flask debug mode is on.' : null)),
    callRule('taint.deserialization', /^yaml\.load$/, (call) => (/SafeLoader|safe_load|CSafeLoader/.test(call.node.text) ? null : 'yaml.load() without a safe loader can construct arbitrary objects.')),
    callRule('config.insecure-temp-file', /^tempfile\.mktemp$|^os\.tempnam$/),
    callRule('jwt.unverified-or-none', /^jwt\.decode$/, (call) => (/verify_signature['"]?\s*[:=]\s*False|verify\s*=\s*False|algorithms\s*=\s*\[[^\]]*['"]none['"]/i.test(call.node.text) ? 'The JWT signature is not verified.' : null)),
    callRule('cookie.insecure-flags', /\.set_cookie$/, (call) => (/httponly\s*=\s*True/i.test(call.node.text) && /secure\s*=\s*True/i.test(call.node.text) ? null : 'Cookie set without httponly and secure.')),
    callRule('authz.mass-assignment', /\.(?:create|update|update_or_create|bulk_create)$|^\w+$/, (call) => (/^(?:create|update)$/.test(call.callee.split('.').pop() ?? '') && call.args.some((a) => /^\*\*(?:request\.(?:data|POST|json|form)|request\.get_json\(\))$/.test(a.text.trim()) || /^(?:request\.(?:data|json))$/.test(a.text.trim())) ? 'The whole request payload is passed to the database call.' : null)),
    callRule('error.stack-leak', /^(?:jsonify|HttpResponse|Response|JsonResponse)$/, (call) => (/traceback\.format_exc\(\)|str\(e(?:xc|rr)?\)/.test(call.node.text) ? 'Exception details are returned to the client.' : null)),
  ],
  lineRules: [
    lineRule('config.debug-enabled', /^\s*DEBUG\s*=\s*True\b/),
    lineRule('auth.timing-unsafe-compare', /\b\w*(?:token|secret|signature|hmac|api_?key|password)\w*\s*(?:==|!=)\s*(?!['"]|None)\w/i),
    lineRule('regex.redos', /re\.(?:compile|match|search|fullmatch)\(\s*r?['"][^'"]*\((?:[^()'"]|\\.)*[+*]\)(?:[+*]|\{\d+,\})/),
  ],
  taintedParams: (fn) => {
    // FastAPI/Flask-style route handlers: every parameter of a decorated route function is request data.
    const parent = fn.parent;
    if (parent?.type !== 'decorated_definition') return [];
    const decorators = parent.children.filter((c) => c?.type === 'decorator').map((c) => c!.text).join(' ');
    if (!/@(?:\w+\.)?(?:get|post|put|delete|patch|route|api_view|websocket)\b/.test(decorators)) return [];
    const params = fn.childForFieldName('parameters');
    if (!params) return [];
    const out: number[] = [];
    params.namedChildren.forEach((p, i) => {
      if (p && !/Depends\(|Request\b|Response\b|BackgroundTasks|Session\b/.test(p.text) && !/^(?:self|cls)$/.test(p.text)) out.push(i);
    });
    return out;
  },
};

void argText;
