import type { FamilyPack } from '../types.js';
import { argText, callRule, insecureRandomTest, lineRule, sink, weakHashTest } from './helpers.js';

export const javaPack: FamilyPack = {
  family: 'java',
  sources: [
    /^\w+\.(?:getParameter|getHeader|getQueryString|getParameterMap|getParameterValues|getCookies|getInputStream|getReader|getRequestURI|getPathInfo|getRequestURL)\(/,
    /^System\.getenv\(/,
    /^args\[\d+\]/,
  ],
  sanitizers: [/^(?:StringEscapeUtils\.\w+|ESAPI\.encoder\(\)\.\w+|HtmlUtils\.htmlEscape|Encode\.forHtml\w*|Encode\.for\w+|FilenameUtils\.getName|Paths\.get\(.*\)\.getFileName|URLEncoder\.encode|Jsoup\.clean|Pattern\.quote)$/],
  cleanCalls: /^(?:Integer\.parseInt|Long\.parseLong|Integer\.valueOf|Long\.valueOf|Double\.parseDouble|Boolean\.parseBoolean|UUID\.fromString|Math\.\w+)$/,
  sinks: [
    sink('taint.sql-injection', /\.(?:executeQuery|executeUpdate|executeLargeUpdate|prepareStatement|prepareCall|createQuery|createNativeQuery)$/, [0]),
    sink('taint.sql-injection', /(?:stmt|statement|Statement|conn|Conn|connection|Connection|jdbc|Jdbc|template|Template|entityManager|em|session|Session|sql)\w*\.(?:execute|queryForObject|queryForList|queryForMap|query|update|batchUpdate)$/, [0]),
    sink('taint.command-injection', /^Runtime\.getRuntime\(\)\.exec$|^(?:r|rt|runtime)\.exec$/, [0]),
    sink('taint.code-injection', /(?:^|\.)(?:eval|evaluate)$|^new GroovyShell$/, [0]),
    sink('taint.path-traversal', /^new (?:File|FileInputStream|FileOutputStream|FileReader|FileWriter|RandomAccessFile)$|^Paths\.get$|^Path\.of$|^Files\.(?:readAllBytes|readString|newInputStream|newOutputStream|write|delete|copy|lines|readAllLines)$/, [0], /\.startsWith\(/),
    sink('taint.ssrf', /^new URL$|^URI\.create$|^new URI$|restTemplate\.(?:getForObject|getForEntity|postForObject|postForEntity|exchange)$|^HttpRequest\.newBuilder$|^Jsoup\.connect$/, [0]),
    sink('taint.xss', /^(?:out|writer|response\.getWriter\(\)|resp\.getWriter\(\))\.(?:println|print|write|append|printf)$/, [0]),
    sink('taint.open-redirect', /\.sendRedirect$/, [0]),
    sink('taint.deserialization', /^new ObjectInputStream$|\.readObject$|^new XMLDecoder$|^yaml\.load$|^new Yaml$/, [0]),
    sink('taint.template-injection', /^(?:Velocity\.evaluate|Template\.process|new SpelExpressionParser\(\)\.parseExpression|parser\.parseExpression)$/, [0]),
  ],
  callRules: [
    callRule('crypto.weak-hash', /^MessageDigest\.getInstance$/, weakHashTest(/^['"](?:MD5|SHA-?1)['"]$/i)),
    callRule('crypto.insecure-random', /^new Random$|^Math\.random$/, insecureRandomTest()),
    callRule('crypto.ecb-mode', /^Cipher\.getInstance$/, (call) => (/^["'](?:AES|DES|DESede)(?:\/ECB\/[^"']*)?["']$/i.test(argText(call, 0)) ? 'ECB (the default for a bare algorithm name) is used.' : null)),
    callRule('xxe.parser-unhardened', /^(?:DocumentBuilderFactory|SAXParserFactory|XMLInputFactory|TransformerFactory|SchemaFactory)\.newInstance$/, (call) => (/setFeature|disallow-doctype-decl|IS_SUPPORTING_EXTERNAL_ENTITIES|FEATURE_SECURE_PROCESSING|ACCESS_EXTERNAL/.test(call.fnText) ? null : 'The XML parser factory is created without disabling external entities.')),
    callRule('cookie.insecure-flags', /^new Cookie$/, (call) => (/setHttpOnly\(true\)/.test(call.fnText) && /setSecure\(true\)/.test(call.fnText) ? null : 'Cookie created without HttpOnly and Secure.')),
  ],
  lineRules: [
    lineRule('tls.verification-disabled', /ALLOW_ALL_HOSTNAME_VERIFIER|NoopHostnameVerifier|\(\s*hostname\s*,\s*session\s*\)\s*->\s*true|TrustAllStrategy|InsecureTrustManagerFactory/),
    lineRule('error.stack-leak', /printStackTrace\(\s*(?:response|resp)\.getWriter\(\)\s*\)|getWriter\(\)\.\w+\(\s*\w*\.getStackTrace/),
    lineRule('config.debug-enabled', /(?:setDebug\(true\)|spring\.devtools|server\.error\.include-stacktrace\s*=\s*always)/),
  ],
  taintedParams: (fn) => {
    const params = fn.childForFieldName('parameters');
    const out: number[] = [];
    params?.namedChildren.forEach((p, i) => {
      if (p && /@(?:RequestParam|PathVariable|RequestBody|RequestHeader|CookieValue|ModelAttribute|QueryParam|PathParam|FormParam|HeaderParam)\b/.test(p.text)) out.push(i);
    });
    return out;
  },
};
