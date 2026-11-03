/** GitHub-backed repository and CI operations. No local shell, no git credentials in processes. */
const API = 'https://api.github.com';
const MAX_FILE_BYTES = 256_000;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,220}$/;

export function parseProjects(raw) {
  if (!raw) return [];
  return [...new Set(raw.split(',').map(x => x.trim()).filter(Boolean))].map(name => {
    if (!/^[\w.-]+\/[\w.-]+$/.test(name)) throw new Error(`Invalid GitHub repository setting: ${name}`);
    return name;
  });
}

export function validateRepo(repo, allowlist) {
  if (!allowlist.includes(repo)) throw new Error('Repository not permitted by GITHUB_REPOS');
  return repo;
}

export function validateRepoPath(path, prefixes = ['src/', 'app/', 'tests/', 'scripts/', 'README.md', 'package.json']) {
  if (typeof path !== 'string' || !SAFE_FILENAME.test(path) || path.startsWith('/') || path.includes('..') || path.includes('//')) {
    throw new Error('Invalid repository path');
  }
  if (path.split('/').some(part => part.startsWith('.') || part === 'node_modules')) throw new Error('Hidden or unsafe repository path');
  if (!prefixes.some(prefix => prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix)) {
    throw new Error('Path outside configured readable/writable prefixes');
  }
  return path;
}

export function validateBranch(branch, expected) {
  if (branch !== expected) throw new Error(`Only configured branch ${expected} is permitted`);
  return branch;
}

export function safeGitHubError(error) {
  return error?.message || 'GitHub operation failed';
}

export class GitHubService {
  constructor({ token, repositories, branch = 'main', workflow = 'handspan-verify.yml', enableWrites = false,
    readPrefixes, writePrefixes, fetchImpl = globalThis.fetch } = {}) {
    this.token = token;
    this.repositories = repositories || [];
    this.branch = branch;
    this.workflow = workflow;
    this.enableWrites = enableWrites;
    this.readPrefixes = readPrefixes || ['src/', 'app/', 'tests/', 'scripts/', 'README.md', 'package.json'];
    this.writePrefixes = writePrefixes || ['src/', 'app/', 'tests/'];
    this.fetch = fetchImpl;
  }

  assertAvailable(repo) {
    if (!this.token) throw new Error('GitHub tools unavailable: GITHUB_TOKEN is not configured');
    validateRepo(repo, this.repositories);
  }

  async api(method, route, body) {
    const response = await this.fetch(`${API}${route}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      // Never expose server/request authorization headers or private repository content.
      throw new Error(`GitHub request failed (${response.status}): ${String(detail.message || response.statusText).slice(0, 160)}`);
    }
    if (response.status === 204) return { ok: true };
    return response.json();
  }

  async repoInfo(repo) {
    this.assertAvailable(repo);
    const info = await this.api('GET', `/repos/${repo}`);
    const commit = await this.api('GET', `/repos/${repo}/commits/${encodeURIComponent(this.branch)}`);
    return { repo, private: info.private, defaultBranch: info.default_branch, configuredBranch: this.branch,
      headSha: commit.sha, headUrl: commit.html_url, repositoryUrl: info.html_url };
  }

  async readFile(repo, path) {
    this.assertAvailable(repo);
    validateRepoPath(path, this.readPrefixes);
    const file = await this.api('GET', `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(this.branch)}`);
    if (file.type !== 'file' || file.encoding !== 'base64' || Number(file.size) > MAX_FILE_BYTES) {
      throw new Error('Not a supported text file or exceeds 256 KB');
    }
    const bytes = Buffer.from(file.content.replace(/\s/g, ''), 'base64');
    if (bytes.includes(0)) throw new Error('Cannot read binary files through this tool');
    const content = bytes.toString('utf8');
    if (content.includes('\uFFFD')) throw new Error('Not a valid UTF-8 text file');
    return { repo, path, branch: this.branch, sha: file.sha, content, url: file.html_url };
  }

  async updateFile(repo, path, content, expectedSha, message) {
    this.assertAvailable(repo);
    if (!this.enableWrites) throw new Error('GitHub writes disabled (ENABLE_GITHUB_WRITES=false)');
    validateRepoPath(path, this.writePrefixes);
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_FILE_BYTES) throw new Error('Text content must be at most 256 KB');
    if (typeof expectedSha !== 'string' || !/^[a-f0-9]{40}$/.test(expectedSha)) {
      throw new Error('Expected existing file SHA is required; read the current file before updating');
    }
    if (!message || message.length > 120) throw new Error('Commit message required (up to 120 characters)');
    const result = await this.api('PUT', `/repos/${repo}/contents/${path}`, {
      branch: this.branch,
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      sha: expectedSha,
    });
    return { repo, branch: this.branch, path, sha: result.content?.sha, commit: result.commit?.sha,
      commitUrl: result.commit?.html_url };
  }

  async dispatchBuild(repo) {
    this.assertAvailable(repo);
    if (!this.workflow || !/^[\w.-]+\.ya?ml$/.test(this.workflow)) throw new Error('Invalid workflow setting');
    await this.api('POST', `/repos/${repo}/actions/workflows/${this.workflow}/dispatches`, { ref: this.branch });
    return { dispatched: true, repo, branch: this.branch, workflow: this.workflow,
      statusHint: 'GitHub does not return a run ID at dispatch. Call github_build_runs to find the new run.',
      actionsUrl: `https://github.com/${repo}/actions/workflows/${this.workflow}` };
  }

  async buildRuns(repo) {
    this.assertAvailable(repo);
    const route = `/repos/${repo}/actions/workflows/${this.workflow}/runs?branch=${encodeURIComponent(this.branch)}&event=workflow_dispatch&per_page=10`;
    const data = await this.api('GET', route);
    return { repo, branch: this.branch, workflow: this.workflow, runs: data.workflow_runs.map(run => ({
      id: run.id, status: run.status, conclusion: run.conclusion, headSha: run.head_sha,
      startedAt: run.run_started_at, url: run.html_url,
    })) };
  }

  async buildJobs(repo, runId) {
    this.assertAvailable(repo);
    if (!Number.isSafeInteger(Number(runId)) || Number(runId) < 1) throw new Error('Invalid run ID');
    // Ensure run belongs to the approved repository AND configured branch.
    const run = await this.api('GET', `/repos/${repo}/actions/runs/${runId}`);
    if (run.head_branch !== this.branch || run.event !== 'workflow_dispatch') {
      throw new Error('Run does not belong to configured branch and workflow dispatch');
    }
    const data = await this.api('GET', `/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`);
    return { repo, runId: Number(runId), url: run.html_url, status: run.status, conclusion: run.conclusion,
      jobs: data.jobs.map(job => ({ name: job.name, conclusion: job.conclusion, status: job.status,
        url: job.html_url, steps: job.steps?.map(step => ({ name: step.name, status: step.status,
          conclusion: step.conclusion })) || [] })) };
  }
}
