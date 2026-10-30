const UUID_PATTERN = /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const IGN_PATTERN = /^[a-z0-9_]{1,16}$/i;

class RequestError extends Error {}

function isCapeRequest(title) {
  return /^Cape Request(?::|$)/.test(title);
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
  const role = fields.get('GTNH Roles');
  if (!IGN_PATTERN.test(ign)) throw new RequestError('Minecraft IGN must contain 1–16 letters, numbers, or underscores.');
  if (discord.length > 100 || /[\x00-\x1f\x7f`]/.test(discord)) throw new RequestError('Discord Username must be a single line of at most 100 characters without backticks.');
  if (role !== 'GTNH Developer') throw new RequestError('Select GTNH Developer from the role dropdown.');
  return { ign, discord, role };
}

async function resolveProfile(request, fetchProfile = globalThis.fetch) {
  const response = await fetchProfile(`https://api.mojang.com/users/profiles/minecraft/${request.ign}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 204 || response.status === 404) {
    throw new RequestError('Mojang could not find that Minecraft IGN. Check the Java Edition username. A maintainer can rerun this workflow after you correct it.');
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
  let index = entries.findIndex(entry =>
    entry?.cape === 'capedev' && entry.name?.toLowerCase() > profile.name.toLowerCase());
  if (index < 0) {
    const last = entries.findLastIndex(entry => entry?.cape === 'capedev');
    index = last < 0 ? lines.length : last + 1;
  }
  lines.splice(index, 0, `${profile.id}:capedev // ${profile.name}`);
  return lines.join(newline) + (trailingNewline || !content ? newline : '');
}

async function run({ github, context, core, fetch = globalThis.fetch }) {
  const issueNumber = context.issue.number;
  const repo = context.repo;
  const issueParams = { ...repo, issue_number: issueNumber };
  const path = 'capesUUID.txt';
  let snapshot;

  async function stillCurrent() {
    const { data: current } = await github.rest.issues.get(issueParams);
    const unchanged = current.state === 'open' && !current.pull_request &&
      current.title === snapshot.title && current.body === snapshot.body;
    if (!unchanged) core.info('Issue changed during processing; a maintainer can rerun this workflow for the current details.');
    return unchanged;
  }

  async function feedback(body) {
    await github.rest.issues.createComment({ ...issueParams, body });
  }

  async function readFile(ref) {
    const { data } = await github.rest.repos.getContent({ ...repo, path, ref });
    if (data.type !== 'file' || data.encoding !== 'base64') throw new Error('Could not read capesUUID.txt as a file.');
    return { sha: data.sha, content: Buffer.from(data.content, 'base64').toString('utf8') };
  }

  try {
    const { data: issue } = await github.rest.issues.get(issueParams);
    if (issue.pull_request || issue.state !== 'open' || !isCapeRequest(issue.title)) return;
    snapshot = { title: issue.title, body: issue.body };
    const request = parseRequest(issue.body);
    const profile = await resolveProfile(request, fetch);
    if (!await stillCurrent()) return;
    const title = `Cape Request: ${profile.name}`;
    if (snapshot.title !== title) {
      await github.rest.issues.update({ ...issueParams, title });
      snapshot.title = title;
    }
    if (!await stillCurrent()) return;
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

    const branch = `cape-request/capedev-${profile.name}-${issueNumber}`;
    if (!await stillCurrent()) return;

    let branchSha;
    try {
      branchSha = (await github.rest.git.getRef({ ...repo, ref: `heads/${branch}` })).data.object.sha;
    } catch (error) {
      if (error.status !== 404) throw error;
      await github.rest.git.createRef({ ...repo, ref: `refs/heads/${branch}`, sha: master.object.sha });
      branchSha = master.object.sha;
    }
    // Apply to the branch's own snapshot, which may predate today's master if an
    // earlier run stopped before committing. The file SHA guards concurrent edits.
    const branchFile = branchSha === master.object.sha ? file : await readFile(branchSha);
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
        `GitHub Username: @${issue.user.login}`,
        `Minecraft IGN: \`${profile.name}\``,
        `Minecraft UUID: \`${profile.id}\``,
        `Discord Username: ${request.discord ? `\`${request.discord}\`` : 'Not provided'}`,
        `GTNH Roles: ${request.role}`,
      ].join('\n'),
    });
    await feedback(`Pull request: ${pr.html_url}. This issue will close automatically when the PR is merged.`);
    await github.rest.issues.addLabels({ ...repo, issue_number: pr.number, labels: ['Chore'] });
  } catch (error) {
    const expected = error instanceof RequestError;
    if (!expected) core.error(error.message);
    try {
      await feedback(expected ? error.message :
        'Automatic processing failed. This issue remains open. A maintainer should inspect the workflow run before retrying.');
    } catch (commentError) {
      core.setFailed(`Could not post request feedback: ${commentError.message}`);
    }
    if (!expected) core.setFailed(`Cape request processing failed: ${error.message}`);
  }
}

module.exports = { parseRequest, resolveProfile, addCape, run };
