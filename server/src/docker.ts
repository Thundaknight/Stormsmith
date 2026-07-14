import Docker from 'dockerode';
import path from 'path';
import { PassThrough } from 'stream';
import tar from 'tar-stream';
import { config } from './config';
import type { ContainerState, ServerAction } from './types';

function createDocker(): Docker {
  if (config.dockerHost) {
    const url = new URL(config.dockerHost);
    // tcp:// means plain HTTP to the Docker remote API
    const protocol = url.protocol === 'https:' ? 'https' : 'http';
    return new Docker({
      host: url.hostname,
      port: parseInt(url.port || '2375', 10),
      protocol,
    });
  }
  return new Docker({ socketPath: config.dockerSocket });
}

export const docker = createDocker();

export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: ContainerState;
  statusText: string;
}

/** All containers on the host (running or not). */
export async function listContainers(): Promise<ContainerSummary[]> {
  const containers = await docker.listContainers({ all: true });
  return containers.map((c) => ({
    id: c.Id,
    name: (c.Names[0] || '').replace(/^\//, ''),
    image: c.Image,
    state: (c.State as ContainerState) || 'not_found',
    statusText: c.Status || '',
  }));
}

export async function performAction(containerName: string, action: ServerAction): Promise<void> {
  const container = docker.getContainer(containerName);
  switch (action) {
    case 'start':
      await container.start();
      break;
    case 'stop':
      await container.stop({ t: 30 });
      break;
    case 'restart':
      await container.restart({ t: 30 });
      break;
    case 'pause':
      await container.pause();
      break;
    case 'unpause':
      await container.unpause();
      break;
  }
}

/** Runs a command inside a running container and returns its output. */
export async function execInContainer(
  containerName: string,
  cmd: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const container = docker.getContainer(containerName);
  const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
  const stream = await exec.start({});
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const outChunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  stdout.on('data', (c: Buffer) => outChunks.push(c));
  stderr.on('data', (c: Buffer) => errChunks.push(c));
  container.modem.demuxStream(stream, stdout, stderr);
  await new Promise<void>((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('close', resolve);
    stream.on('error', reject);
  });
  const info = await exec.inspect();
  return {
    stdout: Buffer.concat(outChunks).toString('utf8'),
    stderr: Buffer.concat(errChunks).toString('utf8'),
    exitCode: info.ExitCode ?? 0,
  };
}

export interface ContainerFileEntry {
  name: string;
  size: number;
  isDir: boolean;
}

/** Lists a directory inside a running container (POSIX sh only, no GNU tools needed). */
export async function listContainerDir(containerName: string, dirPath: string): Promise<ContainerFileEntry[]> {
  const script =
    'cd "$1" 2>/dev/null || exit 0; for f in * .[!.]*; do [ -e "$f" ] || continue; ' +
    'if [ -d "$f" ]; then printf "d|0|%s\\n" "$f"; else printf "f|%s|%s\\n" "$(wc -c < "$f")" "$f"; fi; done';
  const result = await execInContainer(containerName, ['sh', '-c', script, 'sh', dirPath]);
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [type, size, ...nameParts] = line.split('|');
      return { name: nameParts.join('|'), size: parseInt(size, 10) || 0, isDir: type === 'd' };
    })
    .filter((e) => e.name);
}

/**
 * Writes an uploaded file into a container directory using the archive API.
 * `subDir` is created inside `parentDir` if missing (works on stopped containers).
 */
export async function putContainerFile(
  containerName: string,
  parentDir: string,
  subDir: string,
  fileName: string,
  content: Buffer
): Promise<void> {
  const container = docker.getContainer(containerName);
  const pack = tar.pack();
  pack.entry({ name: `${subDir}/${fileName}` }, content);
  pack.finalize();
  const chunks: Buffer[] = [];
  for await (const c of pack) chunks.push(c as Buffer);
  await container.putArchive(Buffer.concat(chunks), { path: parentDir });
}

/** When the container's current run started (ISO timestamp), for uptime display. */
export async function getStartedAt(containerName: string): Promise<string | null> {
  const info = await docker.getContainer(containerName).inspect();
  return info?.State?.StartedAt || null;
}

/**
 * Reads a file from inside a container using the archive API
 * (works even when the container is stopped; no volume mounts needed).
 */
export async function readContainerFile(containerName: string, filePath: string): Promise<string> {
  const container = docker.getContainer(containerName);
  const stream = await container.getArchive({ path: filePath });
  const extract = tar.extract();
  return new Promise((resolve, reject) => {
    let content: string | null = null;
    extract.on('entry', (header, entryStream, next) => {
      if (header.type === 'file' && content === null) {
        const chunks: Buffer[] = [];
        entryStream.on('data', (c: Buffer) => chunks.push(c));
        entryStream.on('end', () => {
          content = Buffer.concat(chunks).toString('utf8');
          next();
        });
      } else {
        entryStream.on('end', () => next());
        entryStream.resume();
      }
    });
    extract.on('finish', () => {
      if (content !== null) resolve(content);
      else reject(new Error(`No file found at ${filePath}`));
    });
    extract.on('error', reject);
    stream.pipe(extract);
  });
}

/** Writes a file inside a container using the archive API. The directory must exist. */
export async function writeContainerFile(containerName: string, filePath: string, content: string): Promise<void> {
  const container = docker.getContainer(containerName);
  const pack = tar.pack();
  pack.entry({ name: path.posix.basename(filePath) }, content);
  pack.finalize();
  const chunks: Buffer[] = [];
  for await (const c of pack) chunks.push(c as Buffer);
  await container.putArchive(Buffer.concat(chunks), { path: path.posix.dirname(filePath) });
}

export interface ContainerStats {
  cpuPercent: number;
  memUsageBytes: number;
  memLimitBytes: number;
}

export async function getStats(containerName: string): Promise<ContainerStats> {
  const container = docker.getContainer(containerName);
  const stats = (await container.stats({ stream: false })) as any;
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const sysDelta = stats.cpu_stats.system_cpu_usage - (stats.precpu_stats.system_cpu_usage || 0);
  // system_cpu_usage aggregates all cores, so this is % of total host CPU
  // (matches Unraid's dashboard; `docker stats` would multiply by core count)
  const cpuPercent = sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * 100 : 0;
  // Subtract page cache like `docker stats` does
  const cache = stats.memory_stats.stats?.inactive_file ?? stats.memory_stats.stats?.cache ?? 0;
  return {
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    memUsageBytes: (stats.memory_stats.usage || 0) - cache,
    memLimitBytes: stats.memory_stats.limit || 0,
  };
}
