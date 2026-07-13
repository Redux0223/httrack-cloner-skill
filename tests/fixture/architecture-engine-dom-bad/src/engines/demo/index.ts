
    export function createExperience() {
      const button = document.createElement('button');
      document.body.appendChild(button);
      return {
        async start() {}, resize() {}, dispatch() {}, snapshot() { return {}; }, destroy() {},
      };
    }
  