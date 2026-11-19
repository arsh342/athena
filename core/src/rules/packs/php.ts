import type { FamilyPack } from '../types.js';
import { callRule, insecureRandomTest, lineRule, sink } from './helpers.js';

export const phpPack: FamilyPack = {
  family: 'php',
  sources: [
    /^\$_(?:GET|POST|REQUEST|COOKIE|FILES|SERVER|ENV)\b/, /^\$request->(?:input|query|get|post|all|json|cookie|header|file|route|only|except)\(/, /^\$request->\w+$/,
    /^\$this->request->(?:getQuery|getData|getParam)\(/, /^(?:Input|Request)::(?:get|input|all|query|post)\(/, /^file_get_contents\(['"]php:\/\/input/, /^\$argv/, /^getenv\(/,
  ],
  sanitizers: [/^(?:htmlspecialchars|htmlentities|esc_html|esc_attr|esc_url|e|escapeshellarg|escapeshellcmd|basename|intval|floatval|filter_var|filter_input|urlencode|rawurlencode|mysqli_real_escape_string|addslashes|realpath|strip_tags|\$\w+->quote|\$\w+->real_escape_string)$/],
  cleanCalls: /^(?:intval|floatval|abs|strlen|count|is_numeric|ctype_digit|\(int\)|\(float\))$/,
  sinks: [
    sink('taint.sql-injection', /^(?:mysqli_query|mysql_query|pg_query|sqlite_query|mssql_query)$/, [0, 1]),
    sink('taint.sql-injection', /->(?:query|exec|prepare|execute|multi_query|real_query)$|^DB::(?:select|statement|raw|unprepared|insert|update|delete)$|->(?:whereRaw|selectRaw|orderByRaw|havingRaw|groupByRaw)$/, [0]),
    sink('taint.command-injection', /^(?:exec|system|shell_exec|passthru|popen|proc_open|pcntl_exec)$/, [0]),
    sink('taint.code-injection', /^(?:eval|assert|create_function|preg_replace)$/, [0]),
    sink('taint.file-include', /^(?:include|include_once|require|require_once)$/, 'any'),
    sink('taint.path-traversal', /^(?:file_get_contents|file_put_contents|fopen|readfile|file|unlink|rename|copy|mkdir|rmdir|move_uploaded_file|fread|SplFileObject|opendir|scandir|highlight_file|show_source)$/, [0, 1], /strpos\(|str_starts_with\(|strncmp\(/),
    sink('taint.ssrf', /^(?:curl_init|fsockopen|get_headers)$/, [0]),
    sink('taint.xss', /^(?:echo|print|printf|die|exit)$/, 'any'),
    sink('taint.open-redirect', /^(?:header|redirect|wp_redirect)$/, [0]),
    sink('taint.deserialization', /^(?:unserialize|yaml_parse)$/, [0]),
  ],
  callRules: [
    callRule('crypto.weak-hash', /^(?:md5|sha1|crypt)$/, (call, ctx) => (/(?:^|[^a-z])(?:passw(?:or)?d|passwd|credential|secret|token)/i.test(call.node.text) || /(?:^|[^a-z])(?:passw(?:or)?d|passwd|secret|token)/i.test(ctx.lines[call.line - 1] ?? '') ? 'Weak hash used where a password or secret is in play.' : null)),
    callRule('crypto.insecure-random', /^(?:rand|mt_rand|uniqid|random_int_fake)$/, insecureRandomTest()),
    callRule('php.dangerous-extract', /^extract$/, (call) => (/\$_(?:GET|POST|REQUEST|COOKIE)|\$request/.test(call.node.text) ? 'extract() is applied to request data.' : null)),
    callRule('tls.verification-disabled', /^curl_setopt$/, (call) => (/CURLOPT_SSL_VERIFY(?:PEER|HOST)\s*,\s*(?:false|0)/.test(call.node.text) ? 'cURL certificate verification disabled.' : null)),
    callRule('config.insecure-temp-file', /^(?:tempnam|tmpfile_fake)$/),
  ],
  lineRules: [
    lineRule('config.debug-enabled', /(?:'debug'\s*=>\s*true|ini_set\(\s*['"]display_errors['"]\s*,\s*(?:1|['"]1['"]|true|['"]on['"])|APP_DEBUG\s*=\s*true)/i),
    lineRule('tls.verification-disabled', /CURLOPT_SSL_VERIFY(?:PEER|HOST)\s*=>\s*(?:false|0)|'verify'\s*=>\s*false/),
  ],
};
