
    import { createFileRoute } from '@tanstack/react-router';
    import { useEffect, useRef } from 'react';
    import { createExperience } from '../engines/demo';
    export const Route = createFileRoute('/')({ component: Home });
    function Home() {
      const canvasRef = useRef(null);
      useEffect(() => { const engine = createExperience(canvasRef.current); engine.start(); return () => engine.destroy(); }, []);
      return <main><canvas ref={canvasRef}>Hello</canvas></main>;
    }
  