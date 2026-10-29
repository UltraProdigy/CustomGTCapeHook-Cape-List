const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseRequest, resolveProfile, addCape, run, closeRequests } = require('./cape-request.cjs');

const UUID = '069a79f444e94726a5befca90e38aaf5';
const profile = { id: UUID, name: 'Notch' };
const form = ({ ign = 'notch', discord = '_No response_', roles = 'GTNH Developer' } = {}) =>
  `### Discord Username\n\n${discord}\n\n### Minecraft IGN\n\n${ign}\n\n### GTNH Roles\n\n${roles}`;
const response = (status, body) => ({ status, ok: status === 200, json: async () => body });

test('parses the developer-only form without a UUID field', () => {
  assert.deepEqual(parseRequest(form()), { ign: 'notch', discord: '', roles: ['GTNH Developer'] });
  assert.throws(() => parseRequest(form({ roles: 'GTNH Contributor' })));
  assert.throws(() => parseRequest(form() + '\n\n### Minecraft UUID\n\n' + UUID));
});

test('rejects malformed inputs rather than building a cape entry from them', () => {
  for (const input of [form({ ign: 'name // injected' }), form({ ign: '$(whoami)' }),
    form({ roles: '_No response_' }), form({ roles: 'GTNH Admin' }),
    form() + '\n\n### Minecraft IGN\n\nSomeoneElse',
    form({ discord: 'one\ntwo' }), 'unstructured issue']) {
    assert.throws(() => parseRequest(input));
  }
});

test('resolves a profile from the IGN and uses Mojang casing and trimmed UUID', async () => {
  const result = await resolveProfile(parseRequest(form()), async (url, options) => {
    assert.equal(url, 'https://api.mojang.com/users/profiles/minecraft/notch');
    assert.ok(options.signal);
    return response(200, profile);
  });
  assert.deepEqual(result, profile);
});

test('failed or malformed profile lookups cannot produce a cape entry', async () => {
  for (const reply of [response(204), response(404), response(429), response(503),
    response(200, { id: 'bad', name: 'Notch' }),
    response(200, { id: UUID, name: 'SomeoneElse' })]) {
    await assert.rejects(resolveProfile(parseRequest(form()), async () => reply));
  }
  await assert.rejects(resolveProfile(parseRequest(form()), async () => { throw new Error('offline'); }));
});

test('sorts capedev by IGN without changing other cape groups or comments', () => {
  const before = `// header\n${UUID}:capedonor // Notch\n` +
    `${'a'.repeat(32)}:capedev // alpha\n${'b'.repeat(32)}:capedev // Zulu\n` +
    `${'c'.repeat(32)}:cape_stargate // Charlie\n`;
  assert.equal(addCape(before, profile), `// header\n${UUID}:capedonor // Notch\n` +
    `${'a'.repeat(32)}:capedev // alpha\n${UUID}:capedev // Notch\n` +
    `${'b'.repeat(32)}:capedev // Zulu\n${'c'.repeat(32)}:cape_stargate // Charlie\n`);
});

test('detects an existing capedev UUID despite dashes, casing, or a changed IGN', () => {
  assert.equal(addCape('069A79F4-44E9-4726-A5BE-FCA90E38AAF5:CAPEDEV // OldName\n', profile), null);
  assert.equal(addCape(`${UUID}:capedev\n`, profile), null);
});

test('inserts at both ends, preserves CRLF and missing final newline', () => {
  const entry = `${'b'.repeat(32)}:capedev // Middle`;
  assert.equal(addCape(entry, { id: UUID, name: 'Alpha' }), `${UUID}:capedev // Alpha\n${entry}`);
  assert.equal(addCape(entry + '\r\n', { id: UUID, name: 'Zulu' }),
    `${entry}\r\n${UUID}:capedev // Zulu\r\n`);
  assert.equal(addCape('// header\n', profile), `// header\n${UUID}:capedev // Notch\n`);
});

test('refuses an ambiguous capedev layout instead of overwriting other groups', () => {
  assert.throws(() => addCape(`${'a'.repeat(32)}:capedev // Alpha\n` +
    `${'b'.repeat(32)}:capedonor // Beta\n${'c'.repeat(32)}:capedev // Charlie\n`, profile));
});

function githubFixture(content = '// header\n') {
  const state = {
    issue: { number: 7, title: 'Cape Request', body: form(), state: 'open', user: { login: 'request-author' } },
    refs: { master: 'base-sha' }, files: { 'base-sha': content }, pulls: [], comments: [],
    events: [], failed: [], labels: [],
  };
  const record = (type, params) => state.events.push({ type, ...params });
  const notFound = () => Object.assign(new Error('Not Found'), { status: 404 });
  const rest = {
    issues: {
      get: async () => ({ data: structuredClone(state.issue) }),
      listComments: async () => ({ data: state.comments }),
      createComment: async params => {
        record('comment', params);
        state.comments.push({ id: 1, body: params.body, user: { type: 'Bot' } });
      },
      updateComment: async params => { record('comment-update', params); state.comments[0].body = params.body; },
      update: async params => {
        record(params.state === 'closed' ? 'close' : 'title', params);
        Object.assign(state.issue, params);
        return { data: structuredClone(state.issue) };
      },
      getLabel: async () => {
        if (!state.labels.includes('Chore')) throw notFound();
        return { data: { name: 'Chore' } };
      },
      createLabel: async params => { record('create-label', params); state.labels.push(params.name); },
      addLabels: async params => { record('labels', params); if (state.failLabel) throw new Error('Label unavailable'); },
    },
    git: {
      getRef: async ({ ref }) => {
        const sha = state.refs[ref.replace(/^heads\//, '')];
        if (!sha) throw notFound();
        return { data: { object: { sha } } };
      },
      createRef: async params => { record('branch', params); state.refs[params.ref.replace(/^refs\/heads\//, '')] = params.sha; },
    },
    repos: {
      getContent: async params => {
        record('read', params);
        const text = state.files[params.ref];
        if (text === undefined) throw notFound();
        return { data: { type: 'file', sha: 'file-sha', encoding: 'base64', content: Buffer.from(text).toString('base64') } };
      },
      createOrUpdateFileContents: async params => {
        record('commit', params);
        state.files['new-sha'] = Buffer.from(params.content, 'base64').toString();
        state.refs[params.branch] = 'new-sha';
      },
    },
    pulls: {
      get: async params => ({ data: state.currentPR || state.pulls.find(pr => pr.number === params.pull_number) }),
      update: async params => {
        record('update-pr', params);
        Object.assign(state.pulls.find(pr => pr.number === params.pull_number), params);
      },
      list: async params => {
        record('list-prs', params);
        return { data: state.pulls.filter(pr => (params.state === 'all' || pr.state === params.state) &&
          (!params.head || !pr.head || pr.head.ref === params.head.split(':')[1])) };
      },
      create: async params => {
        record('pr', params);
        if (state.failPR) throw new Error('GitHub unavailable');
        const pr = { body: params.body, head: { ref: params.head, repo: { full_name: 'example/capes' } }, number: 42 + state.pulls.length, state: 'open', html_url: 'https://github.com/example/capes/pull/42' };
        state.pulls.push(pr);
        state.onPR?.();
        return { data: pr };
      },
    },
  };
  return {
    state,
    options: {
      github: { rest, paginate: async (method, params) => (await method(params)).data },
      context: { repo: { owner: 'example', repo: 'capes' }, issue: { number: 7 } },
      core: { setFailed: message => state.failed.push(message), error: () => {}, info: () => {} },
      fetch: async () => response(200, profile),
    },
  };
}

test('opens a labeled one-file PR that closes the issue on merge', async () => {
  const { state, options } = githubFixture();
  state.issue.body = form({ discord: 'DreamMasterXXL' });
  await run(options);
  const commit = state.events.find(event => event.type === 'commit');
  assert.equal(commit.path, 'capesUUID.txt');
  assert.equal(commit.sha, 'file-sha');
  assert.equal(Buffer.from(commit.content, 'base64').toString(), `// header\n${UUID}:capedev // Notch\n`);
  const pr = state.events.find(event => event.type === 'pr');
  assert.equal(pr.base, 'master');
  assert.equal(pr.head, `cape-request/capedev-${UUID}`);
  assert.match(pr.body, /Discord Username: `DreamMasterXXL`/);
  assert.match(pr.body, /GTNH Roles: GTNH Developer/);
  assert.match(pr.body, /GitHub Username: @request-author/);
  assert.match(pr.body, /^Closes #7$/m);
  assert.doesNotMatch(pr.body, /self-reported|Adds a capedev/);
  assert.match(pr.body, /#7/);
  assert.equal(state.issue.state, 'open');
  assert.ok(!state.events.some(event => event.type === 'close'));
  assert.equal(state.issue.title, 'Cape Request: Notch');
  assert.deepEqual(state.events.find(event => event.type === 'labels').labels, ['Chore']);
  assert.match(state.comments[0].body, /pull\/42/);
  assert.deepEqual(state.failed, []);
});

test('closes an existing capedev request as not planned without opening a PR', async () => {
  const { state, options } = githubFixture(`${UUID}:capedev // OldName\n`);
  await run(options);
  assert.equal(state.issue.state_reason, 'not_planned');
  assert.ok(!state.events.some(event => ['branch', 'commit', 'pr'].includes(event.type)));
});

test('another cape for the UUID still permits a capedev PR', async () => {
  const { state, options } = githubFixture(`${UUID}:capedonor // Notch\n`);
  await run(options);
  assert.equal(state.issue.state, 'open');
  assert.equal(state.files['new-sha'], `${UUID}:capedonor // Notch\n${UUID}:capedev // Notch\n`);
});

test('invalid requests receive feedback and remain open without repository writes', async () => {
  const { state, options } = githubFixture();
  state.issue.body = form({ ign: 'invalid name' });
  await run(options);
  assert.equal(state.issue.state, 'open');
  assert.match(state.comments[0].body, /Minecraft IGN/);
  assert.ok(!state.events.some(event => ['branch', 'commit', 'pr'].includes(event.type)));
  assert.deepEqual(state.failed, []);
});

test('service failures leave the issue open and mark the run failed', async () => {
  const { state, options } = githubFixture();
  options.fetch = async () => response(503);
  await run(options);
  assert.equal(state.issue.state, 'open');
  assert.equal(state.failed.length, 1);
  assert.match(state.comments[0].body, /retry|rerun/i);
});

test('a failed PR creation is recoverable without another branch or commit', async () => {
  const { state, options } = githubFixture();
  state.failPR = true;
  await run(options);
  assert.equal(state.issue.state, 'open');
  assert.equal(state.failed.length, 1);
  state.failPR = false;
  await run(options);
  assert.equal(state.issue.state, 'open');
  assert.equal(state.events.filter(event => event.type === 'branch').length, 1);
  assert.equal(state.events.filter(event => event.type === 'commit').length, 1);
  assert.equal(state.comments.length, 1);
  assert.match(state.comments[0].body, /pull\/42/);
});

test('an existing open PR is reused for a second request for the same UUID', async () => {
  const { state, options } = githubFixture();
  state.pulls.push({ head: { ref: `cape-request/capedev-${UUID}`, repo: { full_name: 'example/capes' } }, number: 42, state: 'open', html_url: 'https://github.com/example/capes/pull/42' });
  await run(options);
  assert.equal(state.issue.state, 'open');
  assert.ok(!state.events.some(event => ['branch', 'commit', 'pr'].includes(event.type)));
  assert.ok(state.events.some(event => event.type === 'labels' && event.issue_number === 42));
});

test('a closed PR does not block a fresh request branch from current master', async () => {
  for (const merged of [false, true]) {
    const { state, options } = githubFixture();
    const oldBranch = 'cape-request/capedev-' + UUID;
    state.pulls.push({ number: 42, state: 'closed', merged, head: { ref: oldBranch, repo: { full_name: 'example/capes' } }, html_url: 'https://github.com/example/capes/pull/42' });
    state.refs[oldBranch] = 'old-sha';
    state.files['old-sha'] = UUID + ':capedev // OldName\n';
    await run(options);
    assert.deepEqual(state.failed, []);
    assert.equal(state.pulls.length, 2);
    assert.equal(state.pulls[1].head.ref, oldBranch + '-2');
    assert.equal(state.events.find(event => event.type === 'branch').sha, 'base-sha');
    assert.equal(state.issue.state, 'open');
    assert.match(state.comments[0].body, /merged or closed/);
    assert.doesNotMatch(state.comments[0].body, /previous PR|maintainer must review/i);
  }
});

test('unrelated issues, closed issues, and pull requests are ignored', async () => {
  for (const change of [{ title: 'Bug report' }, { state: 'closed' }, { pull_request: {} }]) {
    const { state, options } = githubFixture();
    Object.assign(state.issue, change);
    options.fetch = () => assert.fail('should not contact Mojang');
    await run(options);
    assert.deepEqual(state.events, []);
  }
});

test('invalid manual issue numbers fail before contacting GitHub', async () => {
  const { state, options } = githubFixture();
  await run({ ...options, issueNumber: NaN });
  assert.equal(state.failed.length, 1);
  assert.deepEqual(state.events, []);
});

test('an uncommitted branch is recovered even if master has advanced', async () => {
  const { state, options } = githubFixture();
  state.refs[`cape-request/capedev-${UUID}`] = 'base-sha';
  state.refs.master = 'advanced-sha';
  state.files['advanced-sha'] = `// header\n${'a'.repeat(32)}:capedonor // Alice\n`;
  await run(options);
  assert.equal(state.issue.state, 'open');
  assert.equal(state.files['new-sha'], `// header\n${UUID}:capedev // Notch\n`);
  assert.ok(!state.events.some(event => event.type === 'branch'));
});

test('an IGN edited during lookup is left open for the next run', async () => {
  const { state, options } = githubFixture();
  options.fetch = async () => {
    state.issue.body = form({ ign: 'SomeoneElse' });
    return response(200, profile);
  };
  await run(options);
  assert.equal(state.issue.state, 'open');
  assert.ok(!state.events.some(event => ['branch', 'commit', 'pr', 'close'].includes(event.type)));
});

test('an issue edited while the PR is being created is not closed against stale input', async () => {
  const { state, options } = githubFixture();
  state.onPR = () => { state.issue.body = form({ ign: 'SomeoneElse' }); };
  await run(options);
  assert.equal(state.pulls.length, 1);
  assert.equal(state.issue.state, 'open');
  assert.ok(!state.events.some(event => event.type === 'close'));
});

test('a reused PR gains a closing reference for the new request', async () => {
  const { state, options } = githubFixture();
  state.pulls.push({ head: { ref: `cape-request/capedev-${UUID}`, repo: { full_name: 'example/capes' } }, number: 42, state: 'open', body: 'Closes #3\n\nGitHub Username: @first-requester', html_url: 'https://github.com/example/capes/pull/42' });
  await run(options);
  assert.match(state.pulls[0].body, /^Closes #3$/m);
  assert.match(state.pulls[0].body, /^Closes #7$/m);
  assert.match(state.pulls[0].body, /@request-author/);
  assert.equal(state.issue.state, 'open');
});

test('label failure leaves the issue open and can be retried on the same PR', async () => {
  const { state, options } = githubFixture();
  state.failLabel = true;
  await run(options);
  assert.equal(state.issue.state, 'open');
  assert.equal(state.failed.length, 1);
  state.failLabel = false;
  await run(options);
  assert.equal(state.pulls.length, 1);
  assert.equal(state.events.filter(event => event.type === 'create-label').length, 1);
  assert.ok(state.events.filter(event => event.type === 'labels').length >= 2);
});

function closedPRFixture() {
  const fixture = githubFixture();
  const pr = {
    number: 42, state: 'closed', merged: false, body: 'Closes #7\n\nMinecraft IGN: `Notch`',
    base: { ref: 'master' },
    head: { ref: 'cape-request/capedev-' + UUID, repo: { full_name: 'example/capes' } },
  };
  fixture.state.issue.title = 'Cape Request: Notch';
  fixture.state.currentPR = pr;
  fixture.options.context.payload = { action: 'closed', pull_request: structuredClone(pr) };
  return fixture;
}

test('closing an unmerged automation PR closes its linked cape request as not planned', async () => {
  const { state, options } = closedPRFixture();
  await closeRequests(options);
  assert.equal(state.issue.state, 'closed');
  assert.equal(state.issue.state_reason, 'not_planned');
});

test('merged or reopened PRs do not mark requests as not planned', async () => {
  for (const change of [{ merged: true }, { state: 'open' }]) {
    const { state, options } = closedPRFixture();
    Object.assign(state.currentPR, change);
    await closeRequests(options);
    assert.equal(state.issue.state, 'open');
  }
});

test('PR closure ignores fork branches, unrelated branches, and non-cape issues', async () => {
  for (const mutate of [
    f => { f.options.context.payload.pull_request.head.repo.full_name = 'someone/fork'; },
    f => { f.options.context.payload.pull_request.head.ref = 'unrelated'; },
    f => { f.state.issue.title = 'Bug report'; },
  ]) {
    const f = closedPRFixture();
    mutate(f);
    await closeRequests(f.options);
    assert.equal(f.state.issue.state, 'open');
  }
});

test('editing the IGN detaches the old PR even after validation feedback replaced its comment', async () => {
  const { state, options } = githubFixture();
  await run(options);
  const oldPR = state.pulls[0];
  state.issue.body = form({ ign: 'invalid name' });
  await run(options);
  state.issue.body = form({ ign: 'OtherUser' });
  options.fetch = async () => response(200, { id: 'd'.repeat(32), name: 'OtherUser' });
  await run(options);
  assert.equal(oldPR.state, 'closed');
  assert.doesNotMatch(oldPR.body, /^Closes #7$/m);
  assert.equal(state.pulls.length, 2);
  assert.match(state.pulls[1].body, /^Closes #7$/m);
  assert.equal(state.issue.state, 'open');
  assert.equal(state.issue.title, 'Cape Request: OtherUser');
});

test('declining a PR does not close a request whose IGN has since changed', async () => {
  const { state, options } = closedPRFixture();
  state.issue.body = form({ ign: 'OtherUser' });
  await closeRequests(options);
  assert.equal(state.issue.state, 'open');
});

test('an open retry PR is reused after earlier PRs closed', async () => {
  const { state, options } = githubFixture();
  state.pulls.push({ number: 42, state: 'closed', head: { ref: 'cape-request/capedev-' + UUID, repo: { full_name: 'example/capes' } } });
  state.pulls.push({ number: 43, state: 'open', body: 'Closes #7', html_url: 'https://github.com/example/capes/pull/43', head: { ref: 'cape-request/capedev-' + UUID + '-2', repo: { full_name: 'example/capes' } } });
  await run(options);
  assert.equal(state.pulls.length, 2);
  assert.ok(!state.events.some(event => ['branch', 'commit', 'pr'].includes(event.type)));
  assert.match(state.comments[0].body, /pull\/43/);
});

test('closing an unmerged retry PR still closes its request as not planned', async () => {
  const { state, options } = closedPRFixture();
  options.context.payload.pull_request.head.ref += '-2';
  state.currentPR.head.ref += '-2';
  await closeRequests(options);
  assert.equal(state.issue.state_reason, 'not_planned');
});

test('a delayed old PR closure does not close an issue with a new retry PR', async () => {
  const { state, options } = closedPRFixture();
  state.pulls.push(state.currentPR);
  await run(options);
  assert.equal(state.pulls.length, 2);
  assert.equal(state.pulls[1].state, 'open');
  await closeRequests(options);
  assert.equal(state.issue.state, 'open');
});
