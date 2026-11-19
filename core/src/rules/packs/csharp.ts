import type { FamilyPack } from '../types.js';
import { argText, callRule, insecureRandomTest, lineRule, sink, weakHashTest } from './helpers.js';

export const csharpPack: FamilyPack = {
  family: 'csharp',
  sources: [
    /^(?:Request|HttpContext\.Request)\.(?:Query|Form|Headers|Cookies|Body|Path|QueryString|RouteValues|Params)\b/,
    /^Request\[/,
    /^Environment\.GetCommandLineArgs\(/,
    /^Console\.ReadLine\(/,
  ],
  sanitizers: [/^(?:HttpUtility\.HtmlEncode|WebUtility\.HtmlEncode|HtmlEncoder\.Default\.Encode|Uri\.EscapeDataString|Path\.GetFileName|Regex\.Escape|AntiXssEncoder\.\w+|HtmlSanitizer\.Sanitize|sanitizer\.Sanitize)$/],
  cleanCalls: /^(?:int\.Parse|int\.TryParse|long\.Parse|Guid\.Parse|Guid\.TryParse|Convert\.ToInt32|Convert\.ToInt64|decimal\.Parse|double\.Parse|bool\.Parse|Math\.\w+)$/,
  sinks: [
    sink('taint.sql-injection', /^new (?:SqlCommand|OleDbCommand|OdbcCommand|NpgsqlCommand|MySqlCommand|SQLiteCommand|SqlDataAdapter)$|\.(?:FromSqlRaw|ExecuteSqlRaw|ExecuteSqlCommand|SqlQuery|Query|QueryFirst|QuerySingle|Execute|ExecuteScalar)$|^(?:cmd|command)\.CommandText$/, [0]),
    sink('taint.command-injection', /^(?:Process\.Start|new ProcessStartInfo)$/, [0]),
    sink('taint.code-injection', /^(?:CSharpScript\.EvaluateAsync|CSharpScript\.RunAsync|\w+\.CompileAssemblyFromSource)$/, [0]),
    sink('taint.path-traversal', /^(?:File\.(?:ReadAllText|ReadAllBytes|ReadAllLines|WriteAllText|WriteAllBytes|Delete|Open|OpenRead|Copy|Move|AppendAllText)|Directory\.(?:GetFiles|Delete|CreateDirectory|EnumerateFiles)|new FileStream|new StreamReader|new StreamWriter|PhysicalFile|File)$/, [0], /StartsWith\(/),
    sink('taint.ssrf', /^(?:new Uri|new HttpRequestMessage|WebRequest\.Create|HttpWebRequest\.Create|\w*[cC]lient\.(?:GetAsync|GetStringAsync|PostAsync|SendAsync|GetStreamAsync|DownloadString|DownloadFile))$/, [0]),
    sink('taint.xss', /^(?:Response\.Write|new HtmlString|Html\.Raw)$/, [0]),
    sink('taint.xss', /^Content$/, [0], undefined, /text\/html/i),
    sink('taint.open-redirect', /^(?:Redirect|RedirectPermanent|Response\.Redirect|new RedirectResult)$/, [0]),
    sink('taint.deserialization', /^(?:\w*(?:Formatter|DataContractSerializer|XmlSerializer)|\w*formatter)\.Deserialize$/, [0]),
  ],
  callRules: [
    callRule('deserialization.insecure-formatter', /^new (?:BinaryFormatter|SoapFormatter|NetDataContractSerializer|LosFormatter|ObjectStateFormatter)$|^(?:BinaryFormatter|SoapFormatter)\.Deserialize$/),
    callRule('crypto.weak-hash', /^(?:MD5|SHA1)\.Create$|^new (?:MD5CryptoServiceProvider|SHA1CryptoServiceProvider|MD5Cng|SHA1Managed)$/, (call, ctx) => (/(?:^|[^a-z])(?:passw(?:or)?d|passwd|credential|secret|token)/i.test(call.fnText || '') || /(?:^|[^a-z])(?:passw(?:or)?d|passwd|secret|token)/i.test(ctx.lines[call.line - 1] ?? '') ? 'Weak hash used where a password or secret is in play.' : null)),
    callRule('crypto.insecure-random', /^new Random$/, insecureRandomTest()),
    callRule('crypto.ecb-mode', /^CipherMode\.ECB$/),
    callRule('xxe.parser-unhardened', /^new XmlDocument$|^new XmlTextReader$/, (call) => (/XmlResolver\s*=\s*null|DtdProcessing\.Prohibit|DtdProcessing\.Ignore/.test(call.fnText) ? null : 'XML parsed without disabling DTD/external entities.')),
  ],
  lineRules: [
    lineRule('tls.verification-disabled', /ServerCertificateValidationCallback\s*[+]?=[^;]*(?:true|=>\s*true)|DangerousAcceptAnyServerCertificateValidator|ServerCertificateCustomValidationCallback\s*=.*true/),
    lineRule('crypto.ecb-mode', /CipherMode\.ECB|Mode\s*=\s*CipherMode\.ECB/),
    lineRule('config.debug-enabled', /UseDeveloperExceptionPage\(\)|<compilation[^>]*debug\s*=\s*["']true["']/i),
    lineRule('error.stack-leak', /(?:Response\.Write|Content|return\s+(?:Ok|BadRequest|StatusCode)\([^)]*)\(?\s*\w*(?:ex|e|exception)\.(?:StackTrace|ToString\(\))/),
  ],
  taintedParams: (fn) => {
    const params = fn.childForFieldName('parameters');
    const out: number[] = [];
    params?.namedChildren.forEach((p, i) => {
      if (p && /\[(?:FromQuery|FromBody|FromRoute|FromForm|FromHeader)\b/.test(p.text)) out.push(i);
    });
    return out;
  },
};

void argText;
void weakHashTest;
