const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseRequest, resolveProfile, addCape, run } = require('./cape-request.cjs');

const UUID = '069a79f444e94726a5befca90e38aaf5';
const profile = { id: UUID, name: 'Notch' };
const form = ({ ign = 'notch', uuid = '_No response_', discord = '_No response_',
  roles = 'GTNH Developer, GTNH Texture Creator' } = {}) =>
  `### Discord username\n\n${discord}\n\n### Minecraft IGN\n\n${ign}\n\n` +
  `### Minecraft UUID\n\n${uuid}\n\n### GTNH roles\n\n${roles}`;
const response = (status, body) => ({ status, ok: status === 200, json: async () => body });

test('parses multiple roles and permits an omitted UUID and Discord username', () => {
  assert.deepEqual(parseRequest(form()), {
    ign: 'notch', uuid: '', discord: '', roles: ['GTNH Developer', 'GTNH Texture Creator'],
  });
});

test('normalizes a supplied dashed uppercase UUID', () => {
  assert.equal(parseRequest(form({ uuid: '069A79F4-44E9-4726-A5BE-FCA90E38AAF5' })).uuid, UUID);
});

test('rejects malformed inputs rather than building a cape entry from them', () => {
  for (const input of [form({ ign: 'name // injected' }), form({ ign: '$(whoami)' }),
    form({ uuid: '069a-79f444e94726a5befca90e38aaf5' }),
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

test('accepts a matching supplied UUID and rejects a mismatch', async () => {
  assert.deepEqual(await resolveProfile(parseRequest(form({ uuid: UUID })),
    async () => response(200, profile)), profile);
  await assert.rejects(resolveProfile(parseRequest(form({ uuid: '1'.repeat(32) })),
    async () => response(200, profile)), /does not match/i);
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
    issue: { number: 7, title: '[Cape Request]: Notch', body: form(), state: 'open' },
    refs: { master: 'base-sha' }, files: { 'base-sha': content }, pulls: [], comments: [],
    events: [], failed: [],
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
      update: async params => { record('close', params); Object.assign(state.issue, params); },
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
      list: async params => { record('list-prs', params); return { data: state.pulls }; },
      create: async params => {
        record('pr', params);
        if (state.failPR) throw new Error('GitHub unavailable');
        const pr = { number: 42, state: 'open', html_url: 'https://github.com/example/capes/pull/42' };
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

test('opens a one-file PR to master before closing the issue as completed', async () => {
  const { state, options } = githubFixture();
  state.issue.body = form({ discord: 'discord_user', roles: 'GTNH Contributor, GTNH Sound Designer' });
  await run(options);
  const commit = state.events.find(event => event.type === 'commit');
  assert.equal(commit.path, 'capesUUID.txt');
  assert.equal(commit.sha, 'file-sha');
  assert.equal(Buffer.from(commit.content, 'base64').toString(), `// header\n${UUID}:capedev // Notch\n`);
  const pr = state.events.find(event => event.type === 'pr');
  assert.equal(pr.base, 'master');
  assert.equal(pr.head, `cape-request/capedev-${UUID}`);
  assert.match(pr.body, /discord_user/);
  assert.match(pr.body, /GTNH Contributor, GTNH Sound Designer/);
  assert.match(pr.body, /#7/);
  assert.equal(state.issue.state_reason, 'completed');
  assert.ok(state.events.findIndex(event => event.type === 'pr') < state.events.findIndex(event => event.type === 'close'));
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
  assert.equal(state.issue.state_reason, 'completed');
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
  assert.equal(state.issue.state_reason, 'completed');
  assert.equal(state.events.filter(event => event.type === 'branch').length, 1);
  assert.equal(state.events.filter(event => event.type === 'commit').length, 1);
  assert.equal(state.comments.length, 1);
  assert.match(state.comments[0].body, /pull\/42/);
});

test('an existing open PR is reused for a second request for the same UUID', async () => {
  const { state, options } = githubFixture();
  state.pulls.push({ number: 42, state: 'open', html_url: 'https://github.com/example/capes/pull/42' });
  await run(options);
  assert.equal(state.issue.state_reason, 'completed');
  assert.ok(!state.events.some(event => ['branch', 'commit', 'pr'].includes(event.type)));
  assert.equal(state.events.find(event => event.type === 'list-prs').head, `example:cape-request/capedev-${UUID}`);
});

test('a previously closed PR is left for a maintainer instead of being recreated', async () => {
  const { state, options } = githubFixture();
  state.pulls.push({ number: 42, state: 'closed', html_url: 'https://github.com/example/capes/pull/42' });
  await run(options);
  assert.equal(state.issue.state, 'open');
  assert.match(state.comments[0].body, /maintainer/i);
  assert.ok(!state.events.some(event => ['branch', 'commit', 'pr'].includes(event.type)));
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
  assert.equal(state.issue.state_reason, 'completed');
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
