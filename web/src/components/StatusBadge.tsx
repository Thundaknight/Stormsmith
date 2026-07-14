import type { ContainerState } from '../types';

const LABELS: Record<ContainerState, string> = {
  running: 'Running',
  paused: 'Paused',
  exited: 'Stopped',
  restarting: 'Restarting',
  created: 'Created',
  dead: 'Dead',
  removing: 'Removing',
  not_found: 'Not found',
};

export default function StatusBadge({ state }: { state: ContainerState }) {
  return (
    <span className={`status-badge status-${state}`}>
      <span className="status-dot" />
      {LABELS[state] || state}
    </span>
  );
}
