
    export function createExperience(canvas) { let frame=0; return {
      start(){ canvas.getContext('webgl'); frame=requestAnimationFrame(()=>{}); }, resize(){ canvas.width=1; },
      dispatch(event){ canvas.dataset.event=event.type; }, snapshot(){ return { frame }; },
      destroy(){ cancelAnimationFrame(frame); canvas.removeAttribute('data-event'); }
    }; }
  