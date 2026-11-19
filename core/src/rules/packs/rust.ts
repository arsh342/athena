import type { FamilyPack } from '../types.js';
import { callRule, insecureRandomTest, lineRule, sink } from './helpers.js';

export const rustPack: FamilyPack = {
  family: 'rust',
  sources: [/^std::env::args\(\)/, /^env::args\(\)/, /^std::env::var\(/, /^env::var\(/, /^\w+\.(?:query_string|match_info|headers|cookie|param)\(/, /^req\.(?:query|param|headers)\b/],
  sanitizers: [/^(?:html_escape::encode_\w+|ammonia::clean|urlencoding::encode|Path::new\(.*\)\.file_name|shlex::quote|shell_escape::\w+)$/],
  cleanCalls: /^(?:parse::<\w+>|len|is_empty|u\d+::from_str|i\d+::from_str|usize::from_str)$/,
  sinks: [
    sink('taint.sql-injection', /^(?:sqlx::query|sqlx::query_as|sqlx::query_scalar|sqlx::raw_sql)$|\.(?:execute|query|query_one|query_opt|query_raw|batch_execute|prepare|simple_query)$|^diesel::sql_query$/, [0]),
    sink('taint.command-injection', /\.(?:arg|args)$/, [0], undefined, /Command::new\(\s*["'](?:ba|z|da)?sh["']\s*\)/),
    sink('taint.command-injection', /^(?:Command::new|std::process::Command::new)$/, [0]),
    sink('taint.path-traversal', /^(?:(?:std::)?fs::(?:read|read_to_string|write|remove_file|remove_dir_all|create_dir_all|copy|rename|File::open|File::create)|File::open|File::create|OpenOptions::new|NamedFile::open|Path::new|PathBuf::from)$/, [0, 1], /starts_with\(/),
    sink('taint.ssrf', /^(?:reqwest::(?:get|blocking::get)|(?:client|http_client|self\.client|reqwest_client)\.(?:get|post|put|delete|head|request))$|^ureq::(?:get|post)$|^surf::(?:get|post)$/, [0]),
    sink('taint.xss', /^(?:Html|axum::response::Html)$/, [0]),
    sink('taint.open-redirect', /^(?:Redirect::to|Redirect::temporary|Redirect::permanent|HttpResponse::Found\(\)\.append_header)$/, [0]),
    sink('taint.deserialization', /^(?:bincode::deserialize|serde_yaml::from_str|rmp_serde::from_slice)$/, [0]),
  ],
  callRules: [
    callRule('crypto.weak-hash', /^(?:Md5|Sha1)::(?:new|digest)$|^md5::compute$/, (call, ctx) => (/(?:^|[^a-z])(?:passw(?:or)?d|passwd|credential|secret|token)/i.test(call.fnText) || /(?:^|[^a-z])(?:passw(?:or)?d|passwd|secret|token)/i.test(ctx.lines[call.line - 1] ?? '') ? 'Weak hash used where a password or secret is in play.' : null)),
    callRule('crypto.insecure-random', /^(?:rand::random(?:::<[^>]*>)?|thread_rng|rand::thread_rng|StdRng::seed_from_u64|SmallRng::\w+)$/, insecureRandomTest()),
    callRule('tls.verification-disabled', /\.(?:danger_accept_invalid_certs|danger_accept_invalid_hostnames)$/, (call) => (/true/.test(call.node.text) ? 'Certificate validation is disabled.' : null)),
    callRule('rust.unsafe-block', /^(?:std::mem::transmute|mem::transmute|transmute)$/),
  ],
  lineRules: [lineRule('rust.unsafe-block', /\bunsafe\s*\{/)],
  taintedParams: (fn) => {
    const params = fn.childForFieldName('parameters');
    const out: number[] = [];
    params?.namedChildren.forEach((p, i) => {
      if (p && /\b(?:Query|Json|Path|Form|web::Query|web::Json|web::Path|web::Form|Multipart)\s*[<(]/.test(p.text)) out.push(i);
    });
    return out;
  },
};
