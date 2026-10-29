const ROLES = ['GTNH Developer'];
const UUID_PATTERN = /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const IGN_PATTERN = /^[a-z0-9_]{1,16}$/i;

class RequestError extends Error {}

function isCapeRequest(title) {
  return /^Cape Request(?::|$)/.test(title) || title.startsWith('[Cape Request]:');
}

function parseRequest(body) {
  const fields = new Map();
  const sections = (body || '').replace(/\r\n/g, '\n').split(/^### /m).slice(1);
  for (const section of sections) {
    const newline = section.indexOf('\n');
    const heading = section.slice(0, newline).trim();
    if (fields.has(heading)) throw new RequestError(`Duplicate field: ${heading}. Please use the cape request form.`);
    const value = section.slice(newline + 1).trim();
    fields.set(heading, value === '_No response_' ? '' : value);
  }
  const headings = ['Discord Username', 'Minecraft IGN', 'GTNH Roles'];
  if (fields.size !== headings.length || headings.some(heading => !fields.has(heading))) {
    throw new RequestError('Please use the cape request form and keep its three field headings intact.');
  }
  const ign = fields.get('Minecraft IGN');
  const discord = fields.get('Discord Username');
  const roles = fields.get('GTNH Roles').split(',').map(role => role.trim());
  if (!IGN_PATTERN.test(ign)) throw new RequestError('Minecraft IGN must contain 1–16 letters, numbers, or underscores.');
  if (discord.length > 100 || /[\x00-\x1f\x7f`]/.test(discord)) throw new RequestError('Discord Username must be a single line of at most 100 characters without backticks.');
  if (roles.some(role => !ROLES.includes(role))) throw new RequestError('Select GTNH Developer from the role dropdown.');
  return { ign, discord, roles: [...new Set(roles)] };
}

async function resolveProfile(request, fetchProfile = globalThis.fetch) {
  const response = await fetchProfile(`https://api.mojang.com/users/profiles/minecraft/${request.ign}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 204 || response.status === 404) {
    throw new RequestError('Mojang could not find that Minecraft IGN. Check the Java Edition username and edit this issue to retry.');
  }
  if (!response.ok) throw new Error(`Mojang lookup failed (HTTP ${response.status}). Try again later.`);
  const profile = await response.json();
  if (!profile || !/^[a-f0-9]{32}$/i.test(profile.id) || !IGN_PATTERN.test(profile.name) ||
      profile.name.toLowerCase() !== request.ign.toLowerCase()) {
    throw new Error('Mojang returned an invalid profile. Try again later.');
  }
  profile.id = profile.id.toLowerCase();
  return { id: profile.id, name: profile.name };
}

function readEntry(line) {
  const match = line.match(/^\s*([a-f0-9-]+):([a-z0-9_]+)(?:\s*\/\/\s*(\S+))?\s*$/i);
  if (!match || !UUID_PATTERN.test(match[1])) return null;
  return { id: match[1].replace(/-/g, '').toLowerCase(), cape: match[2].toLowerCase(), name: match[3] };
}

function addCape(content, profile) {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const trailingNewline = content.endsWith('\n');
  const lines = content ? content.split(/\r?\n/) : [];
  if (trailingNewline) lines.pop();
  const entries = lines.map(readEntry);
  if (entries.some(entry => entry?.cape === 'capedev' && entry.id === profile.id)) return null;
  const indexes = entries.flatMap((entry, index) => entry?.cape === 'capedev' ? [index] : []);
  const newLine = `${profile.id}:capedev // ${profile.name}`;
  if (indexes.length === 0) {
    lines.push(newLine);
  } else {
    const first = indexes[0];
    const last = indexes.at(-1);
    if (last - first + 1 !== indexes.length || indexes.some(index => !entries[index].name)) {
      throw new Error('The capedev section is not a contiguous, named list. A maintainer must check its formatting.');
    }
    const group = lines.slice(first, last + 1).concat(newLine);
    group.sort((a, b) => {
      const left = readEntry(a).name.toLowerCase();
      const right = readEntry(b).name.toLowerCase();
      return left < right ? -1 : left > right ? 1 : 0;
    });
    lines.splice(first, indexes.length, ...group);
  }
  return lines.join(newline) + (trailingNewline || !content ? newline : '');
}

async function run({ github, context, core, issueNumber = context.issue.number, fetch = globalThis.fetch }) {
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) {
    core.setFailed('Provide a positive integer issue number.');
    return;
  }
  const repo = context.repo;
  const issueParams = { ...repo, issue_number: issueNumber };
  const path = 'capesUUID.txt';
  const marker = '<!-- cape-request-automation -->';
  let snapshot;
  let requester;

  async function stillCurrent() {
    const { data: current } = await github.rest.issues.get(issueParams);
    const unchanged = current.state === 'open' && !current.pull_request &&
      current.title === snapshot.title && current.body === snapshot.body;
    if (!unchanged) core.info('Issue changed during processing; leaving it for the next run.');
    return unchanged;
  }


  function previousPRNumbers(body = '') {
    const numbers = [...body.matchAll(/<!-- cape-request-pr:(\d+) -->/g)].map(match => Number(match[1]));
    // Also recognize comments written before the hidden PR marker was introduced.
    for (const match of body.matchAll(/https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/g)) {
      if (`${match[1]}/${match[2]}`.toLowerCase() === `${repo.owner}/${repo.repo}`.toLowerCase()) numbers.push(Number(match[3]));
    }
    return [...new Set(numbers)];
  }

  async function previousFeedback() {
    const comments = await github.paginate(github.rest.issues.listComments, { ...issueParams, per_page: 100 });
    return comments.find(comment => comment.user?.type === 'Bot' && comment.body?.startsWith(marker));
  }

  async function feedback(message, prNumber) {
    const previous = await previousFeedback();
    const numbers = new Set(previousPRNumbers(previous?.body));
    if (prNumber) numbers.add(prNumber);
    const metadata = [...numbers].map(number => `<!-- cape-request-pr:${number} -->`);
    const body = [marker, message, ...metadata].join('\n');
    if (previous) {
      if (previous.body !== body) await github.rest.issues.updateComment({ ...repo, comment_id: previous.id, body });
    } else {
      await github.rest.issues.createComment({ ...issueParams, body });
    }
  }

  async function detachPreviousPRs(profile) {
    const previous = await previousFeedback();
    const closingLine = `Closes #${issueNumber}`;
    for (const number of previousPRNumbers(previous?.body)) {
      const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: number });
      if (pr.state !== 'open' || pr.head.ref === `cape-request/capedev-${profile.id}` ||
          pr.head.repo?.full_name?.toLowerCase() !== `${repo.owner}/${repo.repo}`.toLowerCase() ||
          !/^cape-request\/capedev-[a-f0-9]{32}$/.test(pr.head.ref)) continue;
      const lines = (pr.body || '').split(/\r?\n/);
      if (!lines.includes(closingLine)) continue;
      const body = lines.filter(line => line !== closingLine).join('\n').trim();
      // A shared PR stays open for its remaining requests; a superseded one closes.
      await github.rest.pulls.update({
        ...repo, pull_number: number, body,
        ...(!/^Closes #\d+$/m.test(body) ? { state: 'closed' } : {}),
      });
    }
  }

  async function readFile(ref) {
    const { data } = await github.rest.repos.getContent({ ...repo, path, ref });
    if (data.type !== 'file' || data.encoding !== 'base64') throw new Error('Could not read capesUUID.txt as a file.');
    return { sha: data.sha, content: Buffer.from(data.content, 'base64').toString('utf8') };
  }

  async function preparePR(pr) {
    const closingLine = `Closes #${issueNumber}`;
    if (!(pr.body || '').split(/\r?\n/).includes(closingLine)) {
      await github.rest.pulls.update({
        ...repo, pull_number: pr.number,
        body: [pr.body?.trim(), closingLine, `GitHub Username: @${requester}`].filter(Boolean).join('\n\n'),
      });
    }
    await feedback(`Pull request: ${pr.html_url}. This issue will close automatically when the PR is merged.`, pr.number);
    try {
      await github.rest.issues.getLabel({ ...repo, name: 'Chore' });
    } catch (error) {
      if (error.status !== 404) throw error;
      try {
        await github.rest.issues.createLabel({ ...repo, name: 'Chore', color: 'ededed' });
      } catch (creationError) {
        if (creationError.status !== 422) throw creationError;
      }
    }
    await github.rest.issues.addLabels({ ...repo, issue_number: pr.number, labels: ['Chore'] });
  }

  try {
    const { data: issue } = await github.rest.issues.get(issueParams);
    if (issue.pull_request || issue.state !== 'open' || !isCapeRequest(issue.title)) return;
    snapshot = { title: issue.title, body: issue.body };
    const request = parseRequest(issue.body);
    requester = issue.user.login;
    const profile = await resolveProfile(request, fetch);
    if (!await stillCurrent()) return;
    const title = `Cape Request: ${profile.name}`;
    if (snapshot.title !== title) {
      await github.rest.issues.update({ ...issueParams, title });
      snapshot.title = title;
    }
    if (!await stillCurrent()) return;
    await detachPreviousPRs(profile);
    const { data: master } = await github.rest.git.getRef({ ...repo, ref: 'heads/master' });
    const file = await readFile(master.object.sha);
    const updated = addCape(file.content, profile);
    if (updated === null) {
      if (!await stillCurrent()) return;
      await feedback(`\`${profile.name}\` (\`${profile.id}\`) already has a capedev entry in master. Closing as not planned because no addition is needed.`);
      if (await stillCurrent()) {
        await github.rest.issues.update({ ...issueParams, state: 'closed', state_reason: 'not_planned' });
      }
      return;
    }

    // The UUID determines the branch, so separate issues and retries share one PR.
    const branch = `cape-request/capedev-${profile.id}`;
    const prs = await github.paginate(github.rest.pulls.list, {
      ...repo, head: `${repo.owner}:${branch}`, base: 'master', state: 'all', per_page: 100,
    });
    const openPR = prs.find(pr => pr.state === 'open');
    if (openPR) {
      await preparePR(openPR);
      return;
    }
    if (prs.length) {
      throw new RequestError(`A previous PR for this UUID was closed: ${prs[0].html_url}. A maintainer must review that decision before another request is processed.`);
    }
    if (!await stillCurrent()) return;

    let branchRef;
    try {
      branchRef = (await github.rest.git.getRef({ ...repo, ref: `heads/${branch}` })).data;
    } catch (error) {
      if (error.status !== 404) throw error;
      try {
        await github.rest.git.createRef({ ...repo, ref: `refs/heads/${branch}`, sha: master.object.sha });
      } catch (creationError) {
        // Another issue for the same UUID may have created the branch concurrently.
        if (creationError.status !== 422) throw creationError;
      }
      branchRef = (await github.rest.git.getRef({ ...repo, ref: `heads/${branch}` })).data;
    }
    // Apply to the branch's own snapshot, which may predate today's master if an
    // earlier run stopped before committing. The file SHA guards concurrent edits.
    const branchFile = branchRef.object.sha === master.object.sha ? file : await readFile(branchRef.object.sha);
    const branchUpdate = addCape(branchFile.content, profile);
    if (branchUpdate !== null) {
      await github.rest.repos.createOrUpdateFileContents({
        ...repo, path, branch, sha: branchFile.sha,
        message: `Add capedev for ${profile.name}`,
        content: Buffer.from(branchUpdate, 'utf8').toString('base64'),
      });
    }
    const { data: pr } = await github.rest.pulls.create({
      ...repo, base: 'master', head: branch,
      title: `Add developer cape for ${profile.name}`,
      body: [
        `Closes #${issueNumber}`,
        '',
        `GitHub Username: @${requester}`,
        `Minecraft IGN: \`${profile.name}\``,
        `Minecraft UUID: \`${profile.id}\``,
        `Discord Username: ${request.discord ? `\`${request.discord}\`` : 'Not provided'}`,
        `GTNH Roles: ${request.roles.join(', ')}`,
      ].join('\n'),
    });
    await preparePR(pr);
  } catch (error) {
    const expected = error instanceof RequestError;
    if (!expected) core.error(error.message);
    try {
      await feedback(expected ? error.message :
        'Automatic processing failed. This issue remains open. Please retry later by editing or reopening it, or ask a maintainer to rerun the Cape request workflow with this issue number.');
    } catch (commentError) {
      core.setFailed(`Could not post request feedback: ${commentError.message}`);
    }
    if (!expected) core.setFailed(`Cape request processing failed: ${error.message}`);
  }
}

async function closeRequests({ github, context }) {
  const event = context.payload;
  const pr = event.pull_request;
  const repo = context.repo;
  if (event.action !== 'closed' || !pr || pr.merged || pr.base.ref !== 'master' ||
      pr.head.repo?.full_name?.toLowerCase() !== `${repo.owner}/${repo.repo}`.toLowerCase() ||
      !/^cape-request\/capedev-[a-f0-9]{32}$/.test(pr.head.ref)) return;
  // Read current state in case the PR was reopened while this event was queued.
  const { data: current } = await github.rest.pulls.get({ ...repo, pull_number: pr.number });
  if (current.state !== 'closed' || current.merged) return;
  const references = [...(current.body || '').matchAll(/^Closes #([1-9]\d*)\s*$/gm)];
  for (const issueNumber of new Set(references.map(match => Number(match[1])))) {
    const params = { ...repo, issue_number: issueNumber };
    const { data: issue } = await github.rest.issues.get(params);
    if (issue.state === 'open' && !issue.pull_request && isCapeRequest(issue.title)) {
      const name = current.body.match(/^Minecraft IGN: `([a-z0-9_]+)`$/im)?.[1];
      try {
        if (!name || parseRequest(issue.body).ign.toLowerCase() !== name.toLowerCase()) continue;
      } catch {
        continue;
      }
      await github.rest.issues.update({ ...params, state: 'closed', state_reason: 'not_planned' });
    }
  }
}

module.exports = { parseRequest, resolveProfile, addCape, run, closeRequests };
