import Docker from 'dockerode';
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
  const cpuCount = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage?.length || 1;
  const cpuPercent = sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * cpuCount * 100 : 0;
  // Subtract page cache like `docker stats` does
  const cache = stats.memory_stats.stats?.inactive_file ?? stats.memory_stats.stats?.cache ?? 0;
  return {
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    memUsageBytes: (stats.memory_stats.usage || 0) - cache,
    memLimitBytes: stats.memory_stats.limit || 0,
  };
}
