
    export function createExperience(canvas) {
      let running = false;
      let viewport = { width: 0, height: 0 };
      return {
        async start() { running = true; const gl = canvas.getContext('webgl'); gl.clear(gl.COLOR_BUFFER_BIT); },
        resize(next) { viewport = next; },
        dispatch(event) { canvas.dataset.event = event; },
        snapshot() { return { running, viewport }; },
        destroy() { running = false; canvas.removeAttribute('data-event'); },
      };
    }
  