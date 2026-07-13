
    const canvas = document.createElement('canvas');
    canvas.getContext('webgl2');
    const worker = new Worker('/assets/render.worker.js');
    window.addEventListener('wheel', () => worker.postMessage('scroll'));
  