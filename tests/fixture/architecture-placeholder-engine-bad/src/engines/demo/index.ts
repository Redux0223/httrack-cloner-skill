
    export interface ExperienceContract {
      start(): void; resize(): void; dispatch(): void; snapshot(): object; destroy(): void;
    }
    export function createExperience() {
      return {
        start() {}, resize() {}, dispatch() {}, snapshot() { return { status: 'idle' }; }, destroy() {},
      };
    }
  