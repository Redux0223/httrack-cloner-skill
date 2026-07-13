
    export function createExperience(canvas) { return {
      start(){ const gl=canvas.getContext('webgl'); gl.clear(gl.COLOR_BUFFER_BIT); }, resize(){ canvas.width=1; },
      dispatch(event){ canvas.dataset.event=event.type; }, snapshot(){ return { ready:true }; }, destroy(){ canvas.remove(); }
    }; }
  