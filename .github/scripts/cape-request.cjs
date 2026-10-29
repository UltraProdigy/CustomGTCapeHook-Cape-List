const ROLES = ['GTNH Developer', 'GTNH Contributor', 'GTNH Texture Creator', 'GTNH Sound Designer'];
const UUID_PATTERN = /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const IGN_PATTERN = /^[a-z0-9_]{1,16}$/i;

class RequestError extends Error {}

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
  const headings = ['Discord username', 'Minecraft IGN', 'Minecraft UUID', 'GTNH roles'];
  if (fields.size !== headings.length || headings.some(heading => !fields.has(heading))) {
    throw new RequestError('Please use the cape request form and keep its four field headings intact.');
  }
  const ign = fields.get('Minecraft IGN');
  const uuid = fields.get('Minecraft UUID');
  const discord = fields.get('Discord username');
  const roles = fields.get('GTNH roles').split(',').map(role => role.trim());
  if (!IGN_PATTERN.test(ign)) throw new RequestError('Minecraft IGN must contain 1–16 letters, numbers, or underscores.');
  if (uuid && !UUID_PATTERN.test(uuid)) throw new RequestError('Minecraft UUID must be 32 hexadecimal characters, optionally with standard UUID dashes. Check https://mcuuid.net/ or leave it blank for automatic lookup.');
  if (discord.length > 100 || /[\x00-\x1f\x7f`]/.test(discord)) throw new RequestError('Discord username must be a single line of at most 100 characters without backticks.');
  if (roles.some(role => !ROLES.includes(role))) throw new RequestError('Select at least one of the four GTNH roles from the form.');
  return { ign, uuid: uuid.replace(/-/g, '').toLowerCase(), discord, roles: [...new Set(roles)] };
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
  if (request.uuid && request.uuid !== profile.id) {
    throw new RequestError('The supplied Minecraft UUID does not match that IGN. Correct the IGN or UUID, or leave UUID blank for automatic lookup.');
  }
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

  async function stillCurrent() {
    const { data: current } = await github.rest.issues.get(issueParams);
    const unchanged = current.state === 'open' && !current.pull_request &&
      current.title === snapshot.title && current.body === snapshot.body;
    if (!unchanged) core.info('Issue changed during processing; leaving it for the next run.');
    return unchanged;
  }

  async function feedback(message) {
    const body = `${marker}\n${message}`;
    const comments = await github.paginate(github.rest.issues.listComments, { ...issueParams, per_page: 100 });
    const previous = comments.find(comment => comment.user?.type === 'Bot' && comment.body?.startsWith(marker));
    if (previous) {
      if (previous.body !== body) await github.rest.issues.updateComment({ ...repo, comment_id: previous.id, body });
    } else {
      await github.rest.issues.createComment({ ...issueParams, body });
    }
  }

  async function readFile(ref) {
    const { data } = await github.rest.repos.getContent({ ...repo, path, ref });
    if (data.type !== 'file' || data.encoding !== 'base64') throw new Error('Could not read capesUUID.txt as a file.');
    return { sha: data.sha, content: Buffer.from(data.content, 'base64').toString('utf8') };
  }

  async function complete(pr) {
    if (!await stillCurrent()) return;
    await feedback(`This cape request is covered by ${pr.html_url}. Closing as completed because the PR is ready for maintainer review; the cape becomes available after it is merged.`);
    if (await stillCurrent()) {
      await github.rest.issues.update({ ...issueParams, state: 'closed', state_reason: 'completed' });
    }
  }

  try {
    const { data: issue } = await github.rest.issues.get(issueParams);
    if (issue.pull_request || issue.state !== 'open' || !issue.title.startsWith('[Cape Request]:')) return;
    snapshot = { title: issue.title, body: issue.body };
    const request = parseRequest(issue.body);
    const profile = await resolveProfile(request, fetch);
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
      await complete(openPR);
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
        `Requested through #${issueNumber}.`,
        '',
        `Minecraft IGN: \`${profile.name}\``,
        `Minecraft UUID: \`${profile.id}\``,
        `Discord username: ${request.discord ? `\`${request.discord}\`` : 'Not provided'}`,
        `GTNH roles: ${request.roles.join(', ')}`,
        '',
        'Adds a capedev entry in alphabetical order. Roles are self-reported; maintainers should verify eligibility during CODEOWNERS review.',
      ].join('\n'),
    });
    await complete(pr);
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

module.exports = { parseRequest, resolveProfile, addCape, run };
