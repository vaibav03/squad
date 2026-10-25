export type TaskState = 'submitted' | 'working' | 'input-required' | 'completed' | 'failed' | 'canceled';

const NEXT: Record<TaskState, readonly TaskState[]> = {
  submitted: ['working', 'failed', 'canceled'],
  working: ['input-required', 'completed', 'failed', 'canceled'],
  'input-required': ['working', 'completed', 'failed', 'canceled'],
  completed: [],
  failed: [],
  canceled: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return NEXT[from].includes(to);
}

export class TaskTracker {
  private readonly tasks = new Map<string, { state: TaskState; members: readonly string[] }>();

  open(taskId: string, members: readonly string[]): void {
    if (this.tasks.has(taskId)) throw new Error('task already open');
    this.tasks.set(taskId, { state: 'submitted', members });
  }
  state(taskId: string): TaskState | undefined {
    return this.tasks.get(taskId)?.state;
  }
  members(taskId: string): readonly string[] | undefined {
    return this.tasks.get(taskId)?.members;
  }
  transition(taskId: string, to: TaskState): void {
    const t = this.tasks.get(taskId);
    if (!t) throw new Error('unknown task');
    if (!canTransition(t.state, to)) throw new Error(`illegal transition ${t.state} -> ${to}`);
    t.state = to;
  }
  isOpen(taskId: string): boolean {
    const s = this.state(taskId);
    return s === 'submitted' || s === 'working' || s === 'input-required';
  }
}

export interface AgentCard {
  name: string;
  url: string;
  protocol: 'a2a-shaped/1';
  id: string;
  capabilities: { streaming: false; pushNotifications: false };
  skills: { id: string; name: string }[];
  states: readonly TaskState[];
}

export function agentCard(o: { id: string; name: string; url: string }): AgentCard {
  return {
    name: o.name,
    url: o.url,
    protocol: 'a2a-shaped/1',
    id: o.id,
    capabilities: { streaming: false, pushNotifications: false },
    skills: [
      { id: 'study', name: 'Private study scheduling' },
      { id: 'trip', name: 'Private trip planning' },
    ],
    states: ['submitted', 'working', 'input-required', 'completed', 'failed', 'canceled'],
  };
}
