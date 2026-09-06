import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, rename, rmdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { git, requirePushedCommit, withCommitArchive } from "./workflow-git.mjs";
import { validateWorkflow } from "./validate-workflow.mjs";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const nodes = value => value?.edges?.map(edge => edge.node) ?? [];

export function requirePersonalRailwaySession(env = process.env) {
  if (env.CI || env.GITHUB_ACTIONS || env.RAILWAY_TOKEN || env.RAILWAY_API_TOKEN) {
    throw new Error("Multiplayer provisioning requires a personal Railway CLI login, not CI or an environment token.");
  }
}

export function reviewOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port
    || url.pathname !== "/" || url.search || url.hash
    || !url.hostname.endsWith(".lakebed.app") || url.hostname === "craft.lakebed.app") {
    throw new Error("Use an isolated Lakebed HTTPS review origin, never production.");
  }
  return url.origin;
}

export function validateRailwayBinding(binding, identity, project) {
  if (binding?.format !== "lakecraft.railway-review.v1"
    || !["development", "preview"].includes(binding.channel)
    || ![binding.workspaceId, binding.projectId, binding.environmentId, binding.serviceId, binding.volumeId].every(id => UUID.test(id))
    || binding.account !== identity.email
    || !identity.workspaces?.some(workspace => workspace.id === binding.workspaceId)) {
    throw new Error("Railway review binding does not belong to this CLI account.");
  }
  if (project.id !== binding.projectId || project.workspaceId !== binding.workspaceId
    || project.name !== binding.projectName || !project.name.startsWith("lakecraft-test-")) {
    throw new Error("Railway project does not match the isolated review binding.");
  }
  const environments = nodes(project.environments);
  const environment = environments.find(item => item.id === binding.environmentId);
  if (!environment || environment.name !== binding.channel || environment.deletedAt
    || environment.canAccess !== true
    || environments.some(item => item.id !== environment.id && nodes(item.serviceInstances).length)) {
    throw new Error("Review projects must not contain another deployed environment.");
  }
  const instances = nodes(environment.serviceInstances);
  const volumes = nodes(environment.volumeInstances);
  if (instances.length !== 1 || instances[0].serviceId !== binding.serviceId
    || instances[0].source?.repo || instances[0].source?.image
    || volumes.length !== 1 || volumes[0].volume?.id !== binding.volumeId
    || volumes[0].serviceId !== binding.serviceId || volumes[0].mountPath !== "/data"
    || volumes[0].isPendingDeletion || volumes[0].deletedAt) {
    throw new Error("Review service or isolated /data volume changed; inspect before deploying.");
  }
  return binding;
}

export function railwayWorldVariables(binding, registration) {
  const origin = reviewOrigin(registration.url);
  if (registration.deployId !== binding.lakebedDeployId
    || origin !== binding.lakebedOrigin
    || registration.canonicalWssUrl !== `${binding.railwayUrl.replace(/\/$/, "").replace(/^https:/, "wss:")}/ws`
    || !/^[A-Za-z0-9:_-]{1,128}$/.test(registration.serverId)
    || typeof registration.serverCredential !== "string" || registration.serverCredential.length < 32) {
    throw new Error("Registration must belong to the bound Lakebed review deployment.");
  }
  return {
    AUTH_MODE: "lakebed", SERVER_ID: registration.serverId,
    LAKEBED_TICKET_REDEEM_URL: `${origin}/api/multiplayer/redeem-join-ticket`,
    LAKEBED_REGISTRATION_CREDENTIAL: registration.serverCredential,
    ALLOWED_ORIGINS: origin, DATA_DIR: "/data", PORT: "3001", HOST: "0.0.0.0",
    PUBLIC_SERVER_NAME: `Lakecraft ${binding.channel}`, ACCESS_MODE: "public",
    RAILWAY_DOCKERFILE_PATH: "apps/game-server/Dockerfile",
    RAILWAY_DEPLOYMENT_OVERLAP_SECONDS: "0",
  };
}

export async function railway(args, { cwd, input } = {}) {
  requirePersonalRailwaySession();
  return new Promise((accept, reject) => {
    const child = spawn("railway", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const output = [];
    let diagnostic = "";
    child.stdout.on("data", part => output.push(part));
    // Never forward command diagnostics: variable commands can include secrets.
    child.stderr.on("data", part => { if (diagnostic.length < 65536) diagnostic += part.toString(); });
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) {
        const reason = diagnostic.includes("resource provision limit exceeded")
          ? "Account resource limit reached; do not upgrade or retry automatically."
          : diagnostic.includes("creating projects too quickly")
            ? "Project creation is rate limited; inspect existing resources before retrying."
            : "Inspect the exact target with the CLI.";
        return reject(new Error(`Railway ${args[0]} failed (${code}). ${reason}`));
      }
      try { accept(JSON.parse(Buffer.concat(output).toString("utf8"))); }
      catch { reject(new Error(`Railway ${args[0]} returned invalid JSON.`)); }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

async function privateJson(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077)
    || info.uid !== process.getuid()) throw new Error("Local Railway records must be owned regular files with mode 0600.");
  return JSON.parse(await readFile(path, "utf8"));
}

async function save(path, value) {
  const temporary = `${path}.${randomBytes(6).toString("hex")}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

async function main() {
  const [command, channel, ...args] = process.argv.slice(2);
  if (!["init", "status", "deploy", "destroy"].includes(command) || !["development", "preview"].includes(channel)) {
    throw new Error("Usage: node scripts/railway-multiplayer.mjs <init|status|deploy|destroy> <development|preview> [--workspace ID | --registration-file PATH | --confirm-project ID]");
  }
  if ((command === "status" && args.length)
    || (command === "init" && (args.length !== 2 || args[0] !== "--workspace" || !UUID.test(args[1])))
    || (command === "deploy" && (args.length !== 2 || args[0] !== "--registration-file"))
    || (command === "destroy" && (args.length !== 2 || args[0] !== "--confirm-project"))) {
    throw new Error("Invalid arguments; workspace and registration are explicit, never inferred from a linked project.");
  }
  requirePersonalRailwaySession();
  const cwd = process.cwd();
  const branch = git(["branch", "--show-current"], cwd);
  if (!branch || (channel === "development" ? branch === "main" : branch !== "main")) {
    throw new Error("Development requires a work branch; preview requires main.");
  }
  const key = createHash("sha256").update(`${channel}:${branch}`).digest("hex").slice(0, 12);
  const directory = join(cwd, ".lakebed", "railway", key);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, "operation.lock");
  await mkdir(lock);
  try {
  const path = join(directory, "binding.json");
  const identity = await railway(["whoami", "--json"], { cwd: directory });
  let binding;
  try { binding = await privateJson(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (command === "init") {
    if (binding) throw new Error("A provisioning record already exists. Inspect status; do not create duplicate resources.");
    if (!identity.workspaces.some(workspace => workspace.id === args[1])) throw new Error("Choose a workspace from railway whoami --json.");
    binding = { format: "lakecraft.railway-review.v1", channel, branch,
      account: identity.email, workspaceId: args[1], projectName: `lakecraft-test-${randomBytes(5).toString("hex")}`,
      createdAt: new Date().toISOString(), phase: "creating" };
    await save(path, binding);
    const project = await railway(["init", "--name", binding.projectName, "--workspace", binding.workspaceId, "--json"], { cwd: directory });
    binding.projectId = project.id;
    await save(path, binding);
    const environment = await railway(["environment", "new", channel, "--json"], { cwd: directory });
    binding.environmentId = environment.id;
    await save(path, binding);
    await railway(["link", "--project", binding.projectId, "--environment", binding.environmentId, "--json"], { cwd: directory });
    const service = await railway(["add", "--service", "world", "--json"], { cwd: directory });
    binding.serviceId = service.id;
    await save(path, binding);
    await railway(["link", "--project", binding.projectId, "--environment", binding.environmentId, "--service", binding.serviceId, "--json"], { cwd: directory });
    const volume = await railway(["volume", "add", "--mount-path", "/data", "--json"], { cwd: directory });
    binding.volumeId = volume.id;
    await save(path, binding);
    const domain = await railway(["domain", "--port", "3001", "--json"], { cwd: directory });
    binding.railwayUrl = domain.domain;
    binding.phase = "awaiting-registration";
    await save(path, binding);
  }
  if (!binding?.projectId || !binding.environmentId) throw new Error("No complete binding. Inspect any partial provisioning record before retrying.");
  const project = await railway(["status", "--project", binding.projectId, "--environment", binding.environmentId, "--json"], { cwd: directory });
  validateRailwayBinding(binding, identity, project);
  if (binding.branch !== branch || binding.channel !== channel) throw new Error("Binding belongs to a different review branch.");
  if (command === "destroy") {
    if (args[1] !== binding.projectId) throw new Error("Confirm the exact isolated project ID before deletion.");
    await railway(["project", "delete", "--project", binding.projectId, "--yes", "--json"], { cwd: directory });
    binding.phase = "deletion-requested";
    await save(path, binding);
  }
  if (command === "deploy") {
    const source = requirePushedCommit(channel, cwd);
    const review = JSON.parse(await readFile(join(cwd, ".lakebed", "reviews", `${channel}.json`), "utf8"));
    if (review.commit !== source.commit || !review.verifiedAt) throw new Error("Publish and HTTP-verify this exact Lakebed commit first.");
    binding.lakebedOrigin = reviewOrigin(review.url);
    binding.lakebedDeployId = review.deployId;
    const registration = await privateJson(resolve(args[1]));
    const variables = railwayWorldVariables(binding, registration);
    await validateWorkflow(cwd);
    if (requirePushedCommit(channel, cwd).commit !== source.commit) throw new Error("Source advanced during validation.");
    validateRailwayBinding(binding, await railway(["whoami", "--json"], { cwd: directory }),
      await railway(["status", "--project", binding.projectId, "--environment", binding.environmentId, "--json"], { cwd: directory }));
    const selectors = ["--project", binding.projectId, "--environment", binding.environmentId, "--service", binding.serviceId];
    for (const [name, value] of Object.entries(variables)) {
      await railway(["variable", "set", name, "--stdin", "--skip-deploys", ...selectors, "--json"], { cwd: directory, input: value });
    }
    await withCommitArchive(source.commit, cwd, async archive => {
      await writeFile(join(archive, "railway.json"), JSON.stringify({
        build: { builder: "DOCKERFILE", dockerfilePath: "apps/game-server/Dockerfile" },
        deploy: { healthcheckPath: "/status", numReplicas: 1, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 3 },
      }));
      const result = await railway(["up", archive, "--path-as-root", "--detach", ...selectors, "--json", "--message", source.commit], { cwd: directory });
      binding.deployment = result;
    });
    binding.commit = source.commit;
    binding.phase = "deployment-submitted";
    binding.submittedAt = new Date().toISOString();
    await save(path, binding);
  }
  let setupUrl;
  if (command !== "destroy") {
    try {
      const review = JSON.parse(await readFile(join(cwd, ".lakebed", "reviews", `${channel}.json`), "utf8"));
      const url = new URL(reviewOrigin(review.url));
      url.search = new URLSearchParams({ multiplayer: "1", "register-server": "1",
        deployId: review.deployId, server: `${binding.railwayUrl.replace(/\/$/, "").replace(/^https:/, "wss:")}/ws` }).toString();
      setupUrl = url.href;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  console.log(JSON.stringify({ ...binding, bindingPath: path, setupUrl }, null, 2));
  } finally { await rmdir(lock); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
