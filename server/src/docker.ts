import Docker from 'dockerode';
import path from 'path';
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
