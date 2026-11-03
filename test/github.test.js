import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubService, parseProjects, validateRepo, validateRepoPath, validateBranch } from '../src/github.js';

test('repository allowlist is exact', () => {
  assert.deepEqual(parseProjects('owner/one, owner/two,owner/one'), ['owner/one','owner/two']);
  assert.throws(() => parseProjects('bad repo'));
  assert.equal(validateRepo('owner/one', ['owner/one']), 'owner/one');
  assert.throws(() => validateRepo('owner/other', ['owner/one']));
  assert.throws(() => validateBranch('main', 'dev'));
});

test('path scope excludes traversal, hidden files and workflow edits', () => {
  assert.equal(validateRepoPath('src/app/index.ts'), 'src/app/index.ts');
  for (const path of ['../etc/passwd', '/tmp/a', 'src/../.env', 'src/.env', '.github/workflows/a.yml', 'src//a', 'src/a?x=1']) {
    assert.throws(() => validateRepoPath(path), path);
  }
});

test('writes are disabled by default even with a token', async () => {
  const github = new GitHubService({ token: 'secret', repositories: ['owner/repo'], fetchImpl: async () => { throw new Error('must not call API'); } });
  await assert.rejects(github.updateFile('owner/repo', 'src/index.js', 'changed', 'a'.repeat(40), 'message'), /disabled/);
});

test('read returns decoded content only on approved branch and prefix', async () => {
  const requests = [];
  const github = new GitHubService({ token: 'secret', branch:'dev', repositories:['owner/repo'], fetchImpl: async (url, opts) => {
    requests.push([url, opts]);
    return { ok: true, status: 200, json: async () => ({ type:'file', encoding:'base64', size: 5, content: Buffer.from('hello').toString('base64'), sha: 'a'.repeat(40) }) };
  }});
  const out = await github.readFile('owner/repo', 'src/file.txt');
  assert.equal(out.content, 'hello');
  assert.match(requests[0][0], /ref=dev/);
  await assert.rejects(github.readFile('owner/repo','secrets.env'), /outside configured/);
});

test('dispatch uses fixed workflow and branch, never tool-controlled commands', async () => {
  let captured;
  const github = new GitHubService({ token:'secret', branch:'dev', workflow:'handspan-verify.yml', repositories:['owner/repo'], fetchImpl: async (url, opts) => {
    captured = {url, opts}; return {ok:true,status:204};
  }});
  const result = await github.dispatchBuild('owner/repo');
  assert.equal(result.dispatched,true);
  assert.match(captured.url, /handspan-verify\.yml\/dispatches$/);
  assert.deepEqual(JSON.parse(captured.opts.body), {ref:'dev'});
});

test('wrong-branch or non-dispatch run cannot expose job details', async () => {
  let count = 0;
  const github = new GitHubService({ token: 'secret', repositories: ['owner/repo'], branch: 'main', fetchImpl: async () => {
    count += 1;
    return {ok:true,status:200,json:async()=>({head_branch:'other',event:'workflow_dispatch'})};
  }});
  await assert.rejects(github.buildJobs('owner/repo', 12345), /configured branch/);
  assert.equal(count,1);
});

test('file read rejects oversized and binary content', async () => {
  const github = new GitHubService({ token: 'secret', repositories: ['owner/repo'], fetchImpl: async () => ({
    ok:true,status:200,json:async()=>({type:'file', encoding:'base64', size:256001, content:'AA=='})
  })});
  await assert.rejects(github.readFile('owner/repo','src/test.js'), /256 KB/);
});
