import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dockerConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaochuang-docker-'))
fs.writeFileSync(path.join(dockerConfigDir, 'config.json'), '{}\n', 'utf8')
const args = new Set(process.argv.slice(2))
const cleanupApp = args.has('--cleanup-app')
const down = args.has('--down')
const useEphemeralData = args.has('--ephemeral-data') || down || cleanupApp
const runtimeDataDir = useEphemeralData ? fs.mkdtempSync(path.join(os.tmpdir(), 'xiaochuang-runtime-data-')) : null
const userDockerConfigDir = process.env.DOCKER_CONFIG || path.join(os.homedir(), '.docker')
const userDockerCliPlugins = path.join(userDockerConfigDir, 'cli-plugins')
if (fs.existsSync(userDockerCliPlugins)) {
  fs.symlinkSync(userDockerCliPlugins, path.join(dockerConfigDir, 'cli-plugins'), 'dir')
}
const includeAgent = args.has('--agent')
const noBuild = args.has('--no-build')
const skipMigrate = args.has('--skip-migrate')
const timeoutMs = Number(process.env.XIAOCHUANG_DOCKER_VERIFY_TIMEOUT_MS || 180_000)
const intervalMs = Number(process.env.XIAOCHUANG_DOCKER_VERIFY_POLL_MS || 2_000)
const backendPort = process.env.BACKEND_PORT || '3011'
const postgresPort = process.env.POSTGRES_PORT || '5432'
const hermesRuntimePools = [
  {
    containerName: 'xiaochuang-hermes-source',
    profile: 'xiaochuang-drama-source',
    allowedTools: [
      'get_task_context',
      'list_source_chunks',
      'get_source_chunk',
      'submit_source_chunk_analysis',
      'submit_source_analysis',
      'report_progress',
      'complete_execution',
      'fail_execution',
    ],
  },
  {
    containerName: 'xiaochuang-hermes-plan',
    profile: 'xiaochuang-drama-plan',
    allowedTools: [
      'get_task_context',
      'list_source_chunks',
      'get_source_chunk',
      'submit_blueprint_batch',
      'report_progress',
      'complete_execution',
      'fail_execution',
    ],
  },
  {
    containerName: 'xiaochuang-hermes-script',
    profile: 'xiaochuang-drama-script',
    allowedTools: [
      'get_task_context',
      'list_source_chunks',
      'get_source_chunk',
      'submit_episode_script',
      'report_progress',
      'complete_execution',
      'fail_execution',
    ],
  },
  {
    containerName: 'xiaochuang-hermes-graph',
    profile: 'xiaochuang-drama-graph',
    allowedTools: [
      'get_task_context',
      'list_episode_scripts',
      'get_episode_script',
      'submit_story_graph_batch',
      'report_progress',
      'complete_execution',
      'fail_execution',
    ],
  },
  {
    containerName: 'xiaochuang-hermes-storyboard',
    profile: 'xiaochuang-drama-storyboard',
    allowedTools: [
      'get_storyboard_task_context',
      'list_episode_script_segments',
      'get_episode_script_segment',
      'get_storyboard_assets',
      'submit_storyboard_batch',
      'report_progress',
      'complete_execution',
      'fail_execution',
    ],
  },
]
const forbiddenHermesToolNames = new Set([
  'browser_back',
  'browser_click',
  'browser_navigate',
  'browser_press',
  'browser_scroll',
  'browser_snapshot',
  'browser_type',
  'delegate_task',
  'execute_code',
  'image_generate',
  'memory',
  'patch',
  'process',
  'read_file',
  'search_files',
  'session_search',
  'terminal',
  'todo',
  'vision_analyze',
  'web_extract',
  'web_search',
  'write_file',
])

const composeEnv = {
  ...process.env,
  DOCKER_CONFIG: dockerConfigDir,
  POSTGRES_PORT: postgresPort,
  REDIS_PORT: process.env.REDIS_PORT || '6380',
  MINIO_API_PORT: process.env.MINIO_API_PORT || '9000',
  MINIO_CONSOLE_PORT: process.env.MINIO_CONSOLE_PORT || '9001',
  BACKEND_PORT: backendPort,
  TASK_QUEUE_NAME: process.env.TASK_QUEUE_NAME || 'backend-tasks-runtime-smoke',
  TASK_RECOVER_INTERVAL_MS: process.env.TASK_RECOVER_INTERVAL_MS || '1000',
}
if (runtimeDataDir) {
  composeEnv.POSTGRES_DATA_DIR = process.env.POSTGRES_DATA_DIR || path.join(runtimeDataDir, 'postgres')
  composeEnv.REDIS_DATA_DIR = process.env.REDIS_DATA_DIR || path.join(runtimeDataDir, 'redis')
  composeEnv.MINIO_DATA_DIR = process.env.MINIO_DATA_DIR || path.join(runtimeDataDir, 'minio')
}
if (includeAgent) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  composeEnv.BACKEND_NODE_ENV = process.env.BACKEND_NODE_ENV || 'development'
  composeEnv.AGENT_RUNTIME_PROVIDER = process.env.AGENT_RUNTIME_PROVIDER || 'hermes'
  composeEnv.HERMES_RUNTIME_POOLS_JSON = process.env.HERMES_RUNTIME_POOLS_JSON
    || fs.readFileSync(path.join(repoRoot, 'deploy/hermes/pools.example.json'), 'utf8')
  composeEnv.HERMES_RUNTIME_PER_RUN_MCP_AUTH_ENABLED = process.env.HERMES_RUNTIME_PER_RUN_MCP_AUTH_ENABLED || '1'
  composeEnv.HERMES_RUNTIME_PER_RUN_MODEL_GATEWAY_AUTH_ENABLED = process.env.HERMES_RUNTIME_PER_RUN_MODEL_GATEWAY_AUTH_ENABLED || '1'
  composeEnv.AGENT_RUNTIME_CAPABILITY_PRIVATE_KEY = process.env.AGENT_RUNTIME_CAPABILITY_PRIVATE_KEY
    || privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().replace(/\n/g, '\\n')
  composeEnv.AGENT_RUNTIME_CAPABILITY_PUBLIC_KEY = process.env.AGENT_RUNTIME_CAPABILITY_PUBLIC_KEY
    || publicKey.export({ type: 'spki', format: 'pem' }).toString().replace(/\n/g, '\\n')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: {
      ...composeEnv,
      ...(options.env || {}),
    },
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? 'pipe' : 'inherit',
    timeout: options.timeout,
    windowsHide: true,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0 && !options.allowFailure) {
    const output = String(result.stderr || result.stdout || '').trim()
    throw new Error(output || `${command} ${args.join(' ')} failed with status ${result.status}`)
  }

  return result
}

function docker(args, options) {
  return run('docker', args, options)
}

function compose(args, options) {
  const profiles = ['--profile', 'app', '--profile', 'runtime-verify']
  if (includeAgent) profiles.push('--profile', 'agent')
  return docker(['compose', '-f', 'docker-compose.runtime.yml', ...profiles, ...args], options)
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 2_000 }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => {
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          try {
            resolve(JSON.parse(body))
          } catch (error) {
            reject(error)
          }
          return
        }

        reject(new Error(`HTTP ${response.statusCode}: ${body}`))
      })
    })
    request.on('timeout', () => {
      request.destroy(new Error('request timed out'))
    })
    request.on('error', reject)
  })
}

async function waitFor(label, check) {
  const deadline = Date.now() + timeoutMs
  let lastError = null

  while (Date.now() < deadline) {
    try {
      const result = await check()
      console.log(`[PASS] ${label}`)
      return result
    } catch (error) {
      lastError = error
      console.log(`Waiting for ${label}: ${error instanceof Error ? error.message : String(error)}`)
      await sleep(intervalMs)
    }
  }

  throw new Error(`${label} did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

function readWorkerReadiness() {
  const result = compose(['exec', '-T', 'worker', 'sh', '-lc', 'cat /tmp/task-worker-ready.json'], {
    capture: true,
    allowFailure: true,
    timeout: 10_000,
  })

  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || 'readiness file is not available').trim())
  }

  const readiness = JSON.parse(String(result.stdout || '{}'))
  if (readiness.status !== 'ready') {
    throw new Error(`worker status is ${readiness.status || 'unknown'}`)
  }

  return readiness
}

function readTaskRecoverReadiness() {
  const result = compose(['exec', '-T', 'task-recover', 'sh', '-lc', 'cat /tmp/task-recover-ready.json'], {
    capture: true,
    allowFailure: true,
    timeout: 10_000,
  })

  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || 'readiness file is not available').trim())
  }

  const readiness = JSON.parse(String(result.stdout || '{}'))
  if (readiness.status !== 'ready') {
    throw new Error(`task-recover status is ${readiness.status || 'unknown'}`)
  }

  return readiness
}

function readContainerHealth(containerName) {
  const result = docker(['inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', containerName], {
    capture: true,
    allowFailure: true,
    timeout: 10_000,
  })

  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || `${containerName} is not inspectable`).trim())
  }

  const status = String(result.stdout || '').trim()
  if (status !== 'healthy') {
    throw new Error(`${containerName} health is ${status || 'unknown'}`)
  }

  return status
}

function arraysEqual(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

function readHermesToolsetSurface(containerName) {
  const script = `
import json
import os
import urllib.request

request = urllib.request.Request(
    "http://127.0.0.1:8642/v1/toolsets",
    headers={"Authorization": "Bearer " + os.environ.get("API_SERVER_KEY", "")},
)
with urllib.request.urlopen(request, timeout=5) as response:
    print(response.read().decode("utf-8"))
  `.trim()
  const result = docker(['exec', '-i', containerName, 'python', '-c', script], {
    capture: true,
    timeout: 10_000,
  })

  const output = String(result.stdout || '').trim()
  try {
    return JSON.parse(output)
  } catch (error) {
    throw new Error(`${containerName} returned invalid /v1/toolsets JSON: ${output}`)
  }
}

function verifyHermesToolsetSurface(pool) {
  const payload = readHermesToolsetSurface(pool.containerName)
  if (payload.object !== 'list' || payload.platform !== 'api_server' || !Array.isArray(payload.data)) {
    throw new Error(`${pool.containerName} returned an unexpected /v1/toolsets payload`)
  }

  const enabledToolsets = payload.data
    .filter((toolset) => toolset && toolset.enabled === true)
    .map((toolset) => String(toolset.name || ''))
    .filter(Boolean)
    .sort()
  if (!arraysEqual(enabledToolsets, ['xiaochuang-drama'])) {
    throw new Error(`${pool.containerName} enabled toolsets are ${enabledToolsets.join(', ') || '(none)'}`)
  }

  if (payload.xiaochuang_tool_profile !== pool.profile) {
    throw new Error(
      `${pool.containerName} tool profile is ${payload.xiaochuang_tool_profile || 'missing'}, expected ${pool.profile}`,
    )
  }

  const profileAllowedTools = Array.isArray(payload.xiaochuang_profile_allowed_tools)
    ? payload.xiaochuang_profile_allowed_tools.map((toolName) => String(toolName)).sort()
    : []
  if (!arraysEqual(profileAllowedTools, pool.allowedTools)) {
    throw new Error(
      `${pool.containerName} allowed tools for ${pool.profile} are ${profileAllowedTools.join(', ') || '(none)'}`,
    )
  }

  const enabledTools = new Set(payload.data
    .filter((toolset) => toolset && toolset.enabled === true)
    .flatMap((toolset) => Array.isArray(toolset.tools) ? toolset.tools : [])
    .map((toolName) => String(toolName)))
  const missingProfileTool = profileAllowedTools.find((toolName) => !enabledTools.has(toolName))
  if (missingProfileTool) {
    throw new Error(`${pool.containerName} enabled toolset is missing profile tool ${missingProfileTool}`)
  }
  const leakedTool = [...forbiddenHermesToolNames].find((toolName) => enabledTools.has(toolName))
  if (leakedTool) {
    throw new Error(`${pool.containerName} exposes forbidden Hermes tool ${leakedTool}`)
  }

  return {
    profile: payload.xiaochuang_tool_profile,
    enabledToolsets,
    profileAllowedTools,
  }
}

function runRuntimeSql(sql) {
  const result = docker([
    'exec',
    '-i',
    'xiaochuang-postgres',
    'psql',
    '-U',
    'zhaoxiaogang',
    '-d',
    'xiaochuang',
    '-t',
    '-A',
    '-c',
    sql,
  ], {
    capture: true,
    timeout: 10_000,
  })

  return String(result.stdout || '').trim()
}

function runRuntimeJson(sql) {
  const output = runRuntimeSql(sql)
  try {
    return JSON.parse(output)
  } catch (error) {
    throw new Error(`failed to parse runtime SQL JSON: ${output}`)
  }
}

function createUnsupportedRecoverySmokeTask() {
  const output = runRuntimeSql(`
    INSERT INTO tasks (
      type,
      status,
      title,
      progress,
      source_type,
      domain_table,
      domain_id,
      created_at,
      updated_at
    )
    VALUES (
      'runtime_verify_recover',
      'queued',
      'Runtime verify unsupported recovery smoke',
      0,
      'runtime_verify',
      'runtime_verify_unsupported',
      900001,
      now(),
      now()
    )
    RETURNING id;
  `)
  const id = Number(output.split(/\s+/).find((value) => /^\d+$/.test(value)))
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`failed to create task-recover smoke task: ${output}`)
  }
  return id
}

function readTaskRecoverySmokeStatus(taskId) {
  const output = runRuntimeSql(`
    SELECT concat_ws('|', status, coalesce(error_kind, ''))
    FROM tasks
    WHERE id = ${taskId};
  `)
  const [status = '', errorKind = ''] = output.split('|')
  if (status !== 'failed' || errorKind !== 'unsupported_domain') {
    throw new Error(`task ${taskId} recovery status is ${status || 'missing'}:${errorKind || 'none'}`)
  }
  return { status, errorKind }
}

function createWorkerAgentRuntimeSmokeTask() {
  const data = runRuntimeJson(`
    WITH created_user AS (
      INSERT INTO users (
        account_type,
        display_name,
        email,
        created_at,
        updated_at
      )
      VALUES (
        'personal',
        'Runtime Verify Worker Agent',
        'runtime-verify-worker-agent@example.invalid',
        now(),
        now()
      )
      RETURNING id
    ),
    created_ai_config AS (
      INSERT INTO ai_service_configs (
        user_id,
        service_type,
        provider,
        name,
        base_url,
        api_key,
        model,
        priority,
        is_default,
        is_active,
        created_at,
        updated_at
      )
      SELECT
        created_user.id,
        'text',
        'openai',
        'Runtime Verify Text Service',
        'http://runtime-verify-mock-ai:3099/v1',
        'runtime-verify-provider-key',
        '["runtime-verify-model"]',
        900000,
        false,
        true,
        now(),
        now()
      FROM created_user
      RETURNING id
    ),
    created_drama AS (
      INSERT INTO dramas (
        user_id,
        title,
        description,
        status,
        created_at,
        updated_at
      )
      SELECT
        created_user.id,
        'Runtime verify worker to Hermes',
        'Smoke drama for Worker queued Agent handoff',
        'draft',
        now(),
        now()
      FROM created_user
      RETURNING id, user_id
    ),
    created_source AS (
      INSERT INTO drama_sources (
        user_id,
        drama_id,
        source_type,
        title,
        content_hash,
        content,
        word_count,
        estimated_tokens,
        chapter_count,
        status,
        created_at,
        updated_at
      )
      SELECT
        created_drama.user_id,
        created_drama.id,
        'paste',
        'Runtime verify source',
        'runtime-verify-source-hash',
        'A creator returns to the old city, reconciles with the past, and chooses the present life again.',
        30,
        64,
        1,
        'ready',
        now(),
        now()
      FROM created_drama
      RETURNING id, user_id, drama_id
    ),
    created_task AS (
      INSERT INTO tasks (
        user_id,
        type,
        status,
        title,
        progress,
        source_type,
        drama_id,
        domain_table,
        domain_id,
        payload_json,
        attempt_count,
        created_at,
        updated_at
      )
      SELECT
        created_source.user_id,
        'drama_source_analysis',
        'queued',
        'Runtime verify Worker Agent handoff',
        0,
        'drama',
        created_source.drama_id,
        'drama_sources',
        created_source.id,
        json_build_object(
          'source_id', created_source.id,
          'drama_id', created_source.drama_id
        )::text,
        0,
        now(),
        now()
      FROM created_source
      RETURNING id, user_id, drama_id, domain_id
    )
    SELECT json_build_object(
      'taskId', created_task.id,
      'userId', created_task.user_id,
      'dramaId', created_task.drama_id,
      'sourceId', created_task.domain_id
    )
    FROM created_task;
  `)
  const taskId = Number(data.taskId)
  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw new Error(`failed to create Worker Agent runtime smoke task: ${JSON.stringify(data)}`)
  }
  return data
}

function enqueueWorkerAgentRuntimeSmokeTask(taskId) {
  const script = `
    (async () => {
      const { Queue } = require('bullmq');
      const taskId = Number(process.env.RUNTIME_VERIFY_TASK_ID);
      if (!Number.isInteger(taskId) || taskId <= 0) {
        throw new Error('invalid runtime verify task id');
      }
      const queue = new Queue(process.env.TASK_QUEUE_NAME || 'backend-tasks', {
        connection: {
          url: process.env.REDIS_URL || 'redis://redis:6379',
          maxRetriesPerRequest: 3,
          connectTimeout: 5000,
          enableReadyCheck: true,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 10000, jitter: 0.2 },
          removeOnComplete: { age: 86400, count: 1000 },
          removeOnFail: { age: 604800, count: 1000 },
        },
      });
      try {
        await queue.add(
          'execute-task',
          { taskId },
          {
            jobId: \`task-\${taskId}\`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 10000, jitter: 0.2 },
            removeOnComplete: { age: 86400, count: 1000 },
            removeOnFail: { age: 604800, count: 1000 },
          },
        );
      } finally {
        await queue.close();
      }
    })().catch((error) => {
      console.error(error && error.stack ? error.stack : error);
      process.exit(1);
    });
  `
  compose([
    'exec',
    '-T',
    '-e',
    `RUNTIME_VERIFY_TASK_ID=${taskId}`,
    'worker',
    'node',
    '-e',
    script,
  ], {
    capture: true,
    timeout: 10_000,
  })
}

function readWorkerAgentRuntimeSmokeStatus(taskId) {
  const data = runRuntimeJson(`
    WITH latest_execution AS (
      SELECT *
      FROM agent_executions
      WHERE task_id = ${taskId}
      ORDER BY attempt_no DESC
      LIMIT 1
    ),
    worker_log AS (
      SELECT id, metadata_json
      FROM task_logs
      WHERE task_id = ${taskId}
        AND metadata_json LIKE '%bullmq-%'
      ORDER BY id DESC
      LIMIT 1
    )
    SELECT json_build_object(
      'taskStatus', tasks.status,
      'taskProgress', tasks.progress,
      'providerTaskId', coalesce(tasks.provider_task_id, ''),
      'executionId', latest_execution.id,
      'executionStatus', coalesce(latest_execution.status, ''),
      'remoteRunId', coalesce(latest_execution.remote_run_id, ''),
      'toolProfile', coalesce(latest_execution.tool_profile, ''),
      'checkpoint', coalesce(latest_execution.checkpoint_json, ''),
      'workerLogId', worker_log.id,
      'workerLogMetadata', coalesce(worker_log.metadata_json, '')
    )
    FROM tasks
    LEFT JOIN latest_execution ON latest_execution.task_id = tasks.id
    LEFT JOIN worker_log ON true
    WHERE tasks.id = ${taskId};
  `)
  const executionId = Number(data.executionId)
  const workerLogId = Number(data.workerLogId)
  if (!Number.isInteger(workerLogId) || workerLogId <= 0) {
    throw new Error(`task ${taskId} has not been claimed by the BullMQ Worker yet`)
  }
  if (!Number.isInteger(executionId) || executionId <= 0) {
    throw new Error(`task ${taskId} has no Agent execution yet`)
  }
  if (data.providerTaskId !== `agent_execution:${executionId}`) {
    throw new Error(
      `task ${taskId} provider task is ${data.providerTaskId || 'missing'}, expected agent_execution:${executionId}`,
    )
  }
  if (!String(data.remoteRunId || '').startsWith('run_')) {
    throw new Error(`execution ${executionId} has no Hermes remote run yet`)
  }
  if (data.toolProfile !== 'xiaochuang-drama-source') {
    throw new Error(`execution ${executionId} tool profile is ${data.toolProfile || 'missing'}`)
  }
  return data
}

function restartRuntimeContainer(containerName) {
  docker(['restart', containerName], {
    capture: true,
    timeout: 30_000,
  })
}

function readHermesRestartResumeSmokeStatus(smoke) {
  const data = runRuntimeJson(`
    WITH orphaned_execution AS (
      SELECT *
      FROM agent_executions
      WHERE id = ${smoke.orphanedExecutionId}
    ),
    latest_execution AS (
      SELECT *
      FROM agent_executions
      WHERE task_id = ${smoke.taskId}
      ORDER BY attempt_no DESC
      LIMIT 1
    )
    SELECT json_build_object(
      'taskStatus', tasks.status,
      'providerTaskId', coalesce(tasks.provider_task_id, ''),
      'orphanedStatus', coalesce(orphaned_execution.status, ''),
      'orphanedErrorKind', coalesce(orphaned_execution.error_kind, ''),
      'orphanedErrorMessage', coalesce(orphaned_execution.error_message, ''),
      'latestExecutionId', latest_execution.id,
      'latestAttemptNo', latest_execution.attempt_no,
      'latestStatus', coalesce(latest_execution.status, ''),
      'latestRemoteRunId', coalesce(latest_execution.remote_run_id, ''),
      'latestToolProfile', coalesce(latest_execution.tool_profile, ''),
      'latestCheckpoint', coalesce(latest_execution.checkpoint_json, '')
    )
    FROM tasks
    JOIN orphaned_execution ON orphaned_execution.task_id = tasks.id
    LEFT JOIN latest_execution ON latest_execution.task_id = tasks.id
    WHERE tasks.id = ${smoke.taskId};
  `)
  const latestExecutionId = Number(data.latestExecutionId)
  const latestAttemptNo = Number(data.latestAttemptNo)
  if (
    data.orphanedStatus !== 'orphaned'
    || data.orphanedErrorKind !== 'runtime'
    || ![
      'hermes_runtime_run_cancelled',
      'hermes_runtime_run_not_found',
    ].includes(data.orphanedErrorMessage)
  ) {
    throw new Error(
      `execution ${smoke.orphanedExecutionId} after Hermes restart is ${data.orphanedStatus || 'missing'}:${data.orphanedErrorKind || 'none'}:${data.orphanedErrorMessage || 'none'}`,
    )
  }
  if (!Number.isInteger(latestExecutionId) || latestExecutionId <= 0 || latestExecutionId === smoke.orphanedExecutionId) {
    throw new Error(`task ${smoke.taskId} has not created a replacement attempt after Hermes restart`)
  }
  if (latestAttemptNo !== smoke.expectedAttemptNo) {
    throw new Error(`task ${smoke.taskId} latest attempt is ${latestAttemptNo || 'missing'}, expected ${smoke.expectedAttemptNo}`)
  }
  if (data.providerTaskId !== `agent_execution:${latestExecutionId}`) {
    throw new Error(
      `task ${smoke.taskId} provider task is ${data.providerTaskId || 'missing'}, expected agent_execution:${latestExecutionId}`,
    )
  }
  if (!String(data.latestRemoteRunId || '').startsWith('run_')) {
    throw new Error(`replacement execution ${latestExecutionId} after Hermes restart has no remote run`)
  }
  if (!['starting', 'running', 'checkpointed', 'completed'].includes(data.latestStatus)) {
    throw new Error(
      `replacement execution ${latestExecutionId} after Hermes restart is ${data.latestStatus || 'missing'}, expected an active or completed run`,
    )
  }
  if (data.latestToolProfile !== 'xiaochuang-drama-source') {
    throw new Error(`replacement execution ${latestExecutionId} tool profile is ${data.latestToolProfile || 'missing'}`)
  }
  return data
}

function createAgentOrphanedResumeSmokeTask() {
  const data = runRuntimeJson(`
    WITH created_user AS (
      INSERT INTO users (
        account_type,
        display_name,
        email,
        created_at,
        updated_at
      )
      VALUES (
        'personal',
        'Runtime Verify Agent Resume',
        'runtime-verify-agent-resume@example.invalid',
        now(),
        now()
      )
      RETURNING id
    ),
    created_ai_config AS (
      INSERT INTO ai_service_configs (
        user_id,
        service_type,
        provider,
        name,
        base_url,
        api_key,
        model,
        priority,
        is_default,
        is_active,
        created_at,
        updated_at
      )
      SELECT
        created_user.id,
        'text',
        'openai',
        'Runtime Verify Text Service',
        'http://runtime-verify-mock-ai:3099/v1',
        'runtime-verify-provider-key',
        '["runtime-verify-model"]',
        900000,
        false,
        true,
        now(),
        now()
      FROM created_user
      RETURNING id
    ),
    created_drama AS (
      INSERT INTO dramas (
        user_id,
        title,
        description,
        status,
        created_at,
        updated_at
      )
      SELECT
        created_user.id,
        'Runtime verify orphaned resume',
        'Smoke drama for orphaned Agent attempt recovery',
        'draft',
        now(),
        now()
      FROM created_user
      RETURNING id, user_id
    ),
    created_source AS (
      INSERT INTO drama_sources (
        user_id,
        drama_id,
        source_type,
        title,
        content_hash,
        content,
        word_count,
        estimated_tokens,
        chapter_count,
        status,
        created_at,
        updated_at
      )
      SELECT
        created_drama.user_id,
        created_drama.id,
        'paste',
        'Runtime verify orphaned source',
        'runtime-verify-orphaned-source-hash',
        'A stalled source task should be recovered through a fresh Hermes attempt.',
        18,
        48,
        1,
        'ready',
        now(),
        now()
      FROM created_drama
      RETURNING id, user_id, drama_id
    ),
    created_task AS (
      INSERT INTO tasks (
        user_id,
        type,
        status,
        title,
        progress,
        source_type,
        drama_id,
        domain_table,
        domain_id,
        payload_json,
        attempt_count,
        started_at,
        created_at,
        updated_at
      )
      SELECT
        created_source.user_id,
        'drama_source_analysis',
        'running',
        'Runtime verify orphaned Agent resume smoke',
        12,
        'drama',
        created_source.drama_id,
        'drama_sources',
        created_source.id,
        json_build_object(
          'source_id', created_source.id,
          'drama_id', created_source.drama_id
        )::text,
        1,
        now(),
        now(),
        now()
      FROM created_source
      RETURNING id, user_id, drama_id, domain_id
    ),
    created_execution AS (
    INSERT INTO agent_executions (
      user_id,
      task_id,
      attempt_no,
      runtime,
      remote_run_id,
      session_id,
      status,
      tool_profile,
      skill_manifest_json,
      model_profile,
      checkpoint_json,
      started_at,
      created_at,
      updated_at
    )
    SELECT
      created_task.user_id,
      created_task.id,
      1,
      'hermes',
      'runtime-verify-missing-run',
      concat('u:', created_task.user_id, ':drama:', created_task.drama_id, ':task:', created_task.id, ':attempt:1'),
      'running',
      'xiaochuang-drama-source',
      '[]',
      'xiaochuang-text-project',
      '{"pool":"drama-source-pool","instance":"hermes-source-1","phase":"running"}',
      now(),
      now(),
      now()
    FROM created_task
    RETURNING id, task_id
    )
    SELECT json_build_object(
      'taskId', created_task.id,
      'userId', created_task.user_id,
      'dramaId', created_task.drama_id,
      'sourceId', created_task.domain_id,
      'orphanedExecutionId', created_execution.id
    )
    FROM created_task
    JOIN created_execution ON created_execution.task_id = created_task.id;
  `)
  const taskId = Number(data.taskId)
  const orphanedExecutionId = Number(data.orphanedExecutionId)
  if (!Number.isInteger(taskId) || taskId <= 0 || !Number.isInteger(orphanedExecutionId) || orphanedExecutionId <= 0) {
    throw new Error(`failed to create Agent orphaned resume smoke task: ${JSON.stringify(data)}`)
  }
  return { taskId, orphanedExecutionId }
}

function readAgentOrphanedResumeSmokeStatus(smoke) {
  const data = runRuntimeJson(`
    WITH orphaned_execution AS (
      SELECT *
      FROM agent_executions
      WHERE id = ${smoke.orphanedExecutionId}
    ),
    latest_execution AS (
      SELECT *
      FROM agent_executions
      WHERE task_id = ${smoke.taskId}
      ORDER BY attempt_no DESC
      LIMIT 1
    )
    SELECT json_build_object(
      'taskStatus', tasks.status,
      'taskProgress', tasks.progress,
      'providerTaskId', coalesce(tasks.provider_task_id, ''),
      'orphanedStatus', coalesce(orphaned_execution.status, ''),
      'orphanedErrorKind', coalesce(orphaned_execution.error_kind, ''),
      'orphanedErrorMessage', coalesce(orphaned_execution.error_message, ''),
      'latestExecutionId', latest_execution.id,
      'latestAttemptNo', latest_execution.attempt_no,
      'latestStatus', coalesce(latest_execution.status, ''),
      'latestRemoteRunId', coalesce(latest_execution.remote_run_id, ''),
      'latestToolProfile', coalesce(latest_execution.tool_profile, ''),
      'latestCheckpoint', coalesce(latest_execution.checkpoint_json, '')
    )
    FROM tasks
    JOIN orphaned_execution ON orphaned_execution.task_id = tasks.id
    LEFT JOIN latest_execution ON latest_execution.task_id = tasks.id
    WHERE tasks.id = ${smoke.taskId};
  `)
  const latestExecutionId = Number(data.latestExecutionId)
  const latestAttemptNo = Number(data.latestAttemptNo)
  if (
    data.orphanedStatus !== 'orphaned'
    || data.orphanedErrorKind !== 'runtime'
    || ![
      'hermes_runtime_run_cancelled',
      'hermes_runtime_run_not_found',
    ].includes(data.orphanedErrorMessage)
  ) {
    throw new Error(
      `execution ${smoke.orphanedExecutionId} recovery status is ${data.orphanedStatus || 'missing'}:${data.orphanedErrorKind || 'none'}:${data.orphanedErrorMessage || 'none'}`,
    )
  }
  if (!Number.isInteger(latestExecutionId) || latestExecutionId <= 0 || latestExecutionId === smoke.orphanedExecutionId) {
    throw new Error(`task ${smoke.taskId} has not created a replacement Agent attempt yet`)
  }
  if (latestAttemptNo !== 2) {
    throw new Error(`task ${smoke.taskId} latest Agent attempt is ${latestAttemptNo || 'missing'}, expected 2`)
  }
  if (data.providerTaskId !== `agent_execution:${latestExecutionId}`) {
    throw new Error(
      `task ${smoke.taskId} provider task is ${data.providerTaskId || 'missing'}, expected agent_execution:${latestExecutionId}`,
    )
  }
  if (!String(data.latestRemoteRunId || '').startsWith('run_')) {
    throw new Error(`replacement execution ${latestExecutionId} has no Hermes remote run yet`)
  }
  if (data.latestToolProfile !== 'xiaochuang-drama-source') {
    throw new Error(`replacement execution ${latestExecutionId} tool profile is ${data.latestToolProfile || 'missing'}`)
  }
  return data
}

function printComposeStatus() {
  compose(['ps'], { allowFailure: true })
}

function migrateRuntimeDatabase() {
  const databaseUrl = process.env.XIAOCHUANG_DOCKER_VERIFY_DATABASE_URL
    || `postgresql://zhaoxiaogang:xiaochuang@127.0.0.1:${postgresPort}/xiaochuang?schema=public`
  console.log('Applying runtime database migrations...')
  run('npm', ['run', 'db:migrate', '--workspace', 'apps/backend'], {
    env: {
      DATABASE_URL: databaseUrl,
    },
  })
}

async function main() {
  docker(['--version'], { capture: true })
  docker(['compose', 'version'], { capture: true })

  console.log('Starting Docker runtime stack...')
  const backendUpArgs = ['up', '-d']
  if (!noBuild) backendUpArgs.push('--build')
  backendUpArgs.push('runtime-verify-mock-ai', 'backend')
  compose(backendUpArgs)

  await waitFor('runtime mock AI health', () => readContainerHealth('xiaochuang-runtime-verify-mock-ai'))
  const backendHealth = await waitFor('backend health', () => requestJson(`http://127.0.0.1:${backendPort}/api/v1/health`))
  if (!skipMigrate) {
    migrateRuntimeDatabase()
  }

  const workerUpArgs = ['up', '-d']
  if (!noBuild) workerUpArgs.push('--build')
  workerUpArgs.push('worker')
  if (includeAgent) {
    workerUpArgs.push(
      'hermes-source',
      'hermes-plan',
      'hermes-script',
      'hermes-graph',
      'hermes-storyboard',
    )
  }
  compose(workerUpArgs)

  const workerReadiness = await waitFor('worker readiness', () => readWorkerReadiness())
  await waitFor('worker container health', () => readContainerHealth('xiaochuang-worker'))
  const activeHermesPools = includeAgent ? hermesRuntimePools : []
  for (const pool of activeHermesPools) {
    await waitFor(`${pool.containerName} health`, () => readContainerHealth(pool.containerName))
    await waitFor(`${pool.containerName} MCP-only tool surface`, () => verifyHermesToolsetSurface(pool))
  }
  let workerSmokeTask = null
  let workerSmokeStatus = null
  let hermesRestartSmoke = null
  if (includeAgent) {
    workerSmokeTask = createWorkerAgentRuntimeSmokeTask()
    enqueueWorkerAgentRuntimeSmokeTask(workerSmokeTask.taskId)
    workerSmokeStatus = await waitFor('Worker queued Agent handoff smoke', () =>
      readWorkerAgentRuntimeSmokeStatus(workerSmokeTask.taskId))
    hermesRestartSmoke = {
      ...workerSmokeTask,
      orphanedExecutionId: Number(workerSmokeStatus.executionId),
      expectedAttemptNo: 2,
    }
    restartRuntimeContainer('xiaochuang-hermes-source')
    await waitFor('xiaochuang-hermes-source health after restart', () => readContainerHealth('xiaochuang-hermes-source'))
    await waitFor('xiaochuang-hermes-source MCP-only tool surface after restart', () =>
      verifyHermesToolsetSurface(hermesRuntimePools[0]))
  }

  const recoverUpArgs = ['up', '-d']
  if (!noBuild) recoverUpArgs.push('--build')
  recoverUpArgs.push('task-recover')
  compose(recoverUpArgs)

  const taskRecoverReadiness = await waitFor('task-recover readiness', () => readTaskRecoverReadiness())
  await waitFor('task-recover container health', () => readContainerHealth('xiaochuang-task-recover'))
  if (includeAgent && hermesRestartSmoke) {
    await waitFor('Hermes source restart orphaned run resumes through domain handler smoke', () =>
      readHermesRestartResumeSmokeStatus(hermesRestartSmoke))
  }
  const recoverySmokeTaskId = createUnsupportedRecoverySmokeTask()
  await waitFor('task-recover unsupported task smoke', () => readTaskRecoverySmokeStatus(recoverySmokeTaskId))
  if (includeAgent) {
    const orphanedResumeSmoke = createAgentOrphanedResumeSmokeTask()
    await waitFor('Agent orphaned attempt resumes through domain handler smoke', () =>
      readAgentOrphanedResumeSmokeStatus(orphanedResumeSmoke))
  }

  console.log('')
  console.log('Docker runtime verification passed.')
  console.log(`Backend: http://127.0.0.1:${backendPort}/api/v1/health -> ${backendHealth.status}`)
  console.log(`Worker: ${workerReadiness.component} ${workerReadiness.status} on ${workerReadiness.queue}`)
  console.log(`Task recover: ${taskRecoverReadiness.component} ${taskRecoverReadiness.status}`)
  if (activeHermesPools.length) {
    console.log(`Hermes pools: ${activeHermesPools.map((pool) => `${pool.containerName}:${pool.profile}`).join(', ')}`)
  }
  printComposeStatus()
}

try {
  await main()
} finally {
  if (cleanupApp) {
    console.log('\nCleaning up app containers...')
    compose(['rm', '--stop', '--force', 'backend', 'worker', 'task-recover'], { allowFailure: true })
  } else if (down) {
    console.log('\nStopping Docker runtime stack...')
    compose(['down'], { allowFailure: true })
  }
  if (runtimeDataDir) {
    fs.rmSync(runtimeDataDir, { recursive: true, force: true })
  }
  fs.rmSync(dockerConfigDir, { recursive: true, force: true })
}
