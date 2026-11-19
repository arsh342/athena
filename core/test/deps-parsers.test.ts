import assert from 'node:assert/strict';
import test from 'node:test';

import { parseManifests, uniqueQueries } from '../src/deps/parsers/index.ts';

async function parse(files: Record<string, string>) {
  return parseManifests(Object.keys(files), async (p) => files[p] ?? null);
}
const brief = (deps: Awaited<ReturnType<typeof parse>>) => deps.map((d) => `${d.ecosystem} ${d.name}@${d.version}${d.direct ? ' direct' : ''}${d.private ? ' private' : ''}${d.unpinned ? ' unpinned' : ''} L${d.line}`).sort();

test('npm: package-lock v3 and v1, direct flag from package.json, private packages', async () => {
  const pkg = '{\n  "dependencies": { "express": "^4.18.0", "local-lib": "file:../lib" }\n}';
  const lock3 = JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/express': { version: '4.18.2' }, 'node_modules/express/node_modules/qs': { version: '6.11.0' }, 'node_modules/local-lib': { version: '1.0.0', link: true } } }, null, 2);
  assert.deepEqual(brief(await parse({ '/p/package.json': pkg, '/p/package-lock.json': lock3 })), [
    'npm express@4.18.2 direct L5', 'npm local-lib@1.0.0 direct private L11', 'npm qs@6.11.0 L8',
  ]);
  const lock1 = JSON.stringify({ lockfileVersion: 1, dependencies: { a: { version: '1.0.0', dependencies: { b: { version: '2.0.0' } } } } });
  const out = await parse({ '/q/package-lock.json': lock1 });
  assert.deepEqual(out.map((d) => `${d.name}@${d.version}`).sort(), ['a@1.0.0', 'b@2.0.0']);
});

test('npm without a lockfile: declared ranges are unpinned', async () => {
  const out = await parse({ '/p/package.json': '{"dependencies":{"lodash":"^4.17.0","x":"github:a/b"}}' });
  assert.deepEqual(brief(out), ['npm lodash@^4.17.0 direct unpinned L1', 'npm x@github:a/b direct private unpinned L1']);
});

test('yarn v1, yarn berry and pnpm lockfiles', async () => {
  const yarn1 = '# yarn lockfile v1\n\nlodash@^4.17.0, lodash@^4.17.21:\n  version "4.17.21"\n  resolved "x"\n\n"@babel/core@^7.0.0":\n  version "7.22.5"\n';
  assert.deepEqual((await parse({ '/y/yarn.lock': yarn1 })).map((d) => `${d.name}@${d.version}`).sort(), ['@babel/core@7.22.5', 'lodash@4.17.21']);
  const berry = '__metadata:\n  version: 6\n\n"react@npm:^18.0.0":\n  version: 18.2.0\n  resolution: "react@npm:18.2.0"\n';
  assert.deepEqual((await parse({ '/b/yarn.lock': berry })).map((d) => `${d.name}@${d.version}`), ['react@18.2.0']);
  const pnpm = "lockfileVersion: '9.0'\npackages:\n  lodash@4.17.21:\n    resolution: {integrity: x}\n  '@types/node@20.1.0':\n    resolution: {integrity: y}\n  /axios@1.4.0:\n    resolution: {integrity: z}\n";
  assert.deepEqual((await parse({ '/n/pnpm-lock.yaml': pnpm })).map((d) => `${d.name}@${d.version}`).sort(), ['@types/node@20.1.0', 'axios@1.4.0', 'lodash@4.17.21']);
});

test('python: requirements pins, ranges, extras, comments; poetry.lock; Pipfile.lock; pyproject', async () => {
  const req = '# deps\nFlask[async]==2.3.2  # web\nrequests>=2.28\nDjango_Rest.Framework\n-r other.txt\n-e git+https://x/y.git#egg=y\n';
  assert.deepEqual(brief(await parse({ '/p/requirements.txt': req })), [
    'PyPI django-rest-framework@ direct unpinned L4', 'PyPI flask@2.3.2 direct L2', 'PyPI requests@2.28 direct unpinned L3',
  ]);
  const poetry = '[[package]]\nname = "Flask"\nversion = "2.3.2"\n\n[[package]]\nname = "mylib"\nversion = "0.1"\n[package.source]\ntype = "directory"\nurl = "../mylib"\n';
  const pyproject = '[tool.poetry.dependencies]\npython = "^3.11"\nflask = "^2.3"\n';
  assert.deepEqual(brief(await parse({ '/p/poetry.lock': poetry, '/p/pyproject.toml': pyproject })), ['PyPI flask@2.3.2 direct L2', 'PyPI mylib@0.1 private L6']);
  const pipenv = JSON.stringify({ default: { requests: { version: '==2.31.0' } }, develop: { pytest: { version: '==7.4.0' } } });
  assert.deepEqual((await parse({ '/q/Pipfile.lock': pipenv })).map((d) => `${d.name}@${d.version}`).sort(), ['pytest@7.4.0', 'requests@2.31.0']);
  const pep621 = '[project]\ndependencies = ["httpx>=0.24", "rich==13.5.2"]\n';
  assert.deepEqual((await parse({ '/r/pyproject.toml': pep621 })).map((d) => `${d.name}@${d.version}`).sort(), ['httpx@0.24', 'rich@13.5.2']);
});

test('maven: property resolution; gradle lockfile', async () => {
  const pom = '<project><properties><spring.version>6.0.11</spring.version></properties><dependencies>\n<dependency><groupId>org.springframework</groupId><artifactId>spring-web</artifactId><version>${spring.version}</version></dependency>\n<dependency><groupId>junit</groupId><artifactId>junit</artifactId></dependency>\n</dependencies></project>';
  assert.deepEqual(brief(await parse({ '/m/pom.xml': pom })), ['Maven junit:junit@ direct unpinned L3', 'Maven org.springframework:spring-web@6.0.11 direct L2']);
  const gradle = '# lock\norg.apache.logging.log4j:log4j-core:2.14.1=compileClasspath,runtimeClasspath\nempty=annotationProcessor\n';
  assert.deepEqual(brief(await parse({ '/g/gradle.lockfile': gradle })), ['Maven org.apache.logging.log4j:log4j-core@2.14.1 L2']);
});

test('nuget: packages.lock.json and csproj', async () => {
  const lock = JSON.stringify({ version: 1, dependencies: { 'net8.0': { 'Newtonsoft.Json': { type: 'Direct', resolved: '13.0.1' }, 'System.Memory': { type: 'Transitive', resolved: '4.5.5' } } } });
  assert.deepEqual((await parse({ '/c/packages.lock.json': lock })).map((d) => `${d.name}@${d.version}${d.direct ? ' direct' : ''}`).sort(), ['Newtonsoft.Json@13.0.1 direct', 'System.Memory@4.5.5']);
  const csproj = '<Project><ItemGroup><PackageReference Include="Serilog" Version="3.0.1" /><PackageReference Include="Dapper"><Version>2.0.123</Version></PackageReference></ItemGroup></Project>';
  assert.deepEqual((await parse({ '/d/App.csproj': csproj })).map((d) => `${d.name}@${d.version}`).sort(), ['Dapper@2.0.123', 'Serilog@3.0.1']);
});

test('go, cargo, composer, vcpkg, conan', async () => {
  const gomod = 'module x\n\ngo 1.21\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgolang.org/x/text v0.12.0 // indirect\n)\nrequire github.com/lib/pq v1.10.9\n';
  assert.deepEqual(brief(await parse({ '/go/go.mod': gomod })), ['Go github.com/gin-gonic/gin@v1.9.1 direct L6', 'Go github.com/lib/pq@v1.10.9 direct L9', 'Go golang.org/x/text@v0.12.0 L7']);
  const cargoLock = '[[package]]\nname = "serde"\nversion = "1.0.188"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n\n[[package]]\nname = "myapp"\nversion = "0.1.0"\n\n[[package]]\nname = "fork"\nversion = "0.2.0"\nsource = "git+https://x/y"\n';
  const cargoToml = '[dependencies]\nserde = "1"\n';
  assert.deepEqual(brief(await parse({ '/r/Cargo.lock': cargoLock, '/r/Cargo.toml': cargoToml })), ['crates.io fork@0.2.0 private L11', 'crates.io serde@1.0.188 direct L2']);
  const composer = JSON.stringify({ packages: [{ name: 'laravel/framework', version: 'v10.20.0' }, { name: 'symfony/console', version: 'v6.3.4' }] });
  assert.deepEqual((await parse({ '/ph/composer.lock': composer, '/ph/composer.json': '{"require":{"laravel/framework":"^10"}}' })).map((d) => `${d.name}@${d.version}${d.direct ? ' direct' : ''}`).sort(), ['laravel/framework@10.20.0 direct', 'symfony/console@6.3.4']);
  assert.deepEqual((await parse({ '/v/vcpkg.json': '{"dependencies":["zlib",{"name":"fmt","version>=":"10.1.0"}]}' })).map((d) => `${d.name}@${d.version}`).sort(), ['fmt@10.1.0', 'zlib@']);
  assert.deepEqual((await parse({ '/k/conan.lock': '{"requires":["openssl/3.1.2#abc","zlib/1.3"]}' })).map((d) => `${d.name}@${d.version}`).sort(), ['openssl@3.1.2', 'zlib@1.3']);
});

test('monorepo: three lockfiles are all parsed, queries are deduplicated, locations stay per manifest', async () => {
  const lock = (v: string) => JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/lodash': { version: v } } }, null, 2);
  const deps = await parse({ '/m/a/package-lock.json': lock('4.17.21'), '/m/b/package-lock.json': lock('4.17.21'), '/m/c/package-lock.json': lock('4.17.15') });
  assert.equal(deps.length, 3);
  assert.deepEqual(new Set(deps.map((d) => d.manifest)).size, 3);
  assert.deepEqual(uniqueQueries(deps).map((q) => q.version).sort(), ['4.17.15', '4.17.21']);
  assert.deepEqual(uniqueQueries([{ ecosystem: 'npm', name: 'x', version: '1', direct: true, manifest: 'm', line: 1, private: true }]), []);
});

test('malformed files parse to nothing instead of throwing', async () => {
  const deps = await parse({ '/x/package-lock.json': '{not json', '/x/Cargo.lock': '= = =', '/x/pom.xml': '<<<', '/x/pnpm-lock.yaml': ':\t:' });
  assert.deepEqual(deps, []);
});
